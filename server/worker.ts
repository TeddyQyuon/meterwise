import {handleApi} from './api';
import {d1Database} from './database';
import {secureResponse} from './security';
interface Env{DB:D1Database;ASSETS:Fetcher}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    if(new URL(request.url).pathname.startsWith('/api/')){
      if(!env.DB)return secureResponse(new Response(JSON.stringify({error:'The database is unavailable. Please try again shortly.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}),request.url);
      return handleApi(request,d1Database(env.DB),request.headers.get('oai-authenticated-user-id'),{platformIdentity:true});
    }
    return secureResponse(await env.ASSETS.fetch(request),request.url);
  }
};
