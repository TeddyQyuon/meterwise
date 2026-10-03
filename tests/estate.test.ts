import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {initializeLibsql} from '../server/libsql-database';
import {createVercelHandler} from '../server/vercel';
import {estateBlocks,estateMeters,energyBalance,calculateEstate,type EstateOverview,type EstateOrder} from '../shared/estate';
import {dayStart,addDays} from '../shared/analytics';
import type {Reading,ImportPreview,ImportRecord,Dashboard} from '../shared/types';
import {parseCsv} from '../shared/csv';

const fullDay=(blocks=1)=>estateMeters.slice(0,blocks*4).flatMap(meter=>Array.from({length:24},(_,hour)=>({meter_id:meter.id,recorded_at:new Date(dayStart('2026-09-30')+hour*3_600_000).toISOString(),consumption_kwh:0})));
test('estate solar balance never nets different blocks or hours, and valid zero readings count',()=>{
  const rows=fullDay(2),set=(meter:string,hour:number,value:number)=>{rows.find(row=>row.meter_id===meter&&row.recorded_at===new Date(dayStart('2026-09-30')+hour*3_600_000).toISOString())!.consumption_kwh=value;};
  set('B01-SOLAR',12,50);set('B01-LIGHTING',12,5);set('B01-LIGHTING',20,20);set('B02-LIFTS',12,30);
  const result=energyBalance(rows,estateMeters.slice(0,8),'2026-09-30','2026-09-30');
  assert.equal(result.load,55);assert.equal(result.solar,50);assert.equal(result.grid,50);assert.equal(result.exported,45);assert.equal(result.selfConsumed,5);assert.equal(result.coverage,100);
  assert.equal(result.load,result.grid!+result.selfConsumed!);assert.equal(result.solar,result.exported!+result.selfConsumed!);
});
test('a missing meter withholds derived values and per-unit comparisons without imputing zero',()=>{
  const rows=fullDay();rows.pop();
  const result=calculateEstate(rows,[],estateBlocks.slice(0,1),estateMeters.slice(0,4),'2026-09-30','2026-09-30');
  assert.equal(result.balance.received,95);assert.equal(result.balance.expected,96);assert.equal(result.balance.grid,null);assert.equal(result.balance.exported,null);assert.equal(result.summaries[0].cost,null);assert.equal(result.summaries[0].co2Kg,null);assert.equal(result.summaries[0].kwhPerUnit,null);assert.equal(result.change,null);
});

