import type {Database,Statement} from './database.js';
import type {Role,Reading,ImportPreview,ImportRecord} from '../shared/types.js';
import {estateBlocks,estateMeters,estatePolicy,permittedEstateBlocks,calculateEstate,estateIssues,type EstateOverview,type EstateOrder,type EstateEvent,type EstateOrderStatus} from '../shared/estate.js';
import {hdbCatalogue} from '../shared/hdb-data.js';
import {addDays,dayStart,dateRange,singaporeDate,csvCell,round} from '../shared/analytics.js';
import {validateCsv} from '../shared/csv.js';
import {sha256} from './seed.js';

type Access={role:Role;tenant_id:string|null;workspace_id:string};
type ReadPayload=(request:Request)=>Promise<Record<string,unknown>>;
class EstateError extends Error{constructor(public status:number,message:string){super(message);}}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const csvResponse=(rows:unknown[][],name:string)=>new Response(rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store'}});
const orderColumns='id,block_id,meter_id,title,priority,status,assignee,due_at,created_at,updated_at,version';
const transitions:Record<EstateOrderStatus,EstateOrderStatus[]>={open:['in_progress'],in_progress:['completed'],completed:['verified','in_progress'],verified:['open']};

export async function ensureEstate(db:Database,workspace:string){
  const found=await db.all<{end_day:string}>('SELECT end_day FROM estate_state WHERE workspace_id=?',[workspace]);
  if(found[0])return found[0].end_day;
  const end=addDays(singaporeDate(Date.now()),-1),start=addDays(end,-13);
  const statements:Statement[]=[];
  const rows:(string|number)[][]=[];
  for(let day=0;day<14;day++)for(let hour=0;hour<24;hour++)for(let index=0;index<estateMeters.length;index++){
    const meter=estateMeters[index],blockIndex=Math.floor(index/4);
    const time=new Date(dayStart(addDays(start,day))+hour*3_600_000).toISOString();
    if(day===12&&hour===10&&meter.id==='B01-LIGHTING'||day===13&&hour===14&&meter.id==='B05-SOLAR')continue;
    const unitScale=estateBlocks[blockIndex].units/100;
    const daylight=Math.max(0,Math.sin((hour-7)/12*Math.PI));
    let value=meter.service==='solar'?daylight*(21+blockIndex)*(.84+(day%4)*.045):meter.service==='lighting'?(hour>=19||hour<7?4.4:1.9)*unitScale:meter.service==='lifts'?(hour>=7&&hour<22?5.6:1.2)*unitScale:2.3*unitScale;
    value*=1+(day%3)*.012;
    if(meter.id==='B03-PUMPS'&&day>=11&&hour===3)value=10.8;
    if(meter.id==='B02-LIGHTING'&&day>=12&&hour===2)value=11.2;
    rows.push([`${workspace}|${meter.id}|${time}`,workspace,meter.id,time,round(value)]);
  }
  // Eighty bindings per statement fits the existing D1-compatible database interface.
  for(let i=0;i<rows.length;i+=16){const chunk=rows.slice(i,i+16);statements.push({sql:`INSERT OR IGNORE INTO estate_readings (id,workspace_id,meter_id,recorded_at,consumption_kwh) VALUES ${chunk.map(()=>'(?,?,?,?,?)').join(',')}`,params:chunk.flat()});}
  statements.push({sql:'INSERT OR IGNORE INTO estate_state (workspace_id,end_day) VALUES (?,?)',params:[workspace,end]});
  // Seed and marker commit together. A failed attempt can be retried without
  // leaving a half-seeded workspace; existing office data is untouched.
  await db.batch(statements);
  return (await db.all<{end_day:string}>('SELECT end_day FROM estate_state WHERE workspace_id=?',[workspace]))[0].end_day;
}

async function overview(db:Database,access:Access,url:URL):Promise<EstateOverview>{
  const end=await ensureEstate(db,access.workspace_id),bounds={from:addDays(end,-13),to:end};
  const from=url.searchParams.get('from')??addDays(end,-6),to=url.searchParams.get('to')??end;
  try{dateRange(from,to);if(from<bounds.from||to>bounds.to||singaporeDate(dayStart(from))!==from||singaporeDate(dayStart(to))!==to)throw new Error();}catch{throw new EstateError(400,'Choose valid dates within the 14-day demo dataset.');}
  const permitted=permittedEstateBlocks(access.role),town=url.searchParams.get('town')??'all',block=url.searchParams.get('block')??'all';
  if(town!=='all'&&!permitted.some(item=>item.town===town))throw new EstateError(403,'This town is outside your area view.');
  if(block!=='all'&&!permitted.some(item=>item.id===block))throw new EstateError(404,'Block not found in this area view.');
  const blocks=permitted.filter(item=>(town==='all'||item.town===town)&&(block==='all'||item.id===block));
  if(!blocks.length)throw new EstateError(400,'The selected block does not belong to that town.');
  const meters=estateMeters.filter(meter=>blocks.some(item=>item.id===meter.block_id));
  const ids=meters.map(meter=>meter.id),days=dateRange(from,to).length,priorFrom=addDays(from,-days);
  const all=await db.all<Reading>(`SELECT meter_id,recorded_at,consumption_kwh FROM estate_readings WHERE workspace_id=? AND recorded_at>=? AND recorded_at<? AND meter_id IN (${ids.map(()=>'?').join(',')}) ORDER BY recorded_at`,[access.workspace_id,new Date(dayStart(priorFrom)).toISOString(),new Date(dayStart(addDays(to,1))).toISOString(),...ids]);
  const readings=all.filter(row=>singaporeDate(row.recorded_at)>=from),prior=all.filter(row=>singaporeDate(row.recorded_at)<from);
  const calculated=calculateEstate(readings,prior,blocks,meters,from,to),issues=estateIssues(readings,meters,from,to);
  const orders=await db.all<EstateOrder>(`SELECT ${orderColumns} FROM estate_orders WHERE workspace_id=? AND block_id IN (${blocks.map(()=>'?').join(',')}) ORDER BY created_at DESC LIMIT 100`,[access.workspace_id,...blocks.map(item=>item.id)]);
  const open=orders.filter(order=>order.status!=='verified');
  return {role:access.role,from,to,bounds,catalogue:permitted,meters,blocks:calculated.summaries.map(block=>({...block,issues:issues.filter(issue=>issue.block_id===block.id).length})),metrics:{...calculated.balance,cost:calculated.balance.grid===null?null:round(calculated.balance.grid*estatePolicy.tariff),co2Kg:calculated.balance.grid===null?null:round(calculated.balance.grid*estatePolicy.gridFactor),change:calculated.change,units:blocks.reduce((sum,block)=>sum+block.units,0),openOrders:open.length,overdueOrders:open.filter(order=>new Date(order.due_at).getTime()<Date.now()).length},chart:calculated.chart,services:calculated.services,issues,orders,policy:estatePolicy,source:hdbCatalogue};
}

async function preview(db:Database,workspace:string,csv:string,end:string):Promise<ImportPreview>{
  let first:ImportPreview;
  try{first=validateCsv(csv,estateMeters,new Set());}catch(error){throw new EstateError(400,(error as Error).message);}
  const from=addDays(end,-13);
  if(first.readings.some(row=>singaporeDate(row.recorded_at)<from||singaporeDate(row.recorded_at)>end))throw new EstateError(400,'Import readings only within the 14-day estate demo dataset.');
  const existing=new Set<string>();
  for(let i=0;i<first.readings.length;i+=40){const chunk=first.readings.slice(i,i+40);const rows=await db.all<Reading>(`SELECT meter_id,recorded_at FROM estate_readings WHERE workspace_id=? AND (${chunk.map(()=>'(meter_id=? AND recorded_at=?)').join(' OR ')})`,[workspace,...chunk.flatMap(row=>[row.meter_id,row.recorded_at])]);for(const row of rows)existing.add(`${row.meter_id}|${row.recorded_at}`);}
  return existing.size?validateCsv(csv,estateMeters,existing):first;
}
function writeAccess(access:Access){if(access.role!=='manager')throw new EstateError(403,'Area viewers cannot import readings or change work orders.');}
function text(value:unknown,label:string,min:number,max:number){if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw new EstateError(400,`${label} must contain ${min}–${max} characters.`);return value.trim();}

export async function handleEstateApi(request:Request,db:Database,access:Access,readPayload:ReadPayload):Promise<Response>{
  try{
    const url=new URL(request.url),path=url.pathname,workspace=access.workspace_id;
    if(path==='/api/estate/overview'&&request.method==='GET')return json(await overview(db,access,url));
    const end=await ensureEstate(db,workspace);
    if(path==='/api/estate/sample.csv'&&request.method==='GET'){
      writeAccess(access);return csvResponse([['meter_id','timestamp','consumption_kwh'],['B01-LIGHTING',new Date(dayStart(addDays(end,-1))+10*3_600_000).toISOString(),1.67],['B05-SOLAR',new Date(dayStart(end)+14*3_600_000).toISOString(),20.86]],'meterwise-estate-gap-repair.csv');
    }
    if(path==='/api/estate/imports'&&request.method==='GET'){writeAccess(access);return json(await db.all<ImportRecord>('SELECT id,file_name,accepted,skipped,rejected,created_at FROM estate_imports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30',[workspace]));}
    if(path==='/api/estate/imports/preview'&&request.method==='POST'){writeAccess(access);const body=await readPayload(request);if(typeof body.csv!=='string')throw new EstateError(400,'Choose a CSV file.');return json(await preview(db,workspace,body.csv,end));}
    if(path==='/api/estate/imports/commit'&&request.method==='POST'){
      writeAccess(access);const body=await readPayload(request);
      if(typeof body.csv!=='string'||typeof body.fileName!=='string'||!body.fileName.trim()||body.fileName.length>180||/[\x00-\x1f\x7f/\\]/.test(body.fileName))throw new EstateError(400,'Choose a CSV with a plain filename of 1–180 characters.');
      const id=`${workspace}|${(await sha256(body.csv)).slice(0,32)}`,prior=await db.all<ImportRecord>('SELECT id,file_name,accepted,skipped,rejected,created_at FROM estate_imports WHERE id=? AND workspace_id=?',[id,workspace]);
      if(prior[0])return json({...prior[0],alreadyImported:true});
      const result=await preview(db,workspace,body.csv,end);if(!result.valid)throw new EstateError(400,'There are no new valid intervals to import.');
      const statements:Statement[]=result.readings.map(row=>({sql:'INSERT OR IGNORE INTO estate_readings (id,workspace_id,meter_id,recorded_at,consumption_kwh) VALUES (?,?,?,?,?)',params:[`${workspace}|${row.meter_id}|${row.recorded_at}`,workspace,row.meter_id,row.recorded_at,row.consumption_kwh]}));
      statements.push({sql:'INSERT OR IGNORE INTO estate_imports (id,workspace_id,file_name,accepted,skipped,rejected,created_at) VALUES (?,?,?,?,?,?,?)',params:[id,workspace,body.fileName,result.valid,result.duplicate,result.invalid,new Date().toISOString()]});
      const saved=await db.batch(statements),count=saved.slice(0,-1).reduce((sum,row)=>sum+row.changes,0);
      if(saved.at(-1)!.changes)await db.run('UPDATE estate_imports SET accepted=?,skipped=? WHERE id=? AND workspace_id=?',[count,result.duplicate+result.valid-count,id,workspace]);
      return json((await db.all<ImportRecord>('SELECT id,file_name,accepted,skipped,rejected,created_at FROM estate_imports WHERE id=? AND workspace_id=?',[id,workspace]))[0],201);
    }
    if(path==='/api/estate/orders'&&request.method==='POST'){
      writeAccess(access);const body=await readPayload(request),title=text(body.title,'Work order title',5,160),note=text(body.note,'Inspection note',12,1200);
      const meter=estateMeters.find(item=>item.id===body.meterId);if(!meter)throw new EstateError(400,'Choose a registered estate asset.');
      if(!['high','medium','low'].includes(String(body.priority)))throw new EstateError(400,'Choose a valid priority.');
      const now=new Date().toISOString(),id=`${workspace}|${crypto.randomUUID()}`,event=crypto.randomUUID(),hours=body.priority==='high'?estatePolicy.highPriorityHours:estatePolicy.otherPriorityHours;
      const saved=await db.batch([
        {sql:'INSERT INTO estate_orders (id,workspace_id,block_id,meter_id,title,priority,status,assignee,due_at,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM estate_orders WHERE workspace_id=?)<100',params:[id,workspace,meter.block_id,meter.id,title,body.priority,'open','',new Date(Date.now()+hours*3_600_000).toISOString(),now,now,1,event,workspace]},
        {sql:'INSERT INTO estate_events (id,workspace_id,order_id,action,body,actor,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM estate_orders WHERE workspace_id=? AND id=?)',params:[event,workspace,id,'created',note,'Estate manager (demo)',now,workspace,id]},
      ]);
      if(!saved[0].changes)throw new EstateError(409,'This demo workspace has reached its 100-work-order limit.');
      return json((await db.all<EstateOrder>(`SELECT ${orderColumns} FROM estate_orders WHERE workspace_id=? AND id=?`,[workspace,id]))[0],201);
    }
    const match=path.match(/^\/api\/estate\/orders\/([^/]+)$/);
    if(match){
      const id=decodeURIComponent(match[1]);const order=(await db.all<EstateOrder>(`SELECT ${orderColumns} FROM estate_orders WHERE workspace_id=? AND id=?`,[workspace,id]))[0];
      if(!order||!permittedEstateBlocks(access.role).some(block=>block.id===order.block_id))throw new EstateError(404,'Work order not found in this area view.');
      if(request.method==='GET'){order.events=await db.all<EstateEvent>('SELECT id,order_id,action,body,actor,created_at FROM estate_events WHERE workspace_id=? AND order_id=? ORDER BY created_at,id',[workspace,id]);return json(order);}
      if(request.method==='PATCH'){
        writeAccess(access);const body=await readPayload(request),note=text(body.note,'Evidence note',12,1200);
        if(!Number.isInteger(body.version)||body.version!==order.version)throw new EstateError(409,'This order changed. Reload its latest version before saving.');
        const status=body.status as EstateOrderStatus;
        if(!transitions[order.status].includes(status))throw new EstateError(400,'Follow the workflow: open → in progress → completed → verified. Completed orders can return for rework; verified orders can reopen.');
        const assignee=text(body.assignee,'Assigned demo team',3,100);
        const mutation=crypto.randomUUID(),now=new Date().toISOString();
        const saved=await db.batch([
          {sql:'UPDATE estate_orders SET status=?,assignee=?,updated_at=?,version=version+1,mutation_id=? WHERE workspace_id=? AND id=? AND version=?',params:[status,assignee,now,mutation,workspace,id,body.version]},
          {sql:'INSERT INTO estate_events (id,workspace_id,order_id,action,body,actor,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM estate_orders WHERE workspace_id=? AND id=? AND mutation_id=?)',params:[mutation,workspace,id,status,note,'Estate manager (demo)',now,workspace,id,mutation]},
        ]);
        if(!saved[0].changes)throw new EstateError(409,'This order changed. Reload its latest version before saving.');
        return json({ok:true,version:order.version+1});
      }
    }
    if(path==='/api/estate/report.csv'&&request.method==='GET'){
      const data=await overview(db,access,url),rows:unknown[][]=[['block','street','town','public_hdb_units','from_sgt','to_sgt','recorded_common_load_kwh','recorded_solar_kwh','derived_grid_import_kwh','derived_solar_export_kwh','common_load_kwh_per_unit','coverage_percent','estimated_grid_cost_sgd','estimated_grid_co2_kg','ema_gef_year','ema_gef_kg_co2_per_kwh','tariff_sgd_per_kwh','energy_data_type','inventory_source','inventory_retrieved_at']];
      for(const block of data.blocks)rows.push([block.block,block.street,block.town,block.units,data.from,data.to,block.load,block.solar,block.grid??'',block.exported??'',block.kwhPerUnit??'',block.coverage,block.cost??'',block.co2Kg??'',estatePolicy.gridFactorYear,estatePolicy.gridFactor,estatePolicy.tariff,'SIMULATED — independent portfolio pilot',hdbCatalogue.source_url,hdbCatalogue.retrieved_at]);
      return csvResponse(rows,`meterwise-estate-${data.from}-${data.to}.csv`);
    }
    throw new EstateError(404,'Estate action not found.');
  }catch(error){if(error instanceof EstateError)return json({error:error.message},error.status);throw error;}
}
