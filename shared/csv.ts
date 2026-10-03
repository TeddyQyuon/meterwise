import type {ImportPreview, Meter, Reading} from './types';
export function parseCsv(text: string): {line: number; cells: string[]}[] {
  const rows: {line: number; cells: string[]}[] = [];
  let cells: string[] = [], field = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') { if (input[i + 1] === '"') {field += '"'; i++;} else {quoted = false; closed = true;} }
      else {field += char; if (char === '\n') line++;}
    } else if (char === '"') {
      if (field.trim() || closed) throw new Error(`Unexpected quote on line ${line}.`);
      quoted = true;
    } else if (char === ',') {cells.push(field); field = ''; closed = false;}
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      cells.push(field);
      if (cells.some(cell => cell.trim())) rows.push({line: rowLine, cells});
      cells = []; field = ''; closed = false; line++; rowLine = line;
    } else {
      if (closed && char.trim()) throw new Error(`Unexpected text after a closing quote on line ${line}.`);
      field += char;
    }
  }
  if (quoted) throw new Error('A quoted field is not closed.');
  cells.push(field);
  if (cells.some(cell => cell.trim())) rows.push({line:rowLine,cells});
  return rows;
}
export function validateCsv(text: string, meters: Meter[], existing: Set<string>, now = Date.now()): ImportPreview {
  if (!text.trim()) throw new Error('Choose a CSV file containing meter readings.');
  if (new TextEncoder().encode(text).length > 1_000_000) throw new Error('CSV files must be smaller than 1 MB.');
  const rows = parseCsv(text);
  const header = rows.shift()?.cells.map(cell => cell.trim().toLowerCase()) ?? [];
  const required = ['meter_id', 'timestamp', 'consumption_kwh'];
  if (new Set(header).size !== header.length || required.some(column => !header.includes(column))) throw new Error('CSV headers must include meter_id, timestamp, and consumption_kwh, without duplicate columns.');
  if (rows.length > 1500) throw new Error('Import up to 1,500 readings per file. Split larger files into smaller batches.');
  const meterMap = new Map(meters.map(meter => [meter.id, meter]));
  const seen = new Set(existing);
  const result: ImportPreview = {total:rows.length, valid:0, duplicate:0, invalid:0,issues:[],readings:[],range:null};
  for (const row of rows) {
    const meterId = row.cells[header.indexOf('meter_id')]?.trim() ?? '';
    const rawTime = row.cells[header.indexOf('timestamp')]?.trim() ?? '';
    const rawKwh = row.cells[header.indexOf('consumption_kwh')]?.trim() ?? '';
    const meter = meterMap.get(meterId);
    const recorded = new Date(rawTime);
    const offset = rawTime.match(/([+-])(\d{2}):(\d{2})$/);
    const offsetMinutes = offset ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
    const calendarMatches = Number.isFinite(recorded.getTime()) && new Date(recorded.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 16) === rawTime.slice(0, 16);
    const kwh = Number(rawKwh);
    let message = '';
    if (row.cells.length !== header.length) message = 'Column count does not match the header.';
    else if (!meter) message = 'Meter ID is not registered in this building.';
    else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawTime) || !calendarMatches) message = 'Use a valid ISO timestamp with a timezone, such as 2026-10-01T09:00:00+08:00.';
    else if (recorded.getTime() > now) message = 'Reading is in the future.';
    else if (recorded.getTime() + meter.interval_minutes * 60_000 > now) message = 'This consumption interval has not finished yet.';
    else if ((recorded.getTime() + 8 * 3_600_000) % (meter.interval_minutes * 60_000) !== 0) message = `Reading must start on a ${meter.interval_minutes}-minute interval.`;
    else if (!rawKwh || !Number.isFinite(kwh) || kwh < 0 || kwh > 100_000) message = 'Consumption must be a number between 0 and 100,000 kWh.';
    if (message) {result.invalid++; result.issues.push({line:row.line,meter:meterId,message,kind:'invalid'}); continue;}
    const time = recorded.toISOString();
    const key = `${meterId}|${time}`;
    if (seen.has(key)) { result.duplicate++; result.issues.push({line:row.line,meter:meterId,message:'This meter and timestamp already have a reading.',kind:'duplicate'}); continue; }
    seen.add(key);
    result.readings.push({meter_id:meterId,recorded_at:time,consumption_kwh:kwh});
    result.valid++;
  }
  if (result.readings.length) {const times = result.readings.map(row=>row.recorded_at).sort();result.range={from:times[0],to:times[times.length-1]};}
  return result;
}
