import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../server/api';
import {createLocalDatabase} from '../server/local-database';
import {MAX_REQUEST_BYTES,secureResponse} from '../server/security';
import type {Database} from '../server/database';
import type {Session} from '../shared/types';

const unavailable:Database={all:async()=>{throw new Error('Database must not be reached');},run:async()=>{throw new Error('Database must not be reached');},batch:async()=>{throw new Error('Database must not be reached');}};
const request=(body:BodyInit,headers:Record<string,string>={})=>new Request('https://meterwise.test/api/session',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});

test('unsafe origins and malformed JSON are rejected before database work',async()=>{
  for(const body of ['null','[]','"manager"','{broken','42'])assert.equal((await handleApi(request(body),unavailable,'owner')).status,400);
  assert.equal((await handleApi(request('{"role":"manager"}',{'Content-Type':'text/plain'}),unavailable,'owner')).status,415);
  assert.equal((await handleApi(request(new Uint8Array([0x7b,0xc3,0x28,0x7d])),unavailable,'owner')).status,400);
  assert.equal((await handleApi(request('{}',{Origin:'https://evil.test'}),unavailable,'owner')).status,403);
  assert.equal((await handleApi(request('{}',{'Sec-Fetch-Site':'cross-site'}),unavailable,'owner')).status,403);
  assert.equal((await handleApi(request('{}'),unavailable,null)).status,401);
});

test('body size is bounded by streamed bytes, including multibyte text and missing length',async()=>{
  assert.equal((await handleApi(request('{}',{'Content-Length':String(MAX_REQUEST_BYTES+1)}),unavailable,'owner')).status,413);
  assert.equal((await handleApi(request(JSON.stringify({csv:'é'.repeat(560000)})),unavailable,'owner')).status,413);
  let cancelled=false,pulls=0;
  const body=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(300000));},cancel(){cancelled=true;}});
  const streamed=new Request('https://meterwise.test/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body,duplex:'half'} as RequestInit&{duplex:string});
  assert.equal((await handleApi(streamed,unavailable,'owner')).status,413);
  assert.equal(cancelled,true);assert.ok(pulls<=6,'an unbounded stream must stop once the limit is crossed');
});

test('valid sessions, errors, CSV downloads and documents receive security headers',async()=>{
  process.env.SQLITE_PATH=':memory:';process.env.DB_DIALECT='sqlite';
  const db=await createLocalDatabase();
  const session=await handleApi(request('{"role":"manager"}'),db,'headers-owner');
  assert.equal(session.status,200);
  const cookie=session.headers.get('Set-Cookie')!;assert.match(cookie,/HttpOnly; SameSite=Lax/);assert.match(cookie,/; Secure/);
  const headers={Cookie:cookie.split(';')[0]};
  const sample=await handleApi(new Request('https://meterwise.test/api/sample.csv',{headers}),db,'headers-owner');
  const error=await handleApi(new Request('https://meterwise.test/api/dashboard'),db,null);
  const document=secureResponse(new Response('<!doctype html><h1>MeterWise</h1>',{headers:{'Content-Type':'text/html'}}),'https://meterwise.test/');
  for(const response of [session,sample,error,document]){
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    assert.match(response.headers.get('Permissions-Policy')!,/camera=\(\)/);
    assert.equal(response.headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');
    assert.match(response.headers.get('Strict-Transport-Security')!,/max-age=31536000/);
  }
  assert.equal(sample.headers.get('Cache-Control'),'no-store');assert.equal(error.headers.get('Cache-Control'),'no-store');
  assert.match(document.headers.get('Content-Security-Policy')!,/script-src 'self'/);
  assert.match(document.headers.get('Content-Security-Policy')!,/frame-ancestors 'self' https:\/\/chatgpt.com/);
});

test('CSV validation queries only candidate intervals and rejects unsafe filenames',async()=>{
  process.env.SQLITE_PATH=':memory:';process.env.DB_DIALECT='sqlite';
  const db=await createLocalDatabase();
  const initialized=await handleApi(request('{"role":"manager"}'),db,'bounded-import-owner');
  const info=await initialized.json() as Session;
  const cookie=initialized.headers.get('Set-Cookie')!.split(';')[0];
  const readingQueries:{sql:string;params:unknown[]}[]=[];
  const bounded:Database={...db,all:async<T>(sql:string,params:unknown[]=[])=>{if(sql.startsWith('SELECT meter_id,recorded_at FROM readings'))readingQueries.push({sql,params});return db.all<T>(sql,params);}};
  const send=(path:string,body:unknown)=>handleApi(new Request(`https://meterwise.test/api${path}`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)}),bounded,'bounded-import-owner');
  assert.equal((await send('/imports/preview',{csv:'not a valid header'})).status,400);
  assert.equal(readingQueries.length,0,'invalid CSV must not load the reading history');
  const meter=info.meters[0].id;
  const csv=['meter_id,timestamp,consumption_kwh',...Array.from({length:130},(_,index)=>`${meter},${new Date(Date.UTC(2020,0,1,index)).toISOString()},3.2`)].join('\n');
  const preview=await send('/imports/preview',{csv});assert.equal(preview.status,200);assert.equal((await preview.json() as {valid:number}).valid,130);
  assert.ok(readingQueries.length>0);assert.ok(readingQueries.every(query=>query.params.length<=100&&query.sql.includes('workspace_id=? AND (')&&query.sql.includes('meter_id=? AND recorded_at=?')));
  for(const fileName of ['','../readings.csv','bad\u0000.csv'])assert.equal((await send('/imports/commit',{csv,fileName})).status,400);
});
