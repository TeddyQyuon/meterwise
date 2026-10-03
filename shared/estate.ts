import {hdbCatalogue} from './hdb-data.js';
import {addDays,dayStart,dateRange,round,singaporeDate} from './analytics.js';
import type {Meter,Reading,Role} from './types.js';

export type Service = 'lighting'|'lifts'|'pumps'|'solar';
export const serviceLabels:Record<Service,string>={lighting:'Common-area lighting',lifts:'Lifts',pumps:'Water pumps',solar:'Rooftop solar'};
export type EstateBlock={id:string;town:string;block:string;street:string;units:number;floors:number;completed:number;source_record_id:number};
export const estateBlocks:EstateBlock[]=hdbCatalogue.blocks.map(block=>({...block}));
export type EstateMeter=Meter & {block_id:string;service:Service};
export const estateMeters:EstateMeter[]=estateBlocks.flatMap((block,index)=>(['lighting','lifts','pumps','solar'] as Service[]).map(service=>({
  id:`${block.id}-${service.toUpperCase()}`,name:serviceLabels[service],block_id:block.id,service,
  tenant_id:block.town,location:`Blk ${block.block} ${block.street}`,interval_minutes:60,
  threshold_kwh:service==='lighting'?7+index:service==='lifts'?10+index:service==='pumps'?5+index:60,
})));
export const estatePolicy={tariff:0.285,gridFactor:0.402,gridFactorYear:2024,timeZone:'Asia/Singapore',highPriorityHours:24,otherPriorityHours:72};
export type EstateOrderStatus='open'|'in_progress'|'completed'|'verified';
export type EstateOrder={id:string;block_id:string;meter_id:string;title:string;priority:'high'|'medium'|'low';status:EstateOrderStatus;assignee:string;due_at:string;created_at:string;updated_at:string;version:number;events?:EstateEvent[]};
export type EstateEvent={id:string;order_id:string;action:string;body:string;actor:string;created_at:string};
export type EstateIssue={key:string;block_id:string;meter_id:string;kind:'missing'|'threshold';title:string;detail:string;priority:'high'|'medium'};
export type EnergyBalance={load:number;solar:number;grid:number|null;selfConsumed:number|null;exported:number|null;complete:boolean;received:number;expected:number;coverage:number};
export type EstateBlockSummary=EstateBlock & EnergyBalance & {kwhPerUnit:number|null;cost:number|null;co2Kg:number|null;issues:number};
export type EstateOverview={role:Role;from:string;to:string;bounds:{from:string;to:string};catalogue:EstateBlock[];meters:EstateMeter[];blocks:EstateBlockSummary[];metrics:EnergyBalance & {cost:number|null;co2Kg:number|null;change:number|null;units:number;openOrders:number;overdueOrders:number};chart:{date:string;label:string;load:number;solar:number;grid:number|null}[];services:{service:Service;kwh:number}[];issues:EstateIssue[];orders:EstateOrder[];policy:typeof estatePolicy;source:typeof hdbCatalogue};

