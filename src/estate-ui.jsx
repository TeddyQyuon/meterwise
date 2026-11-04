import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import {dayStart} from '../shared/analytics';

export const number=(value,digits=0)=>new Intl.NumberFormat('en-SG',{maximumFractionDigits:digits}).format(value);
export const money=(value)=>`S$${number(value,2)}`;
export const date=(value)=>new Intl.DateTimeFormat('en-SG',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Singapore'}).format(new Date(value.length===10?dayStart(value):value));
export const stamp=(value)=>new Intl.DateTimeFormat('en-SG',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Singapore'}).format(new Date(value));
export const statusLabel={open:'Open',in_progress:'In progress',completed:'Awaiting verification',verified:'Verified'};
export const nextStatus={open:['in_progress'],in_progress:['completed'],completed:['verified','in_progress'],verified:['open']};
export function Pill({children,tone='neutral'}){return <span className={`badge ${tone}`}>{children}</span>;}
export function Panel({title,subtitle,action,children,className=''}){return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>{children}</section>;}
export function Dialog({title,children,onClose}){
  const ref=useRef(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>{if(dialog?.open)dialog.close();};},[]);
  return <dialog ref={ref} className="modal estate-dialog" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}

