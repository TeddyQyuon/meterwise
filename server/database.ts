export type Statement = {sql:string;params:unknown[]};
export type DbResult = {changes:number};
export interface Database {
  all<T = Record<string,unknown>>(sql:string,params?:unknown[]):Promise<T[]>;
  run(sql:string,params?:unknown[]):Promise<DbResult>;
  batch(statements:Statement[]):Promise<DbResult[]>;
}
export function d1Database(db:D1Database):Database {
  return {
    async all<T>(sql:string,params:unknown[]=[]){const result=await db.prepare(sql).bind(...params).all<T>();return result.results;},
    async run(sql,params=[]){const result=await db.prepare(sql).bind(...params).run();return {changes:result.meta.changes??0};},
    async batch(statements){const results=await db.batch(statements.map(statement=>db.prepare(statement.sql).bind(...statement.params)));return results.map(result=>({changes:result.meta.changes??0}));}
  };
}
