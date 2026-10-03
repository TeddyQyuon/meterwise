import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Sequelize,QueryTypes} from 'sequelize';
import type {Database,Statement} from './database.js';

export async function createLocalDatabase():Promise<Database>{
  if(process.env.DB_DIALECT==='mysql')return createMysqlDatabase();
  mkdirSync('data',{recursive:true});
  const sqlite=new DatabaseSync(process.env.SQLITE_PATH??'data/meterwise.sqlite');
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  const applied=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get();
  if(!applied){for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(resolve('drizzle',file),'utf8'));sqlite.exec('PRAGMA optimize;');}
  const run=(sql:string,params:unknown[]=[])=>{const result=sqlite.prepare(sql).run(...params as (string|number|null)[]);return {changes:Number(result.changes)};};
  return {
    async all<T>(sql:string,params:unknown[]=[]){return sqlite.prepare(sql).all(...params as (string|number|null)[]) as T[];},
    async run(sql,params=[]){return run(sql,params);},
    async batch(statements:Statement[]){sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>run(statement.sql,statement.params));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}
  };
}
async function createMysqlDatabase():Promise<Database>{
  const sequelize=new Sequelize(process.env.DB_NAME??'meterwise',process.env.DB_USER??'root',process.env.DB_PASSWORD??'',{host:process.env.DB_HOST??'127.0.0.1',port:Number(process.env.DB_PORT??3306),dialect:'mysql',logging:false,pool:{max:5,min:0}});
  await sequelize.authenticate();
  // A bounded, explicit local MySQL schema mirrors the hosted SQLite/D1 schema.
  const schema:Record<string,string>={
    workspaces:'id VARCHAR(191) PRIMARY KEY,name VARCHAR(191) NOT NULL,tariff DOUBLE NOT NULL,seeded INT NOT NULL DEFAULT 0,created_at VARCHAR(32) NOT NULL',
    sessions:'token_hash VARCHAR(191) PRIMARY KEY,workspace_id VARCHAR(191) NOT NULL,role VARCHAR(32) NOT NULL,tenant_id VARCHAR(64),expires_at BIGINT NOT NULL,INDEX idx_sessions_expires(expires_at)',
    tenants:'`key` VARCHAR(191) PRIMARY KEY,workspace_id VARCHAR(191) NOT NULL,id VARCHAR(64) NOT NULL,name VARCHAR(191) NOT NULL,floor VARCHAR(191) NOT NULL,color VARCHAR(32) NOT NULL,UNIQUE KEY idx_tenants_workspace_id(workspace_id,id)',
    meters:'`key` VARCHAR(191) PRIMARY KEY,workspace_id VARCHAR(191) NOT NULL,id VARCHAR(64) NOT NULL,name VARCHAR(191) NOT NULL,tenant_id VARCHAR(64) NOT NULL,location VARCHAR(191) NOT NULL,threshold_kwh DOUBLE NOT NULL,interval_minutes INT NOT NULL,UNIQUE KEY idx_meters_workspace_id(workspace_id,id)',
    readings:'id VARCHAR(191) PRIMARY KEY,workspace_id VARCHAR(191) NOT NULL,meter_id VARCHAR(64) NOT NULL,recorded_at VARCHAR(32) NOT NULL,consumption_kwh DOUBLE NOT NULL,UNIQUE KEY idx_readings_meter_timestamp(workspace_id,meter_id,recorded_at),INDEX idx_readings_workspace_time(workspace_id,recorded_at)',
    alerts:'id VARCHAR(191) PRIMARY KEY,workspace_id VARCHAR(191) NOT NULL,meter_id VARCHAR(64) NOT NULL,type VARCHAR(64) NOT NULL,title VARCHAR(191) NOT NULL,detail TEXT NOT NULL,severity VARCHAR(32) NOT NULL,status VARCHAR(32) NOT NULL,recorded_at VARCHAR(32) NOT NULL,INDEX idx_alerts_workspace_meter(workspace_id,meter_id)',
    notes:'id VARCHAR(191) PRIMARY KEY,workspace_id VARCHAR(191) NOT NULL,alert_id VARCHAR(191) NOT NULL,body TEXT NOT NULL,author VARCHAR(191) NOT NULL,created_at VARCHAR(32) NOT NULL,INDEX idx_notes_alert(alert_id)',
    imports:'id VARCHAR(191) PRIMARY KEY,workspace_id VARCHAR(191) NOT NULL,file_name VARCHAR(191) NOT NULL,accepted INT NOT NULL,skipped INT NOT NULL,rejected INT NOT NULL,created_at VARCHAR(32) NOT NULL,INDEX idx_imports_workspace(workspace_id)'
  };
  for(const [table,columns] of Object.entries(schema))await sequelize.query(`CREATE TABLE IF NOT EXISTS ${table} (${columns}) ENGINE=InnoDB`);
  const mysqlSql=(sql:string)=>sql.replaceAll('INSERT OR IGNORE','INSERT IGNORE').replace(/\(key,/g,'(`key`,');
  return {
    async all<T>(sql:string,params:unknown[]=[]){return await sequelize.query(mysqlSql(sql),{replacements:params,type:QueryTypes.SELECT}) as T[];},
    async run(sql,params=[]){const [,metadata]=await sequelize.query(mysqlSql(sql),{replacements:params});return {changes:Number((metadata as {affectedRows?:number}).affectedRows??metadata??0)};},
    async batch(statements){return sequelize.transaction(async transaction=>{const results=[];for(const statement of statements){const [,metadata]=await sequelize.query(mysqlSql(statement.sql),{replacements:statement.params,transaction});results.push({changes:Number((metadata as {affectedRows?:number}).affectedRows??metadata??0)});}return results;});}
  };
}
