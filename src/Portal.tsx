import {lazy,Suspense,useEffect,useState} from 'react';
import EstateApp from './EstateApp';
const BuildingApp=lazy(()=>import('./App'));
const buildingPages=new Set(['#overview','#meters','#imports','#alerts','#reports']);
export default function Portal(){
  const [estate,setEstate]=useState(!buildingPages.has(location.hash));
  useEffect(()=>{const change=()=>{if(!location.hash||location.hash.startsWith('#estate'))setEstate(true);else if(buildingPages.has(location.hash))setEstate(false);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  return estate?<EstateApp/>:<Suspense fallback={<div className="boot">Opening the building demo…</div>}><BuildingApp/></Suspense>;
}
