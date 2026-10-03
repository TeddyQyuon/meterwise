import express from 'express';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {handleApi} from './api';
import {createLocalDatabase} from './local-database';
import {MAX_REQUEST_BYTES,securityHeaders} from './security';
try{process.loadEnvFile('.env');}catch{}
const db=await createLocalDatabase();
const app=express();
// The Vite proxy connects to the API with an internal Host. Trust only these
// explicitly configured frontend origins; the hosted Worker stays same-origin.
const trustedOrigins=(process.env.CLIENT_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173,http://terminal.local:4173').split(',').map(origin=>new URL(origin.trim()).origin);
app.disable('x-powered-by');
app.use(express.text({type:()=>true,limit:MAX_REQUEST_BYTES}));
app.use(async (req,res,next)=>{
  if(!req.path.startsWith('/api/'))return next();
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(','):value);
  const request=new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:typeof req.body==='string'?req.body:JSON.stringify(req.body??{})}:{})});
  // Local demo identity is intentional. The hosted adapter uses trusted platform identity.
  const response=await handleApi(request,db,'local-demo',{trustedOrigins});
  res.status(response.status);response.headers.forEach((value,name)=>res.setHeader(name,value));res.send(await response.text());
});
if(existsSync('dist/client/index.html')){app.use((req,res,next)=>{for(const [name,value] of Object.entries(securityHeaders(`${req.protocol}://${req.get('host')}`,true)))res.setHeader(name,value);next();});app.use(express.static(resolve('dist/client')));app.use((req,res)=>{if(req.method==='GET')res.sendFile(resolve('dist/client/index.html'));else res.status(404).end();});}
app.use((error:Error&{status?:number},req:express.Request,res:express.Response,next:express.NextFunction)=>{void next;for(const [name,value] of Object.entries(securityHeaders(`${req.protocol}://${req.get('host')}`)))res.setHeader(name,value);res.setHeader('Cache-Control','no-store');const tooLarge=error.status===413;res.status(tooLarge?413:400).json({error:tooLarge?'The request is too large. Import CSV files smaller than 1 MB.':'Request data could not be read.'});});
const port=Number(process.env.PORT??3001);
app.listen(port,process.env.HOST??'127.0.0.1',()=>console.log(`MeterWise Express API ready on port ${port} (${process.env.DB_DIALECT==='mysql'?'MySQL':'SQLite demo'})`));
