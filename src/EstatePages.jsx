import {useState,useEffect,useCallback,useRef} from 'react';
import {Zap,Building2,LayoutDashboard,UploadCloud,ClipboardCheck,FileBarChart2,BookOpen,ArrowUpRight,ArrowRight,Download,RefreshCw,Menu,X,Sun,Leaf,Activity,TriangleAlert,CheckCircle2,LoaderCircle,Eye,Plus,Search,Info,ShieldCheck,ChevronRight,Sparkles,ExternalLink,ChevronDown,Compass} from 'lucide-react';
import {serviceLabels} from '../shared/estate';
import {addDays,dayStart} from '../shared/analytics';
import {estateApi,postEstate} from './estate-api';
import {number,money,date,stamp,statusLabel,nextStatus,Pill,Panel,Dialog} from './estate-ui';

export function BlocksPage({data,onChoose,canWrite,onRefresh}){
  const [search,setSearch]=useState('');
  const [addBlockOpen,setAddBlockOpen]=useState(false);
  const [addMeterOpen,setAddMeterOpen]=useState(false);
  const shown=data.blocks.filter(block=>`${block.block} ${block.street} ${block.town}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className="estate-block-highlights"><div><Building2 size={24}/><strong>{data.blocks.length}</strong><span>Public HDB building records</span></div><div><Zap size={24}/><strong>{data.meters.length}</strong><span>Simulated service meters</span></div><div><Activity size={24}/><strong>{data.metrics.units}</strong><span>Dwelling units from public data</span></div></div><Panel title="Block register" subtitle="Building information comes from HDB Property Information. Equipment is simulated." action={<div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><label className="estate-search"><Search size={16}/><input aria-label="Search estate blocks" placeholder="Search block or street" value={search} onChange={event=>setSearch(event.target.value)}/></label>{canWrite&&<><button type="button" className="button primary" onClick={()=>setAddBlockOpen(true)}><Plus size={16}/><span>Add Block</span></button><button type="button" className="button secondary" onClick={()=>setAddMeterOpen(true)}><Plus size={16}/><span>Add Meter</span></button></>}</div>}><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable estate data table"><table><thead><tr><th>Block & street</th><th>Town</th><th>Units / floors</th><th>Completed</th><th>Demo asset IDs</th><th>Action</th></tr></thead><tbody>{shown.map(block=><tr key={block.id}><td><strong>Blk {block.block}</strong><small className="table-sub">{block.street}</small></td><td>{block.town}</td><td>{block.units} / {block.floors}</td><td>{block.completed}</td><td>{data.meters.filter(meter=>meter.block_id===block.id).map(meter=><span className="estate-asset-id" key={meter.id}>{meter.id}</span>)}</td><td><button className="text-button" onClick={()=>onChoose(block.id)}>View block <ArrowUpRight size={14}/></button></td></tr>)}</tbody></table></div>{!shown.length&&<div className="estate-empty">No blocks match this search.</div>}</Panel><div className="estate-notice"><Info size={19}/><span>The public inventory does not describe these blocks’ actual installed solar systems, meter readings or maintenance conditions. All equipment and exceptions in this pilot are simulated.</span></div>
    {addBlockOpen&&<AddBlockDialog onClose={()=>setAddBlockOpen(false)} onRefresh={onRefresh}/>}
    {addMeterOpen&&<AddMeterDialog blocks={data.blocks} onClose={()=>setAddMeterOpen(false)} onRefresh={onRefresh}/>}
  </>;
}

function AddBlockDialog({onClose,onRefresh}){
  const [id,setId]=useState(''),[town,setTown]=useState('Ang Mo Kio'),[block,setBlock]=useState(''),[street,setStreet]=useState(''),[units,setUnits]=useState(100),[floors,setFloors]=useState(12),[completed,setCompleted]=useState(2021);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');
    try{
      await estateApi('/estate/blocks',postEstate({
        id:id.trim().toUpperCase(),
        town:town.trim(),
        block:block.trim(),
        street:street.trim().toUpperCase(),
        units:Number(units),
        floors:Number(floors),
        completed:Number(completed)
      }));
      await onRefresh();
      onClose();
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  return <Dialog title="Add Registered Block" onClose={onClose}>
    <form onSubmit={submit} className="estate-form">
      <label>Block Identifier (e.g. B07)<input required minLength={2} maxLength={24} aria-label="Block Identifier" placeholder="B07" value={id} onChange={e=>setId(e.target.value)}/></label>
      <label>Town<input required minLength={2} maxLength={60} aria-label="Town" placeholder="Ang Mo Kio" value={town} onChange={e=>setTown(e.target.value)}/></label>
      <label>Block Number<input required minLength={1} maxLength={20} aria-label="Block Number" placeholder="412" value={block} onChange={e=>setBlock(e.target.value)}/></label>
      <label>Street Name<input required minLength={3} maxLength={120} aria-label="Street Name" placeholder="ANG MO KIO AVE 10" value={street} onChange={e=>setStreet(e.target.value)}/></label>
      <label>Dwelling Units<input type="number" min={1} max={2000} required aria-label="Dwelling Units" value={units} onChange={e=>setUnits(e.target.value)}/></label>
      <label>Floors<input type="number" min={1} max={100} required aria-label="Floors" value={floors} onChange={e=>setFloors(e.target.value)}/></label>
      <label>Year Completed<input type="number" min={1950} max={2035} required aria-label="Year Completed" value={completed} onChange={e=>setCompleted(e.target.value)}/></label>
      {error&&<p role="alert" className="estate-form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy?'Saving…':'Save Block'}</button></div>
    </form>
  </Dialog>;
}

function AddMeterDialog({blocks,onClose,onRefresh}){
  const defaultBlock = blocks[0]?.id || 'B01';
  const [id,setId]=useState(''),[blockId,setBlockId]=useState(defaultBlock),[service,setService]=useState('lighting'),[name,setName]=useState(''),[thresholdKwh,setThresholdKwh]=useState(10),[readingMode,setReadingMode]=useState('interval_kwh'),[multiplier,setMultiplier]=useState(1.0);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');
    try{
      await estateApi('/estate/meters',postEstate({
        id:id.trim().toUpperCase(),
        blockId,
        service,
        name:name.trim()||serviceLabels[service]||service,
        thresholdKwh:Number(thresholdKwh),
        readingMode,
        multiplier:Number(multiplier)
      }));
      await onRefresh();
      onClose();
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  return <Dialog title="Add Service Meter" onClose={onClose}>
    <form onSubmit={submit} className="estate-form">
      <label>Meter Identifier (e.g. B07-LIGHTING)<input required minLength={3} maxLength={40} aria-label="Meter Identifier" placeholder="B07-LIGHTING" value={id} onChange={e=>setId(e.target.value)}/></label>
      <label>Registered Block<select aria-label="Registered Block" value={blockId} onChange={e=>setBlockId(e.target.value)}>{blocks.map(b=><option key={b.id} value={b.id}>Blk {b.block} · {b.street} ({b.id})</option>)}</select></label>
      <label>Service Category<select aria-label="Service Category" value={service} onChange={e=>setService(e.target.value)}><option value="lighting">Common-area lighting</option><option value="lifts">Lifts</option><option value="pumps">Water pumps</option><option value="solar">Rooftop solar</option></select></label>
      <label>Meter Name (optional)<input maxLength={80} aria-label="Meter Name" placeholder={serviceLabels[service]||'Common-area lighting'} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Threshold (kWh / interval)<input type="number" step="0.1" min="0.1" max="100000" required aria-label="Threshold kWh" value={thresholdKwh} onChange={e=>setThresholdKwh(e.target.value)}/></label>
      <label>Reading Mode<select aria-label="Reading Mode" value={readingMode} onChange={e=>setReadingMode(e.target.value)}><option value="interval_kwh">Interval kWh (completed hourly interval)</option><option value="cumulative_register">Cumulative Register</option></select></label>
      <label>Multiplier<input type="number" step="0.001" min="0.001" max="10000" required aria-label="Multiplier" value={multiplier} onChange={e=>setMultiplier(e.target.value)}/></label>
      {error&&<p role="alert" className="estate-form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy?'Saving…':'Save Meter'}</button></div>
    </form>
  </Dialog>;
}

export function EstateImports({onSaved}){
  const [file,setFile]=useState(null),[csv,setCsv]=useState(''),[preview,setPreview]=useState(null),[history,setHistory]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useRef(null),selection=useRef(0);
  const loadHistory=useCallback(async()=>setHistory(await estateApi('/estate/imports')),[]);
  useEffect(()=>{void loadHistory().catch(error=>setError(error.message));},[loadHistory]);
  async function choose(candidate){const request=++selection.current;setFile(null);setCsv('');setPreview(null);setError('');if(!candidate)return;if(!candidate.name.toLowerCase().endsWith('.csv')||candidate.size>1_000_000){setError('Choose a .csv file smaller than 1 MB.');return;}setBusy(true);try{const text=await candidate.text();const result=await estateApi('/estate/imports/preview',postEstate({csv:text}));if(request===selection.current){setFile(candidate);setCsv(text);setPreview(result);}}catch(error){if(request===selection.current)setError(error.message);}finally{if(request===selection.current)setBusy(false);}}
  async function commit(){if(!file||!preview?.valid||busy)return;setBusy(true);setError('');try{await estateApi('/estate/imports/commit',postEstate({csv,fileName:file.name}));setFile(null);setCsv('');setPreview(null);if(input.current)input.current.value='';await loadHistory();await onSaved();}catch(error){setError(error.message);}finally{setBusy(false);}}
  return <><div className="estate-grid estate-import-grid"><Panel title="Validate an estate CSV" subtitle="Registered service meters · hourly interval consumption"><div className="estate-upload"><UploadCloud size={32}/><h3>Start with the gap-repair sample</h3><p>The sample restores two missing intervals. Preview first, then import only valid new readings.</p><input ref={input} type="file" accept=".csv,text/csv" aria-label="Choose estate CSV" disabled={busy} onChange={event=>void choose(event.target.files?.[0])}/><a className="text-button" href="/api/estate/sample.csv"><Download size={16}/>Download estate sample CSV</a></div>{error&&<div className="estate-form-error" role="alert">{error}</div>}{busy&&<div className="data-status" role="status"><LoaderCircle className="spin" size={16}/> Validating or saving…</div>}{preview&&<div className="estate-preview"><strong>{file?.name}</strong><div className="preview-stats"><div><strong>{preview.valid}</strong><span>Valid new readings</span></div><div><strong>{preview.duplicate}</strong><span>Duplicates</span></div><div><strong>{preview.invalid}</strong><span>Invalid rows</span></div></div>{preview.issues.length>0&&<div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable estate data table"><table><thead><tr><th>Line</th><th>Meter</th><th>Validation result</th></tr></thead><tbody>{preview.issues.slice(0,50).map((issue,index)=><tr key={index}><td>{issue.line}</td><td>{issue.meter}</td><td>{issue.message}</td></tr>)}</tbody></table></div>}<button className="button primary" disabled={busy||!preview.valid} onClick={()=>void commit()}>Import {preview.valid} estate readings <ArrowRight size={16}/></button></div>}</Panel><Panel title="Meter reading contract" subtitle="A completed interval, never a cumulative register"><div className="estate-contract"><code>meter_id,timestamp,consumption_kwh<br/>B01-LIGHTING,2026-10-01T10:00:00+08:00,1.67</code><ul><li>Lighting, lifts, pumps or solar meter IDs from the block register.</li><li>ISO timestamp with timezone; aligned to a completed hour.</li><li>Zero is valid. Negative, future and unknown-meter readings are rejected.</li><li>Only the 14-day demonstration period is accepted.</li><li>1 MB and 1,500 rows per file. Duplicate intervals stay unchanged.</li></ul><p>Use synthetic data only. This public demo has no actual agency or resident accounts.</p></div></Panel></div><Panel title="Saved import history" subtitle="Persistent in your browser’s Turso workspace"><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable estate data table"><table><thead><tr><th>File</th><th>Imported</th><th>Duplicates</th><th>Invalid</th><th>Saved at (SGT)</th></tr></thead><tbody>{history.map(record=><tr key={record.id}><td>{record.file_name}</td><td><Pill tone="green">{record.accepted}</Pill></td><td>{record.skipped}</td><td>{record.rejected}</td><td>{stamp(record.created_at)}</td></tr>)}</tbody></table></div>{!history.length&&<div className="estate-empty">Your first validated import will appear here.</div>}</Panel></>;
}

export function OrdersPage({data,onNew,onOpen,canWrite}){
  const [status,setStatus]=useState('all');const orders=data.orders.filter(order=>status==='all'||order.status===status);
  return <><div className="estate-workflow">{['open','in_progress','completed','verified'].map((status,index)=><div key={status}><span>{index+1}</span><strong>{statusLabel[status]}</strong><small>{index===0?'Triage & prioritise':index===1?'Assign a demo team':index===2?'Record completion evidence':'Review and verify'}</small></div>)}</div><Panel title="Maintenance queue" subtitle="Demo response targets: high priority 24 h; other priorities 72 h. No messages are sent." action={canWrite&&<button className="button primary" onClick={onNew}><Plus size={16}/>New work order</button>}><div className="estate-status-filters">{['all','open','in_progress','completed','verified'].map(value=><button key={value} className={status===value?'selected':''} aria-pressed={status===value} onClick={()=>setStatus(value)}>{value==='all'?'All orders':statusLabel[value]} <span>{data.orders.filter(order=>value==='all'||order.status===value).length}</span></button>)}</div>{orders.length?<div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable estate data table"><table><thead><tr><th>Work order</th><th>Asset</th><th>Priority</th><th>Status</th><th>Assigned demo team</th><th>Due (SGT)</th><th>Action</th></tr></thead><tbody>{orders.map(order=><tr key={order.id}><td><strong>{order.title}</strong><small className="table-sub">WO-{order.id.split('|').at(-1).slice(0,8)}</small></td><td>{order.meter_id}</td><td><Pill tone={order.priority==='high'?'red':'amber'}>{order.priority}</Pill></td><td><Pill tone={order.status==='verified'?'green':'blue'}>{statusLabel[order.status]}</Pill></td><td>{order.assignee||'Unassigned'}</td><td>{stamp(order.due_at)}</td><td><button className="text-button" onClick={()=>onOpen(order)} aria-label={`Review work order ${order.title}`}>Review <ChevronRight size={15}/></button></td></tr>)}</tbody></table></div>:<div className="estate-empty"><ClipboardCheck size={29}/><h3>No work orders in this status</h3><p>Create an inspection from a dashboard exception or add an order here.</p></div>}<div className="panel-note"><ShieldCheck size={16}/><span>Transitions require evidence. Version checks prevent stale updates from overwriting a newer change. Audit events are append-only through the application.</span></div></Panel></>;
}

export function NewOrderDialog({data,issue,onClose,onSaved}){
  const isML = issue !== 'manual' && 'anomaly_type' in issue;
  const defaultMeter = issue === 'manual' ? data.meters[0].id : issue.meter_id;
  const defaultTitle = issue === 'manual' ? '' : isML ? issue.work_order_title : issue.title;
  const defaultPriority = issue === 'manual' ? 'medium' : isML ? issue.suggested_priority : issue.priority;
  const defaultNote = issue === 'manual' ? '' : isML ? issue.work_order_note : `Triage of simulated exception: ${issue.detail}`;

  const [meterId,setMeterId]=useState(defaultMeter),[title,setTitle]=useState(defaultTitle),[priority,setPriority]=useState(defaultPriority),[note,setNote]=useState(defaultNote),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){event.preventDefault();if(busy)return;setBusy(true);setError('');try{await estateApi('/estate/orders',postEstate({meterId,title,priority,note}));await onSaved();}catch(error){setError(error.message);}finally{setBusy(false);}}
  return <Dialog title={isML ? `Dispatch inspection: ${issue.meter_id}` : "Create inspection work order"} onClose={onClose}><form onSubmit={submit} className="estate-form"><label>Registered demo asset<select aria-label="Work order asset" value={meterId} onChange={event=>setMeterId(event.target.value)}>{data.meters.map(meter=><option value={meter.id} key={meter.id}>{meter.id} · {meter.location}</option>)}</select></label><label>Title<input aria-label="Work order title" minLength={5} maxLength={160} required value={title} onChange={event=>setTitle(event.target.value)}/></label><label>Priority<select aria-label="Work order priority" value={priority} onChange={event=>setPriority(event.target.value)}><option value="high">High · 24-hour demo target</option><option value="medium">Medium · 72-hour demo target</option><option value="low">Low · 72-hour demo target</option></select></label><label>Initial inspection context<textarea aria-label="Initial inspection context" minLength={12} maxLength={1200} required rows={4} value={note} onChange={event=>setNote(event.target.value)}/></label><p className="field-hint">{isML ? 'Pre-filled with diagnostic evidence from the Isolation Forest anomaly detector. Creates an audited inspection work order.' : 'Only simulated inspection details. Creating an order records an audit event; it does not dispatch a real contractor.'}</p>{error&&<p role="alert" className="estate-form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Saving…':'Create work order'}</button></div></form></Dialog>;
}

export function OrderDialog({order,teams,canWrite,onClose,onSaved}){
  const defaultTeams=['Electrical maintenance team (demo)','Lift maintenance team (demo)','Pump maintenance team (demo)','Estate review team (demo)'];
  const teamList=(teams&&teams.length>0)?teams.map(t=>typeof t==='string'?t:(t.name.includes('(demo)')?t.name:`${t.name} (demo)`)):defaultTeams;
  if(order.assignee&&!teamList.includes(order.assignee))teamList.unshift(order.assignee);
  const [status,setStatus]=useState(nextStatus[order.status][0]),[assignee,setAssignee]=useState(order.assignee||teamList[0]),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setStatus(nextStatus[order.status][0]);setNote('');},[order.version,order.status]);
  async function submit(event){event.preventDefault();if(busy)return;setBusy(true);setError('');try{await estateApi(`/estate/orders/${encodeURIComponent(order.id)}`,{method:'PATCH',body:JSON.stringify({version:order.version,status,assignee,note})});await onSaved();}catch(error){setError(error.message);}finally{setBusy(false);}}
  return <Dialog title={order.title} onClose={onClose}><div className="estate-order-summary"><Pill tone="blue">{statusLabel[order.status]}</Pill><span>{order.meter_id} · Version {order.version}</span><span>Due {stamp(order.due_at)} SGT</span></div>{canWrite&&<form className="estate-form" onSubmit={submit}><label>Next workflow step<select aria-label="Next work order status" value={status} onChange={event=>setStatus(event.target.value)}>{nextStatus[order.status].map(value=><option key={value} value={value}>{statusLabel[value]}</option>)}</select></label><label>Assigned demo team<select aria-label="Assigned demo team" value={assignee} onChange={event=>setAssignee(event.target.value)}>{teamList.map(name=><option key={name} value={name}>{name}</option>)}</select></label><label>Inspection / verification evidence<textarea aria-label="Work order evidence" minLength={12} maxLength={1200} required rows={3} value={note} onChange={event=>setNote(event.target.value)}/></label><p className="field-hint">Record what was checked and the simulated outcome. Verification requires a separate workflow step.</p>{error&&<p role="alert" className="estate-form-error">{error}</p>}<button className="button primary" disabled={busy}>{busy?'Saving…':'Save workflow step'}</button></form>}<div className="estate-audit"><h3>Evidence & audit timeline</h3>{order.events?.map(event=><div className="estate-audit-event" key={event.id}><span className="audit-dot"/><div><strong>{event.action.replaceAll('_',' ')}</strong><p>{event.body}</p><small>{event.actor} · {stamp(event.created_at)} SGT</small></div></div>)}</div></Dialog>;
}

export function ReportsPage({data,reportQuery,ready,canWrite,onRefresh}){
  const [reduction,setReduction]=useState(15),lighting=data.services.find(item=>item.service==='lighting')?.kwh??0,potential=lighting*reduction/100;
  const [editPolicyOpen,setEditPolicyOpen]=useState(false);
  const tariffDisplay = data.policy?.tariff !== undefined ? data.policy.tariff : 0.285;
  const gridFactorDisplay = data.policy?.gridFactor !== undefined ? data.policy.gridFactor : 0.402;
  const gridFactorYear = data.policy?.gridFactorYear ?? 2024;
  return <><div className="report-card"><div className="report-cover"><span className="report-icon"><FileBarChart2 size={36}/></span><div><div className="eyebrow">ESTATE ENERGY BRIEF</div><h2>One report. A traceable source.</h2><p>{date(data.from)} – {date(data.to)}</p><span className="report-meta">{data.blocks.length} blocks · public inventory + simulated energy</span></div></div><div className="report-download"><h3>Download block summary</h3><p>Load, solar, separate grid imports/exports, coverage, public dwelling units and source metadata. Missing-data estimates remain blank.</p><a className={`button primary ${!ready?'disabled':''}`} aria-disabled={!ready} tabIndex={ready?0:-1} href={ready?`/api/estate/report.csv?${reportQuery}`:undefined}><Download size={17}/>Download estate CSV</a></div></div><div className="estate-grid"><Panel title="Lighting improvement scenario" subtitle="A what-if calculation; no intervention or savings is claimed."><div className="estate-scenario"><label htmlFor="lighting-reduction">Assumed lighting reduction <strong>{reduction}%</strong></label><input id="lighting-reduction" aria-label="Lighting reduction percentage" type="range" min={0} max={40} step={1} value={reduction} onChange={event=>setReduction(Number(event.target.value))}/><div className="scenario-range"><span>0%</span><span>40%</span></div><div className="scenario-result"><Leaf size={28}/><div><strong>{data.metrics.complete?`${number(potential,2)} kWh`:'Awaiting complete readings'}</strong><span>Potential common-load reduction in this reporting period</span></div></div><p>Calculation: recorded lighting consumption × assumed reduction. This estimates load reduction, not grid-bill savings; solar overlap, contracts, occupancy, capital costs and rebound effects are excluded.</p></div></Panel><Panel title="Reporting assumptions" subtitle="Keep operational decisions tied to their evidence." action={canWrite&&<button type="button" className="button secondary" onClick={()=>setEditPolicyOpen(true)}>Edit Tariff & Carbon Policy</button>}><dl className="estate-assumptions"><div><dt>Grid energy estimate</dt><dd>{data.metrics.grid===null?'Withheld':`${number(data.metrics.grid,2)} kWh`}</dd></div><div><dt>Estimated grid energy charge</dt><dd>{data.metrics.cost===null?'Withheld':money(data.metrics.cost)}</dd></div><div><dt>Configured illustrative tariff</dt><dd>S${tariffDisplay} / kWh · excludes GST, solar PPA, other charges and export revenue</dd></div><div><dt>Grid CO₂ estimate</dt><dd>{data.metrics.co2Kg===null?'Withheld':`${number(data.metrics.co2Kg,2)} kg CO₂`}</dd></div><div><dt>EMA historical grid factor</dt><dd>{gridFactorYear}: {gridFactorDisplay} kg CO₂ / kWh · not a 2026 factor or audited carbon report</dd></div></dl></Panel></div>
    {editPolicyOpen&&<EditPolicyDialog policy={data.policy} onClose={()=>setEditPolicyOpen(false)} onRefresh={onRefresh}/>}
  </>;
}

function EditPolicyDialog({policy,onClose,onRefresh}){
  const [tariff,setTariff]=useState(policy?.tariff??0.285);
  const [gridFactor,setGridFactor]=useState(policy?.gridFactor??0.402);
  const [highPriorityHours,setHighPriorityHours]=useState(policy?.highPriorityHours??24);
  const [otherPriorityHours,setOtherPriorityHours]=useState(policy?.otherPriorityHours??72);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');
    try{
      await estateApi('/estate/policy',{
        method:'PATCH',
        body:JSON.stringify({
          tariff:Number(tariff),
          gridFactor:Number(gridFactor),
          highPriorityHours:Number(highPriorityHours),
          otherPriorityHours:Number(otherPriorityHours)
        })
      });
      await onRefresh();
      onClose();
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  return <Dialog title="Edit Tariff & Carbon Policy" onClose={onClose}>
    <form onSubmit={submit} className="estate-form">
      <label>Illustrative Grid Tariff (S$ / kWh)<input type="number" step="0.001" min="0.01" max="5.0" required aria-label="Illustrative Grid Tariff" value={tariff} onChange={e=>setTariff(e.target.value)}/></label>
      <label>EMA Grid Emission Factor (kg CO₂ / kWh)<input type="number" step="0.001" min="0.0" max="5.0" required aria-label="EMA Grid Emission Factor" value={gridFactor} onChange={e=>setGridFactor(e.target.value)}/></label>
      <label>High Priority SLA Target (hours)<input type="number" min={1} max={720} required aria-label="High Priority SLA Target" value={highPriorityHours} onChange={e=>setHighPriorityHours(e.target.value)}/></label>
      <label>Normal Priority SLA Target (hours)<input type="number" min={1} max={720} required aria-label="Normal Priority SLA Target" value={otherPriorityHours} onChange={e=>setOtherPriorityHours(e.target.value)}/></label>
      <p className="field-hint">Updates the workspace pricing, carbon calculations, and work order target response times.</p>
      {error&&<p role="alert" className="estate-form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy?'Saving…':'Save Policy'}</button></div>
    </form>
  </Dialog>;
}

export function SourcesPage({data}){
  return <><div className="estate-source-intro"><BookOpen size={26}/><div><h2>A Singapore operations use case with honest provenance.</h2><p>This is an independent portfolio pilot inspired by public programmes. It is not an HDB, Town Council or government-operated service.</p></div></div><div className="estate-source-grid"><Panel title="HDB Property Information" subtitle="Public building inventory"><div className="estate-source-body"><Pill tone="green">Real public data</Pill><p>Six selected residential records: block number, street, town, floors, completion year and dwelling units. Inventory period ends December 2025.</p><p><strong>Retrieved:</strong> {date(data.source.retrieved_at)}<br/><strong>Publisher:</strong> Housing & Development Board<br/><strong>Licence:</strong> Singapore Open Data Licence</p><a href={data.source.source_url} target="_blank" rel="noopener noreferrer" className="text-button">View dataset and licence <ExternalLink size={15}/></a></div></Panel><Panel title="Green Towns & SolarNova" subtitle="Public policy context"><div className="estate-source-body"><Pill>Programme reference</Pill><p>HDB’s Green Towns Programme includes solar panels, smart lighting and smart electric sub-meters. SolarNova describes daytime solar use for lifts, lights and pumps, with excess supplied to the grid.</p><a href="https://www.hdb.gov.sg/about-us/our-role/create-smart-and-sustainable-homes/green-towns-programme" target="_blank" rel="noopener noreferrer" className="text-button">HDB Green Towns Programme <ExternalLink size={15}/></a><a href="https://www.hdb.gov.sg/hdb-pulse/news/2021/hdb-launches-sixth-solarnova-tender-with-smart-electrical-sub-meters-to-optimise-energy-use" target="_blank" rel="noopener noreferrer" className="text-button">SolarNova common services <ExternalLink size={15}/></a></div></Panel><Panel title="EMA grid emission factor" subtitle="A historical reference, explicitly dated"><div className="estate-source-body"><Pill>2024 reference</Pill><p>The Singapore Energy Statistics chapter reports a 2024 average grid emission factor of 0.402 kg CO₂/kWh. This pilot multiplies derived grid imports by that factor.</p><p>No carbon certification, lifecycle emissions calculation or current-year factor is claimed.</p><a href="https://www.ema.gov.sg/resources/singapore-energy-statistics/chapter2" target="_blank" rel="noopener noreferrer" className="text-button">View EMA source <ExternalLink size={15}/></a></div></Panel><Panel title="Meter & maintenance simulation" subtitle="Operational data is generated for demonstration"><div className="estate-source-body"><Pill tone="amber">Simulated data</Pill><p>Lighting, lift, pump and solar readings are synthetic. The register does not assert actual installed equipment, defects or energy performance at any real block.</p><p>The demo contains 14 complete historical days, two missing readings and configured threshold exceptions. Work orders, assigned teams and response targets are simulated.</p></div></Panel></div><Panel title="Calculation rules" subtitle="Designed to avoid plausible-looking but unsupported conclusions"><div className="estate-methods"><div><span>01</span><div><h3>Balance by block and hour</h3><p>Common load is lighting + lifts + pumps. Self-consumed solar = min(load, solar); grid import = max(load − solar, 0); export = max(solar − load, 0). Sum the intervals separately, never net different blocks or times together.</p></div></div><div><span>02</span><div><h3>Missing data remains missing</h3><p>Any missing meter interval withholds grid balance, cost, carbon, per-unit comparisons and baseline change for that selection. Recorded load and solar remain labelled as recorded values. Zero readings remain valid.</p></div></div><div><span>03</span><div><h3>Separate scale from performance</h3><p>Common-load kWh per dwelling uses public inventory units. It does not measure household consumption or bill residents. Comparisons require complete, equal-length periods.</p></div></div><div><span>04</span><div><h3>Trace changes through evidence</h3><p>Work orders move from open to in progress, completed, then verified. Every step stores a note and versioned update. Browser workspaces are isolated; the role switch is a demo of permissions, not real identity authentication.</p></div></div></div></Panel></>;
}
