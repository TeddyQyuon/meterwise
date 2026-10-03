import type {Database,Statement} from './database.js';
import type {Meter,Tenant,Reading,EnergyAlert} from '../shared/types.js';
import {addDays,dayStart,singaporeDate,round} from '../shared/analytics.js';
export const demoTenants:Tenant[]=[
  {id:'T01',name:'Northstar Studio',floor:'Level 2',color:'#267765'},
  {id:'T02',name:'Juniper Labs',floor:'Level 3',color:'#68a38a'},
  {id:'T03',name:'Atlas Digital',floor:'Level 4',color:'#a3bcb0'},
  {id:'T04',name:'Shared areas',floor:'Building-wide',color:'#c5dac9'}
];
export const demoMeters:Meter[]=[
  {id:'MW-001',name:'Studio main',tenant_id:'T01',location:'Level 2 · East wing',threshold_kwh:18,interval_minutes:60},
  {id:'MW-002',name:'Studio air conditioning',tenant_id:'T01',location:'Level 2 · Plant room',threshold_kwh:20,interval_minutes:60},
  {id:'MW-003',name:'Labs main',tenant_id:'T02',location:'Level 3 · West wing',threshold_kwh:22,interval_minutes:60},
  {id:'MW-004',name:'Digital main',tenant_id:'T03',location:'Level 4 · East wing',threshold_kwh:18,interval_minutes:60},
  {id:'MW-005',name:'Common lighting',tenant_id:'T04',location:'Lobby & corridors',threshold_kwh:12,interval_minutes:60},
  {id:'MW-006',name:'Building services',tenant_id:'T04',location:'Basement · Services',threshold_kwh:16,interval_minutes:60}
];
export function makeDemoData(endDay = addDays(singaporeDate(Date.now()),-1)) {
  const readings:Reading[]=[];
  for(let day=0;day<30;day++){
    const date=addDays(endDay,day-29);
    const weekday=new Date(`${date}T12:00:00+08:00`).getUTCDay();
    for(let meterIndex=0;meterIndex<demoMeters.length;meterIndex++)for(let hour=0;hour<24;hour++){
      const meter=demoMeters[meterIndex];
      if(meter.id==='MW-006'&&date===endDay&&hour>=3&&hour<11)continue;
      const workHours=hour>=8&&hour<19;
      const weekend=weekday===0||weekday===6;
      const base=[8.8,10.2,12.5,7.6,3.8,6.2][meterIndex];
      const noise=0.9+((day*17+hour*11+meterIndex*7)%23)/100;
      let consumption=base*(workHours?1:0.22)*(weekend?0.64:1)*noise*(1-day*0.0025);
      if(meter.id==='MW-002'&&date===addDays(endDay,-2)&&hour===22)consumption=28.4;
      if(meter.id==='MW-003'&&date===addDays(endDay,-1)&&hour===11)consumption=27.6;
      readings.push({meter_id:meter.id,recorded_at:new Date(dayStart(date)+hour*3_600_000).toISOString(),consumption_kwh:round(consumption)});
    }
  }
  const alerts:Omit<EnergyAlert,'id'>[]=[
    {meter_id:'MW-002',type:'consumption_spike',title:'Unusual after-hours consumption',detail:'Studio air conditioning used 28.4 kWh between 22:00 and 23:00 SGT. This exceeds its configured 20 kWh interval threshold. Check the operating schedule and equipment.',severity:'high',status:'open',recorded_at:new Date(dayStart(addDays(endDay,-2))+22*3_600_000).toISOString()},
    {meter_id:'MW-006',type:'missing_data',title:'Eight readings are missing',detail:'Building services has no readings from 03:00 to 11:00 SGT on the latest complete day. Check connectivity or import the missing hourly intervals.',severity:'medium',status:'open',recorded_at:new Date(dayStart(endDay)+3*3_600_000).toISOString()},
    {meter_id:'MW-003',type:'consumption_spike',title:'Consumption above the meter threshold',detail:'Labs main used 27.6 kWh between 11:00 and 12:00 SGT. This exceeds its configured 22 kWh interval threshold.',severity:'medium',status:'investigating',recorded_at:new Date(dayStart(addDays(endDay,-1))+11*3_600_000).toISOString()}
  ];
  return {readings,alerts,endDay};
}
export async function sha256(value:string){const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');}
const initializations=new Map<string,Promise<void>>();
export async function ensureWorkspace(db:Database,workspaceId:string){
  const current=await db.all<{seeded:number}>('SELECT seeded FROM workspaces WHERE id=?',[workspaceId]);
  if(current[0]?.seeded)return;
  if(initializations.has(workspaceId))return initializations.get(workspaceId);
  const initialization=(async()=>{
    await db.run('INSERT OR IGNORE INTO workspaces (id,name,tariff,seeded,created_at) VALUES (?,?,?,?,?)',[workspaceId,'Harbour One',0.285,0,new Date().toISOString()]);
    const statements:Statement[]=[];
    for(const tenant of demoTenants)statements.push({sql:'INSERT OR IGNORE INTO tenants (key,workspace_id,id,name,floor,color) VALUES (?,?,?,?,?,?)',params:[`${workspaceId}|${tenant.id}`,workspaceId,tenant.id,tenant.name,tenant.floor,tenant.color]});
    for(const meter of demoMeters)statements.push({sql:'INSERT OR IGNORE INTO meters (key,workspace_id,id,name,tenant_id,location,threshold_kwh,interval_minutes) VALUES (?,?,?,?,?,?,?,?)',params:[`${workspaceId}|${meter.id}`,workspaceId,meter.id,meter.name,meter.tenant_id,meter.location,meter.threshold_kwh,meter.interval_minutes]});
    const {readings,alerts}=makeDemoData();
    for(let start=0;start<readings.length;start+=12){
      const chunk=readings.slice(start,start+12);
      statements.push({sql:`INSERT OR IGNORE INTO readings (id,workspace_id,meter_id,recorded_at,consumption_kwh) VALUES ${chunk.map(()=>'(?,?,?,?,?)').join(',')}`,params:chunk.flatMap(row=>[`${workspaceId}|${row.meter_id}|${row.recorded_at}`,workspaceId,row.meter_id,row.recorded_at,row.consumption_kwh])});
    }
    for(const [i,alert] of alerts.entries())statements.push({sql:'INSERT OR IGNORE INTO alerts (id,workspace_id,meter_id,type,title,detail,severity,status,recorded_at) VALUES (?,?,?,?,?,?,?,?,?)',params:[`${workspaceId}|demo-alert-${i+1}`,workspaceId,alert.meter_id,alert.type,alert.title,alert.detail,alert.severity,alert.status,alert.recorded_at]});
    statements.push({sql:'INSERT OR IGNORE INTO notes (id,workspace_id,alert_id,body,author,created_at) VALUES (?,?,?,?,?,?)',params:[`${workspaceId}|demo-note-1`,workspaceId,`${workspaceId}|demo-alert-3`,'Checking whether lab equipment was left running during the lunch break.','Facilities manager',new Date().toISOString()]});
    for(let start=0;start<statements.length;start+=80)await db.batch(statements.slice(start,start+80));
    await db.run('UPDATE workspaces SET seeded=1 WHERE id=?',[workspaceId]);
  })();
  initializations.set(workspaceId,initialization);
  try{await initialization;}finally{initializations.delete(workspaceId);}
}
