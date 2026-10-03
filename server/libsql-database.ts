import {createClient,type Client,type InValue} from '@libsql/client';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Database} from './database';

export function libsqlDatabase(client:Client):Database {
  return {
    async all<T>(sql:string,params:unknown[]=[]){
      const result=await client.execute({sql,args:params as InValue[]});
      return result.rows.map(row=>({...row})) as T[];
    },
    async run(sql,params=[]){
      const result=await client.execute({sql,args:params as InValue[]});
      return {changes:result.rowsAffected};
    },
    async batch(statements){
      if(!statements.length)return [];
      const results=await client.batch(statements.map(({sql,params})=>({sql,args:params as InValue[]})),'write');
      return results.map(result=>({changes:result.rowsAffected}));
    }
  };
}

export async function initializeLibsql(client:Client):Promise<Database>{
  const migration=readFileSync(resolve('drizzle/0000_loving_quentin_quire.sql'),'utf8');
  const statements=migration.split('--> statement-breakpoint').map(sql=>sql.trim())
    .filter(Boolean).map(sql=>sql.replace(/CREATE (TABLE|(?:UNIQUE )?INDEX) /g,'CREATE $1 IF NOT EXISTS '));
  await client.batch(statements,'write');
  return libsqlDatabase(client);
}

let database:Promise<Database>|undefined;
export function getTursoDatabase():Promise<Database>{
  if(database)return database;
  const url=process.env.TURSO_DATABASE_URL;
  const authToken=process.env.TURSO_AUTH_TOKEN;
  if(!url||!authToken||!['libsql:','https:'].includes(new URL(url).protocol)){
    return Promise.reject(new Error('Turso environment configuration is unavailable.'));
  }
  const client=createClient({url,authToken,intMode:'number'});
  database=initializeLibsql(client).catch(error=>{client.close();database=undefined;throw error;});
  return database;
}
