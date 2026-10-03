import type {Database,Statement} from './database.js';
import {ensureWorkspace,sha256} from './seed.js';
import type {Role,Tenant,Meter,Reading,Session,Dashboard,EnergyAlert,AlertNote,ImportRecord} from '../shared/types.js';
import {TIMEZONE,addDays,dayStart,dateRange,previousRange,dailyChart,expectedIntervals,sumReadings,round,singaporeDate,csvCell} from '../shared/analytics.js';
import {validateCsv} from '../shared/csv.js';
import {MAX_REQUEST_BYTES,secureResponse} from './security.js';

class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
type Access={role:Role;tenant_id:string|null;workspace_id:string};
const json=(body:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const cookieToken=(request:Request)=>request.headers.get('Cookie')?.split(';').map(item=>item.trim()).find(item=>item.startsWith('mw_session='))?.slice(11);
const sessionCookie=(request:Request,token:string,age=604800)=>`mw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
function validDay(day:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(dayStart(day))||singaporeDate(dayStart(day))!==day)throw new ApiError(400,'Choose a valid calendar date.');return day;}
async function payload(request:Request):Promise<Record<string,unknown>>{
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new ApiError(415,'Send request data as application/json.');
  const tooLarge=()=>new ApiError(413,'The request is too large. Import CSV files smaller than 1 MB.');
  const length=request.headers.get('Content-Length');
  if(length&&Number(length)>MAX_REQUEST_BYTES)throw tooLarge();
  const chunks:Uint8Array[]=[];let bytes=0;
  const reader=request.body?.getReader();
  if(reader)try{
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>MAX_REQUEST_BYTES){await reader.cancel();throw tooLarge();}chunks.push(chunk.value);}
  }finally{reader.releaseLock();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  try{
    const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Expected object');
    return body as Record<string,unknown>;
  }catch{throw new ApiError(400,'Request data must be a valid JSON object encoded as UTF-8.');}
}
function reportingRange(from:string,to:string){try{return dateRange(from,to);}catch{throw new ApiError(400,'Choose a date range between 1 and 366 days.');}}
function manager(access:Access){if(access.role!=='manager')throw new ApiError(403,'Only a facilities manager can make this change.');}
async function workspaceMeters(db:Database,workspace:string){return db.all<Meter>('SELECT id,name,tenant_id,location,threshold_kwh,interval_minutes FROM meters WHERE workspace_id=? ORDER BY id',[workspace]);}
async function workspaceTenants(db:Database,workspace:string){return db.all<Tenant>('SELECT id,name,floor,color FROM tenants WHERE workspace_id=? ORDER BY id',[workspace]);}
function scopeMeters(meters:Meter[],access:Access,tenantFilter?:string|null,meterFilter?:string|null){
  if(access.role==='tenant'&&tenantFilter&&tenantFilter!=='all'&&tenantFilter!==access.tenant_id)throw new ApiError(403,'This tenant is outside your view.');
  let scoped=meters.filter(meter=>access.role==='manager'||meter.tenant_id===access.tenant_id);
  if(tenantFilter&&tenantFilter!=='all')scoped=scoped.filter(meter=>meter.tenant_id===tenantFilter);
  if(meterFilter){if(!scoped.some(meter=>meter.id===meterFilter))throw new ApiError(404,'Meter not found in this view.');scoped=scoped.filter(meter=>meter.id===meterFilter);}
  return scoped;
}
async function sessionInfo(db:Database,access:Access):Promise<Session>{
  const [workspaces,tenants,meters,bounds]=await Promise.all([
    db.all<{name:string;tariff:number}>('SELECT name,tariff FROM workspaces WHERE id=?',[access.workspace_id]),
    workspaceTenants(db,access.workspace_id),workspaceMeters(db,access.workspace_id),
    db.all<{first:string|null;last:string|null}>('SELECT MIN(recorded_at) AS first,MAX(recorded_at) AS last FROM readings WHERE workspace_id=?',[access.workspace_id])
  ]);
  const permitted=scopeMeters(meters,access);
  const ids=new Set(permitted.map(meter=>meter.tenant_id));
  return {role:access.role,tenantId:access.tenant_id,workspace:{name:workspaces[0].name,tariff:workspaces[0].tariff,timezone:TIMEZONE},tenants:tenants.filter(tenant=>ids.has(tenant.id)),meters:permitted,bounds:{from:singaporeDate(bounds[0].first??Date.now()),to:singaporeDate(bounds[0].last??Date.now())}};
}
async function scopedReadings(db:Database,workspace:string,meters:Meter[],from:string,to:string){
  if(!meters.length)return [];
  return db.all<Reading>(`SELECT meter_id,recorded_at,consumption_kwh FROM readings WHERE workspace_id=? AND recorded_at>=? AND recorded_at<? AND meter_id IN (${meters.map(()=>'?').join(',')}) ORDER BY recorded_at`,[workspace,new Date(dayStart(from)).toISOString(),new Date(dayStart(addDays(to,1))).toISOString(),...meters.map(meter=>meter.id)]);
}
async function dashboard(db:Database,access:Access,url:URL):Promise<Dashboard>{
  const info=await sessionInfo(db,access);
  const to=validDay(url.searchParams.get('to')??info.bounds.to);
  const from=validDay(url.searchParams.get('from')??addDays(to,-6));
  reportingRange(from,to);
  const previous=previousRange(from,to);
  const meters=scopeMeters(info.meters,access,url.searchParams.get('tenant'),url.searchParams.get('meter'));
  const [readings,previousReadings,allAlerts,latest]=await Promise.all([
    scopedReadings(db,access.workspace_id,meters,from,to),scopedReadings(db,access.workspace_id,meters,previous.from,previous.to),
    db.all<EnergyAlert>('SELECT id,meter_id,type,title,detail,severity,status,recorded_at FROM alerts WHERE workspace_id=? ORDER BY recorded_at DESC',[access.workspace_id]),
    db.all<{meter_id:string;last:string}>('SELECT meter_id,MAX(recorded_at) AS last FROM readings WHERE workspace_id=? GROUP BY meter_id',[access.workspace_id])
  ]);
  const permitted=new Set(meters.map(meter=>meter.id));
  const alerts=allAlerts.filter(alert=>permitted.has(alert.meter_id));
  const expected=expectedIntervals(meters,from,to);
  const kwh=sumReadings(readings),prior=sumReadings(previousReadings);
  const chart=dailyChart(readings,previousReadings,from,to).map(point=>({...point,cost:round(point.kwh*info.workspace.tariff)}));
  const detail=meters.map(meter=>{
    const rows=readings.filter(reading=>reading.meter_id===meter.id);
    const count=expectedIntervals([meter],from,to);
    return {...meter,tenant_name:info.tenants.find(tenant=>tenant.id===meter.tenant_id)?.name??'',kwh:sumReadings(rows),coverage:count?round(Math.min(100,rows.length/count*100),1):100,expected:count,actual:rows.length,last_reading:latest.find(item=>item.meter_id===meter.id)?.last??null,active_alerts:alerts.filter(alert=>alert.meter_id===meter.id&&alert.status!=='resolved').length};
  });
  const tenants=info.tenants.filter(tenant=>meters.some(meter=>meter.tenant_id===tenant.id)).map(tenant=>{
    const group=detail.filter(meter=>meter.tenant_id===tenant.id),usage=round(group.reduce((total,meter)=>total+meter.kwh,0)),expectedCount=group.reduce((total,meter)=>total+meter.expected,0),actual=group.reduce((total,meter)=>total+meter.actual,0);
    return {...tenant,kwh:usage,cost:round(usage*info.workspace.tariff),meters:group.length,coverage:expectedCount?round(Math.min(100,actual/expectedCount*100),1):100};
  }).sort((a,b)=>b.kwh-a.kwh);
  return {from,to,tariff:info.workspace.tariff,timezone:TIMEZONE,metrics:{kwh,cost:round(kwh*info.workspace.tariff),change:prior?round((kwh-prior)/prior*100,1):null,coverage:expected?round(Math.min(100,readings.length/expected*100),1):100,expected,actual:readings.length,missing:Math.max(0,expected-readings.length),openAlerts:alerts.filter(alert=>alert.status!=='resolved').length},chart,tenants,meters:detail,alerts};
}
async function previewImport(db:Database,access:Access,csv:string){
  const meters=await workspaceMeters(db,access.workspace_id);
  const validate=(existing:Set<string>)=>{try{return validateCsv(csv,meters,existing);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'The CSV file could not be read.');}};
  const candidates=validate(new Set());
  const existing=new Set<string>();
  // Query only the validated candidate intervals, never the building's entire history.
  // Forty pairs plus the workspace keep each statement below D1's 100-bind limit.
  for(let start=0;start<candidates.readings.length;start+=40){
    const rows=candidates.readings.slice(start,start+40);
    const matches=await db.all<Reading>(`SELECT meter_id,recorded_at FROM readings WHERE workspace_id=? AND (${rows.map(()=>'(meter_id=? AND recorded_at=?)').join(' OR ')})`,[access.workspace_id,...rows.flatMap(row=>[row.meter_id,row.recorded_at])]);
    for(const row of matches)existing.add(`${row.meter_id}|${row.recorded_at}`);
  }
  return existing.size?validate(existing):candidates;
}

type ApiOptions={platformIdentity?:boolean;trustedOrigins?:readonly string[];provisionWorkspace?:(db:Database,workspaceId:string)=>Promise<boolean>};
export async function handleApi(request:Request,db:Database,owner:string|null,options:ApiOptions={}):Promise<Response>{
  return secureResponse(await routeApi(request,db,owner,options),request.url);
}
async function routeApi(request:Request,db:Database,owner:string|null,options:ApiOptions):Promise<Response>{
  try{
    const url=new URL(request.url),path=url.pathname,method=request.method;
    if(path==='/api/health')return json({ok:true,app:'MeterWise',version:'1.2.0'});
    if(!owner)throw new ApiError(401,'Sign in to access your MeterWise workspace.');
    if(!['GET','HEAD','OPTIONS'].includes(method)){
      const origin=request.headers.get('Origin');
      if((origin&&origin!==url.origin&&!options.trustedOrigins?.includes(origin))||(!origin&&request.headers.get('Sec-Fetch-Site')==='cross-site'))throw new ApiError(403,'This request must come from MeterWise.');
    }
    const workspaceId=(await sha256(owner)).slice(0,24);
    if(path==='/api/session'&&method==='POST'){
      const body=await payload(request);
      if(body.role!=='manager'&&body.role!=='tenant')throw new ApiError(400,'Choose a manager or tenant demo view.');
      if(options.provisionWorkspace&&!await options.provisionWorkspace(db,workspaceId))throw new ApiError(503,'The demo is at capacity. Please contact the portfolio owner.');
      await ensureWorkspace(db,workspaceId);
      const tenantId=body.role==='tenant'?'T01':null;
      // A private hosted Site already has trusted platform identity. Persist its
      // demo role server-side so iframe third-party cookie policies cannot break it.
      const token=options.platformIdentity?`platform-demo:${owner}`:crypto.randomUUID()+crypto.randomUUID();
      await db.run('DELETE FROM sessions WHERE expires_at<?',[Date.now()]);
      const oldToken=options.platformIdentity?token:cookieToken(request);if(oldToken)await db.run('DELETE FROM sessions WHERE token_hash=? AND workspace_id=?',[await sha256(oldToken),workspaceId]);
      await db.run('INSERT INTO sessions (token_hash,workspace_id,role,tenant_id,expires_at) VALUES (?,?,?,?,?)',[await sha256(token),workspaceId,body.role,tenantId,Date.now()+604800000]);
      return json(await sessionInfo(db,{role:body.role,tenant_id:tenantId,workspace_id:workspaceId}),200,options.platformIdentity?{}:{'Set-Cookie':sessionCookie(request,token)});
    }
    const token=options.platformIdentity?`platform-demo:${owner}`:cookieToken(request);
    if(!token)throw new ApiError(401,'Your demo session has expired. Reload to continue.');
    const sessions=await db.all<Access>('SELECT workspace_id,role,tenant_id FROM sessions WHERE token_hash=? AND workspace_id=? AND expires_at>?',[await sha256(token),workspaceId,Date.now()]);
    const access=sessions[0];if(!access)throw new ApiError(401,'Your demo session has expired. Reload to continue.');
    if(path==='/api/session'&&method==='GET')return json(await sessionInfo(db,access));
    if(path==='/api/dashboard'&&method==='GET')return json(await dashboard(db,access,url));
    if(path==='/api/imports'&&method==='GET'){manager(access);return json(await db.all<ImportRecord>('SELECT id,file_name,accepted,skipped,rejected,created_at FROM imports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30',[workspaceId]));}
    if(path==='/api/imports/preview'&&method==='POST'){manager(access);const body=await payload(request);if(typeof body.csv!=='string')throw new ApiError(400,'Choose a CSV file.');return json(await previewImport(db,access,body.csv));}
    if(path==='/api/imports/commit'&&method==='POST'){
      manager(access);const body=await payload(request);
      if(typeof body.csv!=='string'||typeof body.fileName!=='string'||!body.fileName.trim()||body.fileName.length>180||/[\x00-\x1f\x7f/\\]/.test(body.fileName))throw new ApiError(400,'Choose a CSV file with a plain filename of 1–180 characters.');
      const importId=`${workspaceId}|${(await sha256(body.csv)).slice(0,32)}`;
      const prior=await db.all<ImportRecord>('SELECT id,file_name,accepted,skipped,rejected,created_at FROM imports WHERE id=?',[importId]);
      if(prior[0])return json({...prior[0],alreadyImported:true});
      const preview=await previewImport(db,access,body.csv);
      if(!preview.valid)throw new ApiError(400,'No new valid readings to import. Fix the errors or choose another file.');
      const now=new Date().toISOString();
      const statements:Statement[]=preview.readings.map(row=>({sql:'INSERT OR IGNORE INTO readings (id,workspace_id,meter_id,recorded_at,consumption_kwh) VALUES (?,?,?,?,?)',params:[`${workspaceId}|${row.meter_id}|${row.recorded_at}`,workspaceId,row.meter_id,row.recorded_at,row.consumption_kwh]}));
      statements.push({sql:'INSERT OR IGNORE INTO imports (id,workspace_id,file_name,accepted,skipped,rejected,created_at) VALUES (?,?,?,?,?,?,?)',params:[importId,workspaceId,body.fileName,preview.valid,preview.duplicate,preview.invalid,now]});
      const results=await db.batch(statements);
      const inserted=results.slice(0,preview.readings.length).reduce((total,result)=>total+result.changes,0);
      if(results[results.length-1].changes)await db.run('UPDATE imports SET accepted=?,skipped=? WHERE id=?',[inserted,preview.duplicate+preview.valid-inserted,importId]);
      const meters=await workspaceMeters(db,workspaceId);
      const spikeStatements:Statement[]=[];
      for(const row of preview.readings){const meter=meters.find(meter=>meter.id===row.meter_id)!;if(row.consumption_kwh>meter.threshold_kwh)spikeStatements.push({sql:'INSERT OR IGNORE INTO alerts (id,workspace_id,meter_id,type,title,detail,severity,status,recorded_at) VALUES (?,?,?,?,?,?,?,?,?)',params:[`${workspaceId}|${row.meter_id}|${row.recorded_at}|spike`,workspaceId,row.meter_id,'consumption_spike','Consumption above the meter threshold',`${meter.name} used ${row.consumption_kwh} kWh in one interval, above its configured ${meter.threshold_kwh} kWh threshold. This alert is based on a rule, not an AI prediction.`,'high','open',row.recorded_at]});}
      if(spikeStatements.length)await db.batch(spikeStatements);
      // Close a seeded data-gap alert only when every expected interval has been restored.
      const gaps=await db.all<EnergyAlert>('SELECT id,meter_id,recorded_at FROM alerts WHERE workspace_id=? AND type=? AND status<>?',[workspaceId,'missing_data','resolved']);
      for(const gap of gaps){const day=singaporeDate(gap.recorded_at);const meter=meters.find(item=>item.id===gap.meter_id)!;const rows=await scopedReadings(db,workspaceId,[meter],day,day);if(rows.length>=expectedIntervals([meter],day,day))await db.batch([{sql:'UPDATE alerts SET status=? WHERE id=? AND workspace_id=?',params:['resolved',gap.id,workspaceId]},{sql:'INSERT INTO notes (id,workspace_id,alert_id,body,author,created_at) VALUES (?,?,?,?,?,?)',params:[crypto.randomUUID(),workspaceId,gap.id,'All expected intervals were restored by a CSV import.','MeterWise',now]}]);}
      const record=(await db.all<ImportRecord>('SELECT id,file_name,accepted,skipped,rejected,created_at FROM imports WHERE id=?',[importId]))[0];
      return json(record,201);
    }
    if(path==='/api/sample.csv'&&method==='GET'){
      manager(access);const meters=await workspaceMeters(db,workspaceId);
      const bounds=await db.all<{last:string}>('SELECT MAX(recorded_at) AS last FROM readings WHERE workspace_id=?',[workspaceId]);
      const day=singaporeDate(bounds[0].last);
      const rows=['meter_id,timestamp,consumption_kwh',...Array.from({length:8},(_,i)=>`MW-006,${day}T${String(i+3).padStart(2,'0')}:00:00+08:00,4.20`)];
      void meters;
      return new Response(rows.join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="meterwise-sample-readings.csv"','Cache-Control':'no-store'}});
    }
    const meterMatch=path.match(/^\/api\/meters\/([^/]+)$/);
    if(meterMatch&&method==='PATCH'){
      manager(access);const id=decodeURIComponent(meterMatch[1]),body=await payload(request),tenants=await workspaceTenants(db,workspaceId);
      if(!tenants.some(tenant=>tenant.id===body.tenantId)||typeof body.threshold!=='number'||!Number.isFinite(body.threshold)||body.threshold<0.1||body.threshold>100000)throw new ApiError(400,'Choose a registered tenant and a threshold between 0.1 and 100,000 kWh.');
      const found=await db.all('SELECT id FROM meters WHERE workspace_id=? AND id=?',[workspaceId,id]);if(!found.length)throw new ApiError(404,'Meter not found.');
      await db.run('UPDATE meters SET tenant_id=?,threshold_kwh=? WHERE workspace_id=? AND id=?',[body.tenantId,body.threshold,workspaceId,id]);
      return json({ok:true});
    }
    const alertMatch=path.match(/^\/api\/alerts\/([^/]+)$/);
    if(alertMatch){
      const id=decodeURIComponent(alertMatch[1]);
      const rows=await db.all<EnergyAlert>('SELECT id,meter_id,type,title,detail,severity,status,recorded_at FROM alerts WHERE workspace_id=? AND id=?',[workspaceId,id]);
      const alert=rows[0];
      const meters=scopeMeters(await workspaceMeters(db,workspaceId),access);
      if(!alert||!meters.some(meter=>meter.id===alert.meter_id))throw new ApiError(404,'Alert not found in this view.');
      if(method==='GET'){alert.notes=await db.all<AlertNote>('SELECT id,alert_id,body,author,created_at FROM notes WHERE workspace_id=? AND alert_id=? ORDER BY created_at',[workspaceId,id]);return json(alert);}
      if(method==='PATCH'){
        manager(access);const body=await payload(request);
        if(typeof body.status!=='string'||!['open','investigating','resolved'].includes(body.status)||typeof body.note!=='string'||body.note.length>1000)throw new ApiError(400,'Choose a valid status and keep the note under 1,000 characters.');
        const note=body.note.trim();
        if(body.status==='resolved'&&note.length<3)throw new ApiError(400,'Add an investigation note before resolving this alert.');
        if(!note&&body.status===alert.status)throw new ApiError(400,'Add a note or change the status.');
        await db.batch([{sql:'UPDATE alerts SET status=? WHERE workspace_id=? AND id=?',params:[body.status,workspaceId,id]},{sql:'INSERT INTO notes (id,workspace_id,alert_id,body,author,created_at) VALUES (?,?,?,?,?,?)',params:[crypto.randomUUID(),workspaceId,id,note||`Status changed to ${body.status}.`,'Facilities manager',new Date().toISOString()]}]);
        return json({ok:true});
      }
    }
    if(path==='/api/reports.csv'&&method==='GET'){
      const data=await dashboard(db,access,url);
      const readings=await scopedReadings(db,workspaceId,data.meters,data.from,data.to);
      const rows:unknown[][]=[['date_sgt','meter_id','meter_name','tenant','consumption_kwh','estimated_cost_sgd','received_intervals','expected_intervals','coverage_percent','tariff_sgd_per_kwh']];
      for(const day of dateRange(data.from,data.to))for(const meter of data.meters){const slice=readings.filter(row=>row.meter_id===meter.id&&singaporeDate(row.recorded_at)===day),kwh=sumReadings(slice),expected=expectedIntervals([meter],day,day);rows.push([day,meter.id,meter.name,meter.tenant_name,kwh,round(kwh*data.tariff),slice.length,expected,expected?round(Math.min(100,slice.length/expected*100),1):100,data.tariff]);}
      return new Response(rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="meterwise-report-${data.from}-${data.to}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    throw new ApiError(404,'This page or action was not found.');
  }catch(error){
    if(error instanceof ApiError)return json({error:error.message},error.status);
    if(error instanceof URIError)return json({error:'The requested identifier could not be read.'},400);
    console.error('MeterWise request failed',error instanceof Error?error.message:'Unknown error');
    return json({error:'MeterWise could not complete this request. Your file or note has been kept so you can try again.'},503);
  }
}
