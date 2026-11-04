import {lazy,Suspense,useState,useEffect,useCallback,useRef} from 'react';
import {Zap,Building2,LayoutDashboard,UploadCloud,ClipboardCheck,FileBarChart2,BookOpen,ArrowUpRight,ArrowRight,Download,RefreshCw,Menu,X,Sun,Leaf,Activity,TriangleAlert,CheckCircle2,LoaderCircle,Eye,Plus,Search,Info,ShieldCheck,ChevronRight,Sparkles,ExternalLink,ChevronDown,Compass} from 'lucide-react';
const EstateChart=lazy(()=>import('./EstateChart'));
import {serviceLabels} from '../shared/estate';
import {addDays,dayStart} from '../shared/analytics';
import {estateApi,postEstate,bootstrapEstate} from './estate-api';
import {fetchMLAnomalies} from './ml-api';
const MLAnomalyPanel=lazy(()=>import('./MLAnomalyPanel'));
const MLForecastView=lazy(()=>import('./MLForecastView'));
const AuthModal=lazy(()=>import('./AuthModal'));
import BootScreen from './BootScreen';
import {number,date,Pill,Panel} from './estate-ui';
const BlocksPage=lazy(()=>import('./EstatePages').then(module=>({default:module.BlocksPage})));
const EstateImports=lazy(()=>import('./EstatePages').then(module=>({default:module.EstateImports})));
const OrdersPage=lazy(()=>import('./EstatePages').then(module=>({default:module.OrdersPage})));
const NewOrderDialog=lazy(()=>import('./EstatePages').then(module=>({default:module.NewOrderDialog})));
const OrderDialog=lazy(()=>import('./EstatePages').then(module=>({default:module.OrderDialog})));
const ReportsPage=lazy(()=>import('./EstatePages').then(module=>({default:module.ReportsPage})));
const SourcesPage=lazy(()=>import('./EstatePages').then(module=>({default:module.SourcesPage})));


