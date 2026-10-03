import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalDatabase} from '../server/local-database';
import {handleApi} from '../server/api';
import type {Dashboard,Session,EnergyAlert,ImportRecord,ImportPreview} from '../shared/types';

test('imports, reports, investigations, role boundaries and owner isolation work end to end',async()=>{
  process.env.SQLITE_PATH=':memory:';process.env.DB_DIALECT='sqlite';
  const db=await createLocalDatabase();let cookie='';
  const request=async(path:string,method='GET',body?:unknown,owner='test-owner')=>{
    const response=await handleApi(new Request(`http://meterwise.test/api${path}`,{method,headers:{Cookie:cookie,Origin:'http://meterwise.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),db,owner);
    if(response.headers.get('Set-Cookie'))cookie=response.headers.get('Set-Cookie')!.split(';')[0];return response;
  };
  assert.equal((await request('/dashboard')).status,401);
  const sessionResponse=await request('/session','POST',{role:'manager'});assert.equal(sessionResponse.status,200);
  const session=await sessionResponse.json() as Session;assert.equal(session.meters.length,6);
  const initial=await (await request('/dashboard')).json() as Dashboard;
  assert.equal(initial.metrics.missing,8);assert.equal(initial.metrics.openAlerts,3);assert.equal(initial.meters.length,6);
  assert.ok(Math.abs(initial.metrics.cost-initial.metrics.kwh*initial.tariff)<0.011);
  const sample=await (await request('/sample.csv')).text();
  const preview=await (await request('/imports/preview','POST',{csv:sample})).json() as ImportPreview;assert.equal(preview.valid,8);
  const imported=await request('/imports/commit','POST',{csv:sample,fileName:'test-readings.csv'});assert.equal(imported.status,201);assert.equal((await imported.json() as ImportRecord).accepted,8);
  const second=await request('/imports/commit','POST',{csv:sample,fileName:'test-readings.csv'});assert.equal((await second.json() as {alreadyImported:boolean}).alreadyImported,true);
  const filled=await (await request('/dashboard')).json() as Dashboard;assert.equal(filled.metrics.coverage,100);assert.equal(filled.metrics.missing,0);assert.equal(filled.metrics.openAlerts,2);assert.ok(Math.abs(filled.metrics.kwh-initial.metrics.kwh-33.6)<0.000001);
  const reportResponse=await request('/reports.csv');assert.equal(reportResponse.status,200);const report=await reportResponse.text();assert.match(report,/estimated_cost_sgd/);assert.equal(report.split('\r\n').length,43);
  const spike=filled.alerts.find(alert=>alert.status==='open')!;
  const resolve=await request(`/alerts/${encodeURIComponent(spike.id)}`,'PATCH',{status:'resolved',note:'Timer corrected. Checked equipment schedule.'});assert.equal(resolve.status,200);
  const saved=await (await request(`/alerts/${encodeURIComponent(spike.id)}`)).json() as EnergyAlert;assert.equal(saved.status,'resolved');assert.equal(saved.notes?.length,1);
  const managerCookie=cookie;
  const tenantResponse=await request('/session','POST',{role:'tenant'});assert.equal(tenantResponse.status,200);
  const tenant=await (await request('/dashboard')).json() as Dashboard;assert.equal(tenant.meters.length,2);assert.equal(tenant.tenants.length,1);assert.ok(tenant.meters.every(meter=>meter.tenant_id==='T01'));
  assert.equal((await request('/dashboard?tenant=T02')).status,403);
  assert.equal((await request('/dashboard?meter=MW-003')).status,404);
  assert.equal((await request('/imports/commit','POST',{csv:sample,fileName:'test.csv'})).status,403);
  assert.equal((await request('/meters/MW-001','PATCH',{tenantId:'T02',threshold:18})).status,403);
  assert.equal((await request(`/alerts/${encodeURIComponent(spike.id)}`,'PATCH',{status:'open',note:'test'})).status,403);
  const otherAlert=filled.alerts.find(alert=>alert.meter_id==='MW-003')!;assert.equal((await request(`/alerts/${encodeURIComponent(otherAlert.id)}`)).status,404);
  assert.equal((await request('/dashboard','GET',undefined,'another-owner')).status,401);
  assert.equal((await handleApi(new Request('http://meterwise.test/api/session',{method:'POST',headers:{Origin:'https://evil.test'},body:JSON.stringify({role:'manager'})}),db,'test-owner')).status,403);
  cookie=managerCookie;assert.equal((await request('/dashboard')).status,401,'role switch invalidates the earlier session');
  await request('/session','POST',{role:'manager'});
  assert.equal((await request('/meters/MW-001','PATCH',{tenantId:'T02',threshold:19})).status,200);
  const mapped=await (await request('/session')).json() as Session;assert.equal(mapped.meters.find(meter=>meter.id==='MW-001')?.tenant_id,'T02');
  assert.equal((await request('/dashboard?from=2026-02-30&to=2026-03-01')).status,400);
  // Source of truth stays in the database when a new session is created.
  await request('/session','POST',{role:'manager'});
  assert.equal((await (await request('/imports')).json() as ImportRecord[]).length,1);
});

test('hosted identity supports persistent demo roles without third-party cookies',async()=>{
  process.env.SQLITE_PATH=':memory:';process.env.DB_DIALECT='sqlite';
  const db=await createLocalDatabase();
  const request=(path:string,method='GET',body?:unknown,owner:string|null='platform-user-1')=>handleApi(new Request(`https://meterwise.test/api${path}`,{method,headers:{Origin:'https://meterwise.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),db,owner,{platformIdentity:true});
  assert.equal((await request('/dashboard','GET',undefined,null)).status,401);
  const initialized=await request('/session','POST',{role:'manager'});assert.equal(initialized.status,200);assert.equal(initialized.headers.get('Set-Cookie'),null);
  assert.equal((await (await request('/dashboard')).json() as Dashboard).meters.length,6);
  await request('/session','POST',{role:'tenant'});
  assert.equal((await (await request('/session')).json() as Session).role,'tenant');
  assert.equal((await (await request('/dashboard')).json() as Dashboard).meters.length,2);
  assert.equal((await request('/meters/MW-001','PATCH',{tenantId:'T02',threshold:18})).status,403);
  assert.equal((await request('/dashboard','GET',undefined,'platform-user-2')).status,401);
});

test('a configured development frontend can write through the proxy while other origins are rejected',async()=>{
  process.env.SQLITE_PATH=':memory:';process.env.DB_DIALECT='sqlite';
  const db=await createLocalDatabase();
  const request=(origin:string)=>new Request('http://127.0.0.1:3001/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({role:'manager'})});
  const options={trustedOrigins:['http://terminal.local:4173']};
  assert.equal((await handleApi(request('http://terminal.local:4173'),db,'proxy-owner',options)).status,200);
  assert.equal((await handleApi(request('http://terminal.local:4173'),db,'proxy-owner')).status,403,'hosted default remains same-origin');
  assert.equal((await handleApi(request('https://evil.test'),db,'proxy-owner',options)).status,403);
  assert.equal((await handleApi(request('http://terminal.local:4173.evil.test'),db,'proxy-owner',options)).status,403);
});
