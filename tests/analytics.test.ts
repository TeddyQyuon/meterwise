import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addDays,dailyChart,expectedIntervals,previousRange,singaporeDate,sumReadings,csvCell} from '../shared/analytics';
import {validateCsv,parseCsv} from '../shared/csv';
import {demoMeters} from '../server/seed';

test('Singapore day boundaries and previous reporting periods are correct',()=>{
  assert.equal(singaporeDate('2026-09-30T16:00:00Z'),'2026-10-01');
  assert.equal(addDays('2026-10-01',-1),'2026-09-30');
  assert.deepEqual(previousRange('2026-09-25','2026-10-01'),{from:'2026-09-18',to:'2026-09-24'});
  const chart=dailyChart([{meter_id:'MW-001',recorded_at:'2026-09-30T16:00:00Z',consumption_kwh:7.15}],[{meter_id:'MW-001',recorded_at:'2026-09-29T16:00:00Z',consumption_kwh:8.25}],'2026-10-01','2026-10-01');
  assert.equal(chart[0].kwh,7.15);assert.equal(chart[0].previous,8.25);
});
test('coverage counts completed intervals and consumption preserves valid zeros',()=>{
  const now=new Date('2026-10-01T10:30:00+08:00').getTime();
  assert.equal(expectedIntervals([demoMeters[0]],'2026-10-01','2026-10-01',now),10);
  assert.equal(expectedIntervals(demoMeters,'2026-09-01','2026-09-07',now),1008);
  assert.equal(sumReadings([{meter_id:'MW-001',recorded_at:'',consumption_kwh:0},{meter_id:'MW-001',recorded_at:'',consumption_kwh:0.1},{meter_id:'MW-001',recorded_at:'',consumption_kwh:0.2}]),0.3);
});
test('CSV validation handles BOM, reordered columns, quotes, invalid data and duplicates',()=>{
  const csv='\uFEFFconsumption_kwh,timestamp,meter_id\r\n"4.20","2026-10-01T09:00:00+08:00","MW-006"\r\n4.20,2026-10-01T01:00:00Z,MW-006\r\n-1,2026-10-01T10:00:00+08:00,MW-006\r\n2,2026-10-01T10:00:00,MW-006\r\n2,2026-10-01T10:00:00+08:00,UNKNOWN\r\n0,2026-10-01T11:00:00+08:00,MW-006';
  const result=validateCsv(csv,demoMeters,new Set(),new Date('2026-10-02T00:00:00+08:00').getTime());
  assert.equal(result.valid,2);assert.equal(result.duplicate,1);assert.equal(result.invalid,3);assert.equal(result.readings[1].consumption_kwh,0);
  const again=validateCsv(csv,demoMeters,new Set(result.readings.map(row=>`${row.meter_id}|${row.recorded_at}`)),new Date('2026-10-02T00:00:00+08:00').getTime());assert.equal(again.valid,0);assert.equal(again.duplicate,3);
  assert.deepEqual(parseCsv('a,b\n"with,comma","two\nlines"')[1].cells,['with,comma','two\nlines']);
});
test('invalid calendar dates, unfinished intervals, malformed CSV and formulas are handled',()=>{
  const result=validateCsv('meter_id,timestamp,consumption_kwh\nMW-001,2026-02-30T09:00:00+08:00,2\nMW-001,2026-10-01T10:00:00+08:00,2',demoMeters,new Set(),new Date('2026-10-01T10:30:00+08:00').getTime());
  assert.equal(result.invalid,2);
  assert.throws(()=>parseCsv('a,b\n"unclosed'),/not closed/);
  assert.throws(()=>validateCsv('meter_id,timestamp,timestamp\na,b,c',demoMeters,new Set()),/headers/);
  assert.equal(csvCell('=SUM(A1:A2)'),`"'=SUM(A1:A2)"`);
});
