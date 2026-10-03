import {handleApi} from './api';
import {getTursoDatabase} from './libsql-database';
import {secureResponse} from './security';
import type {Database} from './database';

const errorResponse=(request:Request,status:number,error:string)=>secureResponse(
  Response.json({error},{status,headers:{'Cache-Control':'no-store'}}),request.url);

export async function provisionDemoWorkspace(db:Database,workspaceId:string,limit=100):Promise<boolean>{
  const existing=await db.all('SELECT id FROM workspaces WHERE id=?',[workspaceId]);
  if(existing.length)return true;
  // The conditional insert is atomic in SQL, so concurrent visitors cannot
  // exceed this bound on synthetic seed data by racing a count and an insert.
  await db.run('INSERT OR IGNORE INTO workspaces (id,name,tariff,seeded,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM workspaces)<?',
    [workspaceId,'Harbour One',0.285,0,new Date().toISOString(),limit]);
  return (await db.all('SELECT id FROM workspaces WHERE id=?',[workspaceId])).length===1;
}

export function createVercelHandler(loadDatabase:()=>Promise<Database>=getTursoDatabase,workspaceLimit=100){
  return async(request:Request):Promise<Response>=>{
    const url=new URL(request.url);
    if(!['GET','HEAD','OPTIONS'].includes(request.method)){
      if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site'){
        return errorResponse(request,403,'This request must come from MeterWise.');
      }
    }
    const cookie=request.headers.get('Cookie')?.split(';').map(item=>item.trim())
      .find(item=>item.startsWith('mw_visitor='))?.slice(11);
    const existingVisitor=cookie&&/^[a-f0-9]{64}$/.test(cookie)?cookie:null;
    const startingSession=url.pathname==='/api/session'&&request.method==='POST';
    if(!existingVisitor&&!startingSession&&url.pathname!=='/api/health'){
      return errorResponse(request,401,'Start your demo workspace to continue.');
    }
    const visitor=existingVisitor??Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
    try{
      const db=await loadDatabase();
      if(url.pathname==='/api/health'){
        await db.all('SELECT 1 AS ready');
        return secureResponse(Response.json({ok:true,app:'MeterWise',version:'1.2.0',hosting:'Vercel',database:'Turso'},
          {headers:{'Cache-Control':'no-store'}}),request.url);
      }
      // The browser receives an unguessable workspace cookie. Incoming platform
      // identity headers are deliberately ignored on this independently hosted demo.
      const response=await handleApi(request,db,`vercel-demo:${visitor}`,{
        provisionWorkspace:(database,workspaceId)=>provisionDemoWorkspace(database,workspaceId,workspaceLimit)
      });
      if(!existingVisitor&&startingSession&&response.ok){
        response.headers.append('Set-Cookie',`mw_visitor=${visitor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${url.protocol==='https:'?'; Secure':''}`);
      }
      return response;
    }catch{
      return errorResponse(request,503,'The demo database is unavailable. Please try again shortly.');
    }
  };
}