const navigation=[
  {id:'estate',label:'Estate overview',title:'Estate overview',icon:LayoutDashboard},
  {id:'estate-forecast',label:'Forecasts',title:'Energy forecasts & insights',icon:Sparkles},
  {id:'estate-blocks',label:'Blocks & assets',title:'Blocks & assets',icon:Building2},
  {id:'estate-imports',label:'Data quality',title:'Data quality',icon:UploadCloud},
  {id:'estate-orders',label:'Work orders',title:'Work orders',icon:ClipboardCheck},
  {id:'estate-reports',label:'Reports & scenarios',title:'Reports & scenarios',icon:FileBarChart2},
  {id:'estate-sources',label:'Sources & methods',title:'Sources & methods',icon:BookOpen},
];
export default function EstateApp(){
  const [page,setPage]=useState((navigation.find(item=>item.id===location.hash.slice(1))?.id)??'estate');
  const [role,setRole]=useState(null),[data,setData]=useState(null);
  const [town,setTown]=useState('all'),[block,setBlock]=useState('all'),[period,setPeriod]=useState('7');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [loadedKey,setLoadedKey]=useState(''),[notice,setNotice]=useState(''),[navOpen,setNavOpen]=useState(false);
  const [newIssue,setNewIssue]=useState(null),[selected,setSelected]=useState(null);
  const [anomalies,setAnomalies]=useState([]),[anomaliesLoading,setAnomaliesLoading]=useState(true);
  const [anomaliesDegraded,setAnomaliesDegraded]=useState(false),[anomalyReason,setAnomalyReason]=useState('');
  const [elapsed,setElapsed]=useState(0);
  const [guideOpen,setGuideOpen]=useState(false);
  const bootData=useRef(null),startedAt=useRef(performance.now());
  const [authInfo,setAuthInfo]=useState(null),[authOpen,setAuthOpen]=useState(false);
  const bounds=useRef(null),counter=useRef(0),rail=useRef(null),navTrigger=useRef(null);
  const canManage=role==='manager'||role==='org_admin';
  const filterKey=[role,town,block,period,from,to].join('|');
  const notify=useCallback((message)=>setNotice(message),[]);
  const navigate=useCallback((next)=>{location.hash=next;setPage(next);setNavOpen(false);},[]);
  useEffect(()=>{const change=()=>{const current=navigation.find(item=>item.id===location.hash.slice(1));if(current)setPage(current.id);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  useEffect(()=>{document.title=`${navigation.find(item=>item.id===page)?.title} · MeterWise`;window.scrollTo(0,0);document.querySelector('.estate-app h1')?.focus({preventScroll:true});},[page]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);
  // Start the chart bundle while the estate request is still in flight.
  useEffect(()=>{void import('./EstateChart').catch(()=>{});},[]);
  useEffect(()=>{
    if(data)return;
    const timer=setInterval(()=>setElapsed((performance.now()-startedAt.current)/1000),1000);
    setElapsed((performance.now()-startedAt.current)/1000);
    return()=>clearInterval(timer);
  },[data]);
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const current=await bootstrapEstate();
        if(active){
          bootData.current=current.overview;
          setAuthInfo(current.authInfo);
          setRole(current.role);
        }
      }catch(error){if(active){setError(error.message);setBusy(false);}}
    })();
    return()=>{active=false;};
  },[]);
  const refresh=useCallback(async()=>{
    if(!role)return;const request=++counter.current;setBusy(true);setError('');setAnomalies([]);setAnomaliesLoading(true);
    const query=new URLSearchParams({town,block});
    if(period==='custom'){query.set('from',from);query.set('to',to);}else if(bounds.current){query.set('to',bounds.current.to);query.set('from',addDays(bounds.current.to,1-Number(period)));}
    try{
      // Load the dashboard first. The ML pass then reuses the workspace the
      // overview created, instead of racing it and seeding the same readings twice.
      const initial=bootData.current;
      bootData.current=null;
      const current=initial??await estateApi(`/estate/overview?${query}`);
      if(request!==counter.current)return;
      bounds.current=current.bounds;
      setData(current);
      setLoadedKey([role,town,block,period,from,to].join('|'));
      setBusy(false);
      fetchMLAnomalies(town,block)
        .then(anomRes=>{if(request===counter.current){setAnomalies(anomRes.anomalies.filter(item=>current.blocks.some(block=>block.id===item.block_id)).map(item=>{const registered=current.catalogue.find(block=>block.id===item.block_id);return {...item,town:registered.town,block_label:`Blk ${registered.block} ${registered.street}`};}));setAnomaliesDegraded(!!anomRes.degraded);setAnomalyReason(anomRes.degradedReason||'');setAnomaliesLoading(false);}})
        .catch(()=>{if(request===counter.current){setAnomaliesDegraded(true);setAnomalyReason('Live ML service could not be reached.');setAnomaliesLoading(false);}});
    }
    catch(error){if(request===counter.current){setError(error.message);setAnomaliesLoading(false);}}
    finally{if(request===counter.current)setBusy(false);}
  },[role,town,block,period,from,to]);
  useEffect(()=>{void refresh();},[refresh]);
  const handleAuthenticated=useCallback(async(res)=>{
    try{const me=await estateApi('/auth/me');setAuthInfo(me);if(me?.role)setRole(me.role);}
    catch{if(res)setAuthInfo({isDemo:false,orgName:res.orgName||res.user?.name,actorName:res.user?.name,role:res.role});}
    await refresh();
    notify(`Authenticated${res?.orgName?` to ${res.orgName}`:''}.`);
  },[refresh,notify]);
  const handleLogout=useCallback(async()=>{
    try{const me=await estateApi('/auth/me');setAuthInfo(me);if(me?.role)setRole(me.role);}
    catch{setAuthInfo({isDemo:true});}
    await refresh();
    notify('Signed out. Restored demo workspace.');
  },[refresh,notify]);
  const ready=!!data&&!busy&&!error&&loadedKey===filterKey;
  const summary=useRef(null);summary.current=ready?data:null;
  const slow=!data&&elapsed>8;
  const stage=slow?'Preparing your first-visit readings…':'Loading your estate workspace…';
  const detail=slow?'The first visit prepares your private demo dataset. Your dashboard will open as soon as it is ready.':'Connecting securely and loading your estate summary.';
  useEffect(()=>{
    const context=document.modelContext;
    if(!context?.registerTool)return;const lifecycle=new AbortController();
    try{void Promise.resolve(context.registerTool({name:'get_meterwise_estate_summary',title:'Read permitted estate energy summary',description:'Read the current permitted town/block energy balance, coverage and work-order counts. Public building inventory; simulated energy. No record changes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(){const current=summary.current;if(!current)throw new Error('A current estate summary is not available.');return {from:current.from,to:current.to,blocks:current.blocks.map(block=>({block:block.block,street:block.street,town:block.town})),energyDataType:'simulated',inventory:'HDB public property data',...current.metrics};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}
    return()=>lifecycle.abort();
  },[]);
  useEffect(()=>{
    if(!navOpen)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';
    const controls=()=>Array.from(rail.current?.querySelectorAll('a[href],button:not([disabled])')??[]);controls()[0]?.focus();
    const key=(event)=>{if(event.key==='Escape')setNavOpen(false);if(event.key==='Tab'){const all=controls(),first=all[0],last=all.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    const resize=()=>{if(innerWidth>900)setNavOpen(false);};addEventListener('keydown',key);addEventListener('resize',resize);
    return()=>{document.body.style.overflow=old;removeEventListener('keydown',key);removeEventListener('resize',resize);navTrigger.current?.focus();};
  },[navOpen]);
  async function switchRole(){
    if(busy)return;setBusy(true);++counter.current;
    try{const current=await estateApi('/session?view=estate',postEstate({role:canManage?'tenant':'manager'}));setTown('all');setBlock('all');setData(null);setRole(current.role);if(page==='estate-imports')navigate('estate');notify(current.role==='tenant'?'Read-only area view: Ang Mo Kio.':'Estate manager demo view restored.');}
    catch(error){setError(error.message);setBusy(false);}
  }
  async function openOrder(order){try{setSelected(await estateApi(`/estate/orders/${encodeURIComponent(order.id)}`));}catch(error){notify(error.message);}}
  if(!data)return <BootScreen stage={stage} detail={detail} elapsed={elapsed} error={error} onRetry={()=>location.reload()}/>;
  const current=navigation.find(item=>item.id===page),reportQuery=new URLSearchParams({from:data.from,to:data.to,town,block});
  return <div className="app-shell estate-app">{busy&&<div className="refresh-rail" role="progressbar" aria-label="Updating estate data"><span/></div>}<a className="skip-link" href="#main-content">Skip to estate data</a>
    {navOpen&&<button className="nav-overlay" aria-label="Close navigation" onClick={()=>setNavOpen(false)}/>}
    <aside ref={rail} id="estate-navigation" className={`sidebar ${navOpen?'is-open':''}`} role={navOpen?'dialog':undefined} aria-modal={navOpen||undefined} aria-label="Estate navigation">
      <button className="icon-button nav-close" aria-label="Close menu" onClick={()=>setNavOpen(false)}><X size={20}/></button>
      <a href="#estate" className="brand" onClick={()=>navigate('estate')}><span className="brand-mark"><Zap size={21} fill="currentColor"/></span>MeterWise</a>
      <div className="workspace-label">YOUR WORKSPACE</div><div className="workspace"><span className="workspace-icon"><Building2 size={19}/></span><div><strong>Singapore estates</strong><span>Common-area energy</span></div></div>
      <nav aria-label="Estate main navigation">{navigation.filter(item=>canManage||item.id!=='estate-imports').map(item=><button key={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>navigate(item.id)} aria-current={page===item.id?'page':undefined}><item.icon size={19}/><span>{item.label}</span>{item.id==='estate-orders'&&data.metrics.openOrders>0&&<span className="nav-count">{data.metrics.openOrders}</span>}{item.id==='estate-forecast'&&!anomaliesLoading&&anomalies.length>0&&<span className="nav-count ml-alert-count" title={anomaliesDegraded?`${anomalies.length} demonstration anomalies (live ML unavailable)`:`${anomalies.length} anomalies detected`}>{anomalies.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="demo-card"><Leaf size={20}/><strong>Small insights. Better estates.</strong><p>Real building inventory. Simulated energy. A workspace to explore.</p><a href="#overview">Open the building demo <ArrowUpRight size={14}/></a></div><div className="profile"><span className="avatar">{canManage?'EM':'AV'}</span><div><strong>{canManage?'Estate manager':'Area viewer'}</strong><span>{canManage?'Demo operations workspace':'Ang Mo Kio · read only'}</span></div></div></div>
    </aside>
    <main className="main" id="main-content" aria-busy={busy} inert={navOpen||undefined}>
      <header className="topbar"><div className="breadcrumb"><button ref={navTrigger} className="icon-button mobile-menu" aria-label="Open navigation" aria-controls="estate-navigation" aria-expanded={navOpen} onClick={()=>setNavOpen(true)}><Menu size={20}/></button><span>Estate operations</span><span className="breadcrumb-divider">/</span><strong>{current.label}</strong></div><div className="top-actions"><button className="role-button guide-toggle" aria-label="Quick guide" aria-expanded={guideOpen} onClick={()=>setGuideOpen(value=>!value)}><Compass size={16}/><span>Quick guide</span></button>{!authInfo?.isDemo&&authInfo?.orgName?<Pill tone="green">{authInfo.orgName}</Pill>:<Pill tone="demo">Independent pilot</Pill>}<button className="role-button" aria-label="Client sign in" onClick={()=>setAuthOpen(true)}><Building2 size={16}/><span>{authInfo?.orgName?authInfo.orgName:'Client Sign In'}</span></button><button className="role-button" aria-label={canManage?'Preview area viewer':'Back to manager'} disabled={busy} onClick={()=>void switchRole()}><Eye size={16}/><span>{canManage?'Preview area viewer':'Back to manager'}</span></button></div></header>
      <div className="page-content">

        <div className="page-heading"><div><div className="eyebrow">ESTATE INTELLIGENCE</div><h1 tabIndex={-1}>{current.title}</h1><p>{page==='estate'?'A clear picture of your energy. A better place to start.':page==='estate-forecast'?'Hourly demand and rooftop solar ML forecasting with 95% confidence intervals and model accuracy metrics.':page==='estate-blocks'?'Compare registered blocks and inspect their simulated common-service assets.':page==='estate-imports'?'Restore missing intervals without hiding duplicates or invalid rows.':page==='estate-orders'?'Assign an inspection, record evidence, and verify the outcome.':page==='estate-reports'?'Export traceable block summaries and explore a lighting scenario.':'Public data, operational assumptions and calculation boundaries.'}</p></div><div className="heading-actions"><button className="icon-button bordered" aria-label="Refresh estate data" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={18} className={busy?'spin':''}/></button>{page!=='estate-sources'&&<a aria-label="Export report" className={`button secondary ${!ready?'disabled':''}`} aria-disabled={!ready} tabIndex={ready?0:-1} href={ready?`/api/estate/report.csv?${reportQuery}`:undefined}><Download size={17}/><span>Export report</span></a>}</div></div>
        <div className="estate-provenance"><span><ShieldCheck size={16}/><strong>Real HDB inventory</strong><span className="provenance-divider">/</span> Simulated meters & maintenance</span><button className="text-button" onClick={()=>navigate('estate-sources')}>About this pilot <ArrowUpRight size={14}/></button></div>
        {guideOpen&&<section className="workspace-guide" aria-label="How to use MeterWise"><div className="guide-heading"><div><Compass size={19}/><h2>Your estate, in three steps</h2></div><button className="icon-button" aria-label="Close quick guide" onClick={()=>setGuideOpen(false)}><X size={18}/></button></div><div className="guide-steps">{[{id:'estate',title:'Understand your energy',text:'Choose a town and period. Compare demand, solar and coverage.'},{id:'estate-imports',title:'Check the evidence',text:'Review missing readings before relying on grid and cost totals.'},{id:'estate-orders',title:'Take the next step',text:'Create an inspection, assign a team and track the outcome.'}].filter(item=>canManage||item.id!=='estate-imports').map((item,index)=><button key={item.id} onClick={()=>{navigate(item.id);setGuideOpen(false);}}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{item.title}</strong><p>{item.text}</p></div><ArrowUpRight size={17}/></button>)}</div></section>}

        {page!=='estate-sources'&&<div className="estate-filters"><label>Reporting period<select aria-label="Estate reporting period" value={period} onChange={event=>{const value=event.target.value;if(value==='custom'){setFrom(data.from);setTo(data.to);}setPeriod(value);}}><option value="7">Last 7 days</option><option value="14">Full 14-day dataset</option><option value="custom">Custom range</option></select></label>{period==='custom'&&<><label>From<input type="date" aria-label="Estate from date" min={data.bounds.from} max={data.bounds.to} value={from} onChange={event=>setFrom(event.target.value)}/></label><label>To<input type="date" aria-label="Estate to date" min={data.bounds.from} max={data.bounds.to} value={to} onChange={event=>setTo(event.target.value)}/></label></>}<span className="estate-period">{date(data.from)} – {date(data.to)}<small>Hourly intervals · SGT</small></span><label>Town<select aria-label="Estate town" value={town} onChange={event=>{setTown(event.target.value);setBlock('all');}}><option value="all">All towns</option>{[...new Set(data.catalogue.map(item=>item.town))].map(name=><option key={name}>{name}</option>)}</select></label><label>Block<select aria-label="Estate block" value={block} onChange={event=>setBlock(event.target.value)}><option value="all">All blocks</option>{data.catalogue.filter(item=>town==='all'||item.town===town).map(item=><option key={item.id} value={item.id}>Blk {item.block} · {item.street}</option>)}</select></label></div>}
        {error&&<div className="estate-notice error" role="alert"><TriangleAlert size={19}/><span>{error} Displayed figures retain the last valid selection. Exports are disabled.</span></div>}
        {busy&&<div className="data-status" role="status"><LoaderCircle size={16} className="spin"/> Updating your selection…</div>}
        {!data.metrics.complete&&page!=='estate-sources'&&<div className="estate-notice"><TriangleAlert size={20}/><div><strong>{data.metrics.expected-data.metrics.received} missing hourly readings</strong><span>Grid import, export, cost, carbon and comparisons are withheld until the selected data is complete.</span></div>{canManage&&<button className="button secondary" onClick={()=>navigate('estate-imports')}>Repair data <ArrowRight size={16}/></button>}</div>}
        {page==='estate'&&<EstateOverviewPage data={data} anomalies={anomalies} anomaliesLoading={anomaliesLoading} anomaliesDegraded={anomaliesDegraded} anomalyReason={anomalyReason} onBlocks={()=>navigate('estate-blocks')} onIssue={issue=>setNewIssue(issue)} onOrders={()=>navigate('estate-orders')} onForecast={()=>navigate('estate-forecast')} onQuality={()=>navigate('estate-imports')} canWrite={canManage&&ready}/>}
        <Suspense fallback={<div className="data-status" role="status">Opening {current.label.toLowerCase()}…</div>}>
        {page==='estate-forecast'&&<Suspense fallback={<div className="data-status" role="status"><LoaderCircle size={18} className="spin"/> Loading ML forecast…</div>}><MLForecastView town={town} block={block} catalogue={data.catalogue} policy={data.policy}/></Suspense>}
        {page==='estate-blocks'&&<BlocksPage data={data} onChoose={id=>{setBlock(id);navigate('estate');}} canWrite={canManage&&ready} onRefresh={refresh}/>}
        {page==='estate-imports'&&canManage&&<EstateImports onSaved={async()=>{notify('Estate readings saved. Recalculating the selected period.');await refresh();}}/>}
        {page==='estate-orders'&&<OrdersPage data={data} onNew={()=>setNewIssue('manual')} onOpen={order=>void openOrder(order)} canWrite={canManage&&ready}/>}
        {page==='estate-reports'&&<ReportsPage data={data} reportQuery={reportQuery.toString()} ready={ready} canWrite={canManage&&ready} onRefresh={refresh}/>}
        {page==='estate-sources'&&<SourcesPage data={data}/>}
        </Suspense>
        <footer className="page-footer">Independent portfolio pilot · Not affiliated with HDB or any Town Council · Public building metadata; simulated operational data · SGT (UTC+8)</footer>
      </div>
    </main>
    <nav className="mobile-dock" aria-label="Quick navigation" inert={navOpen||undefined}>{[{id:'estate',label:'Overview',icon:LayoutDashboard},{id:'estate-blocks',label:'Assets',icon:Building2},{id:'estate-orders',label:'Work orders',icon:ClipboardCheck}].map(item=><button key={item.id} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}><item.icon size={20}/><span>{item.label}</span></button>)}<button aria-label="More navigation" aria-expanded={navOpen} onClick={()=>setNavOpen(true)}><Menu size={20}/><span>More</span></button></nav>
    {notice&&<div className="toast" role="status"><CheckCircle2 size={18}/>{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={15}/></button></div>}
    <Suspense fallback={<div className="toast" role="status">Opening inspection…</div>}>
    {newIssue&&<NewOrderDialog data={data} issue={newIssue} onClose={()=>setNewIssue(null)} onSaved={async()=>{setNewIssue(null);navigate('estate-orders');notify('Work order created with an initial audit entry.');await refresh();}}/>}
    {selected&&<OrderDialog order={selected} teams={data?.teams} canWrite={canManage} onClose={()=>setSelected(null)} onSaved={async()=>{const current=await estateApi(`/estate/orders/${encodeURIComponent(selected.id)}`);setSelected(current);notify('Work order updated and evidence recorded.');await refresh();}}/>}
    </Suspense>
    {authOpen&&<Suspense fallback={<div className="toast" role="status">Opening sign in…</div>}><AuthModal open={authOpen} onClose={()=>setAuthOpen(false)} authInfo={authInfo} onAuthenticated={handleAuthenticated} onLogout={handleLogout}/></Suspense>}
  </div>;
}

function EstateOverviewPage({data,anomalies,anomaliesLoading,anomaliesDegraded,anomalyReason,onBlocks,onIssue,onOrders,onForecast,onQuality,canWrite}){
  const [triageOpen,setTriageOpen]=useState(false);
  return <><div className="metrics estate-metrics"><div className="metric"><div className="metric-top">Recorded common load<span className="metric-icon"><Zap size={17}/></span></div><div className="metric-value">{number(data.metrics.load)}<span>kWh</span></div><div className="metric-foot">{data.metrics.change===null?'Comparison requires complete periods':`${data.metrics.change>0?'+':''}${data.metrics.change}% vs previous equal-length period`} · simulated</div></div><div className="metric"><div className="metric-top">Rooftop solar generation<span className="metric-icon"><Sun size={17}/></span></div><div className="metric-value">{number(data.metrics.solar)}<span>kWh</span></div><div className="metric-foot">Recorded generation · simulated PV assets</div></div><div className="metric"><div className="metric-top">Derived grid import<span className="metric-icon"><Activity size={17}/></span></div><div className={`metric-value ${data.metrics.grid===null?'awaiting-value':''}`}>{data.metrics.grid===null?'Awaiting data':number(data.metrics.grid)}{data.metrics.grid!==null&&<span>kWh</span>}</div><div className="metric-foot">Matched by block and hour · export counted separately</div></div><div className="metric"><div className="metric-top">Meter data coverage<span className="metric-icon"><ShieldCheck size={17}/></span></div><div className="metric-value">{number(data.metrics.coverage,2)}<span>%</span></div><div className="metric-foot">{number(data.metrics.received)} / {number(data.metrics.expected)} hourly intervals</div></div></div>
    <div className="estate-context"><span><Building2 size={17}/><strong>{data.blocks.length} blocks</strong> · {data.metrics.units} public-record dwelling units</span><span><ClipboardCheck size={17}/><strong>{data.metrics.openOrders} open work orders</strong>{data.metrics.overdueOrders>0&&` · ${data.metrics.overdueOrders} overdue`}</span><span><Leaf size={17}/>Grid CO₂ estimate <strong>{data.metrics.co2Kg===null?'Withheld':`${number(data.metrics.co2Kg)} kg`}</strong></span><button type="button" className="text-button" onClick={onForecast}><Sparkles size={15}/>Predictive ML forecast <ArrowUpRight size={13}/></button></div>
    <div className="operations-strip" aria-label="Operational priorities"><div className="operations-strip-label"><Activity size={17}/><strong>At a glance</strong></div><button onClick={onOrders}><span className="status-dot"/><strong>{data.metrics.openOrders}</strong> open work orders <ArrowUpRight size={14}/></button>{canWrite&&<button onClick={onQuality}><span className={`status-dot ${data.metrics.complete?'':'amber'}`}/><strong>{data.metrics.expected-data.metrics.received}</strong> missing readings <ArrowUpRight size={14}/></button>}<button onClick={()=>{setTriageOpen(true);requestAnimationFrame(()=>document.getElementById('ml-anomaly-section')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));}}><Sparkles size={15}/>{anomaliesLoading?'Checking insights…':`${anomalies.length} ${anomaliesDegraded?'demo insights':'model insights'}`}<ArrowRight size={14}/></button></div>
    <div className="estate-grid"><Panel title="Energy balance over time" subtitle="Simulated common load and solar; grid use requires complete intervals." action={<Pill>kWh / day</Pill>}><div className="estate-chart-legend"><span><i className="load-dot"/>Common load</span><span><i className="solar-dot"/>Solar generation</span><span><i className="grid-dot"/>Grid import</span></div><div className="estate-chart" role="img" aria-label="Daily common load, solar generation and derived grid import. Exact values are in the chart data table."><Suspense fallback={<p role="status">Loading chart… Exact values are available in the data table below.</p>}><EstateChart data={data.chart}/></Suspense></div><details className="chart-data"><summary>View chart data</summary><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable estate data table"><table><thead><tr><th>SGT date</th><th>Load kWh</th><th>Solar kWh</th><th>Grid kWh</th></tr></thead><tbody>{data.chart.map(point=><tr key={point.date}><td>{point.date}</td><td>{point.load}</td><td>{point.solar}</td><td>{point.grid??'Withheld'}</td></tr>)}</tbody></table></div></details></Panel>
    <Panel title="Common services" subtitle="Recorded energy by service" className="estate-services">{data.services.filter(item=>item.service!=='solar').map((item,index)=><div className="estate-service" key={item.service}><span className={`service-mark service-${index}`}>{item.service==='pumps'?<Activity size={17}/>:<Zap size={17}/>}</span><div><strong>{serviceLabels[item.service]}</strong><div className="service-track"><span style={{width:`${Math.max(2,item.kwh/data.metrics.load*100)}%`}}/></div></div><strong>{number(item.kwh)}<small>kWh</small></strong></div>)}<div className="estate-service-foot"><Sun size={22}/><div><strong>{data.metrics.selfConsumed===null?'Solar split withheld':`${number(data.metrics.selfConsumed)} kWh solar used on site`}</strong><p>{data.metrics.exported===null?'Restore missing readings to split self-consumption and exports.':`${number(data.metrics.exported)} kWh exported in matching intervals. Export revenue is excluded.`}</p></div></div></Panel></div>
    <div className="estate-grid estate-bottom-grid"><Panel title="Blocks at a glance" subtitle="Compare common-service energy per dwelling unit" action={<button className="text-button" onClick={onBlocks}>All blocks <ArrowUpRight size={14}/></button>}><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable estate data table"><table><thead><tr><th>Block</th><th>Common load</th><th>kWh / unit</th><th>Coverage</th></tr></thead><tbody>{data.blocks.map(block=><tr key={block.id}><td><strong>Blk {block.block}</strong><small className="table-sub">{block.town} · {block.street}</small></td><td>{number(block.load)} kWh</td><td>{block.kwhPerUnit===null?'Withheld':number(block.kwhPerUnit,2)}</td><td><Pill tone={block.complete?'green':'amber'}>{block.coverage}%</Pill></td></tr>)}</tbody></table></div></Panel>
    <Panel title="Needs an inspection" subtitle="Rules identify exceptions; they do not diagnose faults." action={<Pill tone="amber">{data.issues.length}</Pill>}><div className="estate-issues">{data.issues.length?data.issues.slice(0,5).map(issue=><div className="estate-issue" key={issue.key}><span className={`alert-icon ${issue.priority==='high'?'high':'medium'}`}>{issue.kind==='missing'?<Activity size={17}/>:<TriangleAlert size={17}/>}</span><div><strong>{issue.title}</strong><small>{issue.meter_id} · {data.catalogue.find(block=>block.id===issue.block_id)?.town}</small></div>{canWrite&&<button className="text-button" aria-label={`Create work order for ${issue.meter_id} ${issue.kind}`} onClick={()=>onIssue(issue)}>Inspect <ChevronRight size={15}/></button>}</div>):<div className="estate-empty"><CheckCircle2 size={25}/><p>No exceptions in this selection.</p></div>}</div><div className="panel-note"><ClipboardCheck size={16}/><button className="text-button" onClick={onOrders}>Open the maintenance queue</button></div></Panel></div>
    <section id="ml-anomaly-section" className="insight-disclosure"><button className="insight-toggle" onClick={()=>setTriageOpen(value=>!value)} aria-expanded={triageOpen} aria-controls="estate-insight-details"><span className="insight-icon"><Sparkles size={20}/></span><span><strong>Go deeper with anomaly insights</strong><small>{anomaliesDegraded?'Demonstration cases · Live model unavailable':'Review model signals, evidence and suggested inspections'}</small></span><span className="badge demo">{anomaliesLoading?'Checking…':`${anomalies.length} insights`}</span><ChevronDown size={19} className={triageOpen?'is-expanded':''}/></button>{triageOpen&&<div id="estate-insight-details"><Suspense fallback={<div className="data-status" role="status">Loading insight details…</div>}><MLAnomalyPanel anomalies={anomalies} loading={anomaliesLoading} degraded={anomaliesDegraded} degradedReason={anomalyReason} canWrite={canWrite} onDispatchOrder={issue=>onIssue(issue)} onOpenOrders={onOrders} policy={data.policy}/></Suspense></div>}</section></>;

}