// Sum each block/hour independently. Excess generation in one block/hour
// cannot cancel grid imports in another; no missing value is treated as zero.
export function energyBalance(readings:Reading[],meters:EstateMeter[],from:string,to:string):EnergyBalance{
  const groups=new Map<string,EstateMeter[]>();
  for(const meter of meters)groups.set(meter.block_id,[...(groups.get(meter.block_id)??[]),meter]);
  const start=dayStart(from),end=dayStart(addDays(to,1));
  const selected=readings.filter(row=>row.recorded_at>=new Date(start).toISOString()&&row.recorded_at<new Date(end).toISOString());
  const values=new Map(selected.map(row=>[`${row.meter_id}|${row.recorded_at}`,row.consumption_kwh]));
  let load=0,solar=0,grid=0,selfConsumed=0,exported=0,received=0;
  const expected=(end-start)/3_600_000*meters.length;
  for(const [blockId,assets] of groups){
    for(let time=start;time<end;time+=3_600_000){
      const timestamp=new Date(time).toISOString();let intervalLoad=0,intervalSolar=0,count=0;
      for(const meter of assets){const value=values.get(`${meter.id}|${timestamp}`);if(value===undefined)continue;count++;received++;if(meter.service==='solar')intervalSolar+=value;else intervalLoad+=value;}
      load+=intervalLoad;solar+=intervalSolar;
      if(count===assets.length){grid+=Math.max(0,intervalLoad-intervalSolar);selfConsumed+=Math.min(intervalLoad,intervalSolar);exported+=Math.max(0,intervalSolar-intervalLoad);}
    }
  }
  const complete=expected>0&&received===expected;
  return {load:round(load),solar:round(solar),grid:complete?round(grid):null,selfConsumed:complete?round(selfConsumed):null,exported:complete?round(exported):null,complete,received,expected,coverage:expected?round(received/expected*100,2):0};
}
export function calculateEstate(readings:Reading[],prior:Reading[],blocks:EstateBlock[],meters:EstateMeter[],from:string,to:string){
  const balance=energyBalance(readings,meters,from,to);
  const days=dateRange(from,to),priorTo=addDays(from,-1),priorFrom=addDays(priorTo,1-days.length);
  const previous=energyBalance(prior,meters,priorFrom,priorTo);
  const summaries:EstateBlockSummary[]=blocks.map(block=>{
    const result=energyBalance(readings,meters.filter(meter=>meter.block_id===block.id),from,to);
    return {...block,...result,kwhPerUnit:result.complete?round(result.load/block.units,2):null,cost:result.grid===null?null:round(result.grid*estatePolicy.tariff),co2Kg:result.grid===null?null:round(result.grid*estatePolicy.gridFactor),issues:0};
  });
  const chart=days.map(date=>{const point=energyBalance(readings,meters,date,date);return {date,label:new Intl.DateTimeFormat('en-SG',{day:'numeric',month:'short',timeZone:'Asia/Singapore'}).format(new Date(dayStart(date))),load:point.load,solar:point.solar,grid:point.grid};});
  const ids=new Set(meters.map(meter=>meter.id));
  const services=(['lighting','lifts','pumps','solar'] as Service[]).map(service=>({service,kwh:round(readings.filter(row=>ids.has(row.meter_id)&&meters.find(meter=>meter.id===row.meter_id)?.service===service).reduce((sum,row)=>sum+row.consumption_kwh,0))}));
  const change=balance.complete&&previous.complete&&previous.load>0?round((balance.load-previous.load)/previous.load*100,1):null;
  return {balance,summaries,chart,services,change};
}
export const permittedEstateBlocks=(role:Role)=>role==='manager'?estateBlocks:estateBlocks.filter(block=>block.town==='Ang Mo Kio');
export function estateIssues(readings:Reading[],meters:EstateMeter[],from:string,to:string):EstateIssue[]{
  const issues:EstateIssue[]=[];
  for(const meter of meters){
    const rows=readings.filter(row=>row.meter_id===meter.id),expected=dateRange(from,to).length*24;
    if(rows.length<expected)issues.push({key:`${meter.id}|missing`,block_id:meter.block_id,meter_id:meter.id,kind:'missing',title:'Missing meter intervals',detail:`${expected-rows.length} hourly intervals are missing. Restore data before estimating grid use or carbon.`,priority:'medium'});
    const spikes=rows.filter(row=>row.consumption_kwh>meter.threshold_kwh);
    if(meter.service!=='solar'&&spikes.length)issues.push({key:`${meter.id}|threshold`,block_id:meter.block_id,meter_id:meter.id,kind:'threshold',title:`${serviceLabels[meter.service]} above threshold`,detail:`${spikes.length} intervals exceeded ${meter.threshold_kwh} kWh. Latest: ${singaporeDate(spikes.at(-1)!.recorded_at)}. Inspect the asset; this rule does not diagnose a fault.`,priority:'high'});
  }
  return issues;
}
