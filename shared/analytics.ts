import type {Reading, Meter} from './types.js';
export const TIMEZONE = 'Asia/Singapore';
export const DAY_MS = 86_400_000;
export const round = (n: number, digits = 2) => Math.round((n + Number.EPSILON) * 10 ** digits) / 10 ** digits;
export function singaporeDate(value: string | number | Date) {
  const date = new Date(value);
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}
export function dayStart(day: string) { return new Date(`${day}T00:00:00+08:00`).getTime(); }
export function addDays(day: string, offset: number) { return singaporeDate(dayStart(day) + offset * DAY_MS); }
export function dateRange(from: string, to: string) {
  const count = Math.floor((dayStart(to) - dayStart(from)) / DAY_MS) + 1;
  if (!Number.isFinite(count) || count < 1 || count > 366) throw new Error('Choose a date range between 1 and 366 days.');
  return Array.from({length: count}, (_, i) => addDays(from, i));
}
export function previousRange(from: string, to: string) {
  const days = dateRange(from, to).length;
  return {from: addDays(from, -days), to: addDays(from, -1)};
}
export function sumReadings(readings: Reading[]) { return round(readings.reduce((sum, reading) => sum + Number(reading.consumption_kwh), 0)); }
export function expectedIntervals(meters: Meter[], from: string, to: string, now = Date.now()) {
  // A reading marks the START of a completed consumption interval. Never count future intervals.
  const start = dayStart(from);
  const end = Math.min(dayStart(addDays(to, 1)), now);
  return meters.reduce((total, meter) => total + Math.max(0, Math.floor((end - start) / (meter.interval_minutes * 60_000))), 0);
}
export function dailyChart(readings: Reading[], previous: Reading[], from: string, to: string) {
  const days = dateRange(from, to);
  const prev = previousRange(from, to);
  const currentTotals = new Map<string, number>();
  const previousTotals = new Map<string, number>();
  for (const reading of readings) { const day = singaporeDate(reading.recorded_at); currentTotals.set(day, (currentTotals.get(day) ?? 0) + Number(reading.consumption_kwh)); }
  for (const reading of previous) { const day = singaporeDate(reading.recorded_at); previousTotals.set(day, (previousTotals.get(day) ?? 0) + Number(reading.consumption_kwh)); }
  return days.map((day, i) => ({date: day, label: new Intl.DateTimeFormat('en-SG', {day:'numeric',month:'short',timeZone:TIMEZONE}).format(new Date(dayStart(day))), kwh: round(currentTotals.get(day) ?? 0), previous: round(previousTotals.get(addDays(prev.from, i)) ?? 0)}));
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) && typeof value !== 'number') text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