async function fixture(){
  const client=createClient({url:'file::memory:',intMode:'number'}),db=await initializeLibsql(client),handler=createVercelHandler(async()=>db);
  const cookies=new Map<string,string>();
  const request=async(path:string,method='GET',body?:unknown,visitor='a')=>{
    const response=await handler(new Request(`https://estate.test/api${path}`,{method,headers:{Origin:'https://estate.test',Cookie:cookies.get(visitor)??'','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
    const additions=response.headers.getSetCookie().map(value=>value.split(';')[0]);
    if(additions.length){const current=(cookies.get(visitor)??'').split('; ').filter(Boolean);for(const addition of additions){const name=addition.split('=')[0];const index=current.findIndex(value=>value.startsWith(name+'='));if(index<0)current.push(addition);else current[index]=addition;}cookies.set(visitor,current.join('; '));}
    return response;
  };
  await request('/session','POST',{role:'manager'});return {db,client,request};
}
test('estate imports repair gaps, persist history, deduplicate and preserve the office workspace',async()=>{
  const {client,db,request}=await fixture();try{
    const legacy=await (await request('/dashboard')).json() as Dashboard;assert.equal(legacy.metrics.missing,8);
    const initial=await (await request('/estate/overview')).json() as EstateOverview;
    assert.equal(initial.blocks.length,6);assert.equal(initial.meters.length,24);assert.equal(initial.metrics.units,620);assert.equal(initial.metrics.expected-initial.metrics.received,2);assert.equal(initial.metrics.grid,null);
    const sample=await (await request('/estate/sample.csv')).text();
    const preview=await (await request('/estate/imports/preview','POST',{csv:sample})).json() as ImportPreview;assert.equal(preview.valid,2);
    const saved=await request('/estate/imports/commit','POST',{csv:sample,fileName:'estate-repair.csv'});assert.equal(saved.status,201);assert.equal((await saved.json() as ImportRecord).accepted,2);
    const ready=await (await request('/estate/overview')).json() as EstateOverview;
    assert.equal(ready.metrics.coverage,100);assert.ok(ready.metrics.grid!>0);assert.ok(ready.metrics.exported!>0);assert.notEqual(ready.metrics.change,null);
    assert.ok(Math.abs(ready.metrics.co2Kg!-ready.metrics.grid!*0.402)<.02);
    assert.equal((await (await request('/estate/imports/commit','POST',{csv:sample,fileName:'again.csv'})).json() as {alreadyImported:boolean}).alreadyImported,true);
    assert.equal((await (await request('/estate/imports')).json() as ImportRecord[]).length,1);
    assert.equal((await (await request('/estate/imports/preview','POST',{csv:sample})).json() as ImportPreview).duplicate,2);
    assert.equal((await (await request('/dashboard')).json() as Dashboard).metrics.missing,8);
    const report=await (await request('/estate/report.csv')).text(),reportRows=parseCsv(report);assert.equal(reportRows.length,7);assert.match(report,/SIMULATED/);assert.equal(reportRows[1].cells[14],'2024');assert.equal(reportRows[1].cells[15],'0.402');assert.match(report,/data.gov.sg/);
    assert.equal((await request('/estate/overview?from=2026-02-30&to=2026-03-01')).status,400);
    const outOfRange=`meter_id,timestamp,consumption_kwh\nB01-LIGHTING,${new Date(dayStart(addDays(initial.bounds.from,-1))).toISOString()},3`;
    assert.equal((await request('/estate/imports/preview','POST',{csv:outOfRange})).status,400);
    assert.equal((await db.all('SELECT * FROM estate_state')).length,1);
  }finally{client.close();}
});
test('work orders require evidence and ordered transitions; stale or racing saves cannot append false events',async()=>{
  const {client,db,request}=await fixture();try{
    const body={meterId:'B03-PUMPS',title:'Inspect pump load at night',priority:'high',note:'Simulated pump load exceeded the configured threshold.'};
    assert.equal((await request('/estate/orders','POST',{...body,note:'short'})).status,400);
    const created=await request('/estate/orders','POST',body);assert.equal(created.status,201);const order=await created.json() as EstateOrder,path=`/estate/orders/${encodeURIComponent(order.id)}`;
    const patch={version:1,status:'verified',assignee:'Pump maintenance team (demo)',note:'Simulated verification evidence for the pump inspection.'};
    assert.equal((await request(path,'PATCH',patch)).status,400);
    const responses=await Promise.all([request(path,'PATCH',{...patch,status:'in_progress'}),request(path,'PATCH',{...patch,status:'in_progress'})]);
    assert.deepEqual(responses.map(row=>row.status).sort(),[200,409]);
    let detail=await (await request(path)).json() as EstateOrder;assert.equal(detail.version,2);assert.equal(detail.events?.length,2);
    assert.equal((await request(path,'PATCH',{...patch,status:'completed',version:1})).status,409);
    assert.equal((await request(path,'PATCH',{...patch,status:'completed',version:2,note:'tiny'})).status,400);
    assert.equal((await request(path,'PATCH',{...patch,status:'completed',version:2})).status,200);
    assert.equal((await request(path,'PATCH',{...patch,status:'verified',version:3})).status,200);
    detail=await (await request(path)).json() as EstateOrder;assert.equal(detail.version,4);assert.equal(detail.events?.length,4);assert.equal(detail.status,'verified');
    const events=await db.all('SELECT * FROM estate_events WHERE order_id=?',[order.id]);assert.equal(events.length,4);
  }finally{client.close();}
});
test('estate area viewers and independent visitors cannot read foreign work orders or write estate data',async()=>{
  const {client,request}=await fixture();try{
    const created=await request('/estate/orders','POST',{meterId:'B03-PUMPS',title:'Check the simulated pump',priority:'medium',note:'Simulated inspection requested after a threshold exception.'});
    const order=await created.json() as EstateOrder,path=`/estate/orders/${encodeURIComponent(order.id)}`;
    await request('/session','POST',{role:'manager'},'b');
    assert.equal((await request(path,'GET',undefined,'b')).status,404);
    assert.equal((await (await request('/estate/overview','GET',undefined,'b')).json() as EstateOverview).orders.length,0);
    await request('/session','POST',{role:'tenant'});
    const area=await (await request('/estate/overview')).json() as EstateOverview;assert.equal(area.blocks.length,2);assert.equal(area.meters.length,8);assert.ok(area.blocks.every(block=>block.town==='Ang Mo Kio'));
    assert.equal((await request('/estate/overview?town=Bishan')).status,403);assert.equal((await request('/estate/overview?block=B03')).status,404);
    assert.equal((await request(path)).status,404);
    assert.equal((await request('/estate/orders','POST',{meterId:'B01-LIGHTING'})).status,403);
    assert.equal((await request('/estate/imports/commit','POST',{})).status,403);
    assert.equal((await request('/estate/sample.csv')).status,403);
    const report=await (await request('/estate/report.csv')).text();assert.equal(report.split('\r\n').length,3);assert.doesNotMatch(report,/BISHAN ST|TAMPINES ST/);
  }finally{client.close();}
});
