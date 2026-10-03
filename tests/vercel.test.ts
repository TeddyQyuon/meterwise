import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {initializeLibsql} from '../server/libsql-database';
import {createVercelHandler,provisionDemoWorkspace} from '../server/vercel';
import type {Dashboard,ImportRecord} from '../shared/types';

const makeRequest=(path:string,method='GET',cookie='',body?:unknown,origin='https://meterwise.test')=>
  new Request(`https://meterwise.test/api${path}`,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
const cookies=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');

test('Vercel visitor workspaces preserve imports across client restarts and enforce tenant permissions',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'meterwise-vercel-'));
  let client=createClient({url:`file:${join(directory,'demo.sqlite')}`});
  try{
    let db=await initializeLibsql(client);
    let handler=createVercelHandler(async()=>db);
    assert.equal((await handler(makeRequest('/dashboard'))).status,401);
    const first=await handler(makeRequest('/session','POST','',{role:'manager'}));
    assert.equal(first.status,200);
    assert.equal(first.headers.getSetCookie().length,2);
    for(const cookie of first.headers.getSetCookie())assert.match(cookie,/HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
    let firstCookie=cookies(first);
    assert.match(firstCookie,/mw_visitor=[a-f0-9]{64}/);
    const initial=await (await handler(makeRequest('/dashboard','GET',firstCookie))).json() as Dashboard;
    assert.equal(initial.metrics.missing,8);
    const sample=await (await handler(makeRequest('/sample.csv','GET',firstCookie))).text();
    const imported=await handler(makeRequest('/imports/commit','POST',firstCookie,{csv:sample,fileName:'vercel-test.csv'}));
    assert.equal(imported.status,201);assert.equal((await imported.json() as ImportRecord).accepted,8);
    client.close();
    client=createClient({url:`file:${join(directory,'demo.sqlite')}`});
    db=await initializeLibsql(client);handler=createVercelHandler(async()=>db);
    const restored=await (await handler(makeRequest('/dashboard','GET',firstCookie))).json() as Dashboard;
    assert.equal(restored.metrics.coverage,100);assert.equal(restored.metrics.missing,0);
    assert.equal((await (await handler(makeRequest('/imports','GET',firstCookie))).json() as ImportRecord[]).length,1);
    const second=await handler(makeRequest('/session','POST','',{role:'manager'}));
    const otherCookie=cookies(second);
    const other=await (await handler(makeRequest('/dashboard','GET',otherCookie))).json() as Dashboard;
    assert.equal(other.metrics.missing,8,'another visitor has a separate seeded workspace');
    const otherAlert=other.alerts[0];
    assert.equal((await handler(makeRequest(`/alerts/${encodeURIComponent(otherAlert.id)}`,'GET',firstCookie))).status,404);
    const switched=await handler(makeRequest('/session','POST',firstCookie,{role:'tenant'}));
    const visitorCookie=firstCookie.split('; ').find(value=>value.startsWith('mw_visitor='))!;
    firstCookie=visitorCookie+'; '+cookies(switched);
    const tenant=await (await handler(makeRequest('/dashboard','GET',firstCookie))).json() as Dashboard;
    assert.equal(tenant.meters.length,2);
    assert.equal((await handler(makeRequest('/imports/commit','POST',firstCookie,{csv:sample,fileName:'blocked.csv'}))).status,403);
    assert.equal((await handler(makeRequest('/meters/MW-001','PATCH',firstCookie,{tenantId:'T02',threshold:20}))).status,403);
    assert.equal((await handler(makeRequest('/reports.csv','GET',firstCookie))).status,200);
    const health=await handler(makeRequest('/health'));assert.equal(health.status,200);
    assert.equal((await health.json() as {hosting:string}).hosting,'Vercel');
  }finally{client.close();rmSync(directory,{recursive:true,force:true});}
});

test('Vercel rejects missing, foreign and cross-site write origins before database access',async()=>{
  let loads=0;
  const handler=createVercelHandler(async()=>{loads++;throw new Error('database-secret-do-not-expose');});
  assert.equal((await handler(makeRequest('/session','POST','',{role:'manager'},'https://evil.test'))).status,403);
  const missing=makeRequest('/session','POST','',{role:'manager'});missing.headers.delete('Origin');
  assert.equal((await handler(missing)).status,403);
  const crossSite=makeRequest('/session','POST','',{role:'manager'});crossSite.headers.set('Sec-Fetch-Site','cross-site');
  assert.equal((await handler(crossSite)).status,403);assert.equal(loads,0);
  const response=await handler(makeRequest('/session','POST','',{role:'manager'}));
  assert.equal(response.status,503);assert.equal(response.headers.get('Set-Cookie'),null);
  assert.match(response.headers.get('Content-Security-Policy')!,/default-src 'none'/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.doesNotMatch(await response.text(),/database-secret/);
});

test('the libSQL adapter rolls back a failed batch and caps synthetic workspace provisioning atomically',async()=>{
  const client=createClient({url:'file::memory:'});
  try{
    const db=await initializeLibsql(client);
    await assert.rejects(db.batch([
      {sql:'INSERT INTO workspaces (id,name,tariff,seeded,created_at) VALUES (?,?,?,?,?)',params:['rollback','Test',0.285,0,new Date().toISOString()]},
      {sql:'INSERT INTO table_that_does_not_exist (id) VALUES (?)',params:['fail']}
    ]));
    assert.equal((await db.all('SELECT id FROM workspaces WHERE id=?',['rollback'])).length,0);
    assert.equal(await provisionDemoWorkspace(db,'one',2),true);
    assert.equal(await provisionDemoWorkspace(db,'two',2),true);
    assert.equal(await provisionDemoWorkspace(db,'three',2),false);
    assert.equal(await provisionDemoWorkspace(db,'one',2),true,'existing visitors retain access at capacity');
  }finally{client.close();}
});
