import {hdbCatalogue} from './hdb-data.js';
import {addDays, dayStart, dateRange, round, singaporeDate} from './analytics.js';

export const serviceLabels = {
  lighting: 'Common-area lighting',
  lifts: 'Lifts',
  pumps: 'Water pumps',
  solar: 'Rooftop solar',
};

export const estateBlocks = hdbCatalogue.blocks.map(block => ({...block}));

export const estateMeters = estateBlocks.flatMap((block, index) =>
  ['lighting', 'lifts', 'pumps', 'solar'].map(service => ({
    id: `${block.id}-${service.toUpperCase()}`,
    name: serviceLabels[service],
    block_id: block.id,
    service,
    tenant_id: block.town,
    location: `Blk ${block.block} ${block.street}`,
    interval_minutes: 60,
    threshold_kwh: service === 'lighting' ? 7 + index : service === 'lifts' ? 10 + index : service === 'pumps' ? 5 + index : 60,
  }))
);

export const estatePolicy = {
  tariff: 0.285,
  gridFactor: 0.402,
  gridFactorYear: 2024,
  timeZone: 'Asia/Singapore',
  highPriorityHours: 24,
  otherPriorityHours: 72,
};

// Named exports matching type identifiers for compatibility
export const Service = {};
export const EstateBlock = {};
export const EstateMeter = {};
export const EstateOrderStatus = {};
export const EstateOrder = {};
export const EstateEvent = {};
export const EstateIssue = {};
export const EnergyBalance = {};
export const EstateBlockSummary = {};
export const EstateOverview = {};

// Sum each block/hour independently. Excess generation in one block/hour
// cannot cancel grid imports in another; no missing value is treated as zero.
export function energyBalance(readings, meters, from, to) {
  const groups = new Map();
  for (const meter of meters) {
    groups.set(meter.block_id, [...(groups.get(meter.block_id) ?? []), meter]);
  }
  const start = dayStart(from);
  const end = dayStart(addDays(to, 1));
  const selected = readings.filter(row => row.recorded_at >= new Date(start).toISOString() && row.recorded_at < new Date(end).toISOString());
  const values = new Map(selected.map(row => [`${row.meter_id}|${row.recorded_at}`, row.consumption_kwh]));
  let load = 0;
  let solar = 0;
  let grid = 0;
  let selfConsumed = 0;
  let exported = 0;
  let received = 0;
  const expected = ((end - start) / 3_600_000) * meters.length;

  for (const [blockId, assets] of groups) {
    for (let time = start; time < end; time += 3_600_000) {
      const timestamp = new Date(time).toISOString();
      let intervalLoad = 0;
      let intervalSolar = 0;
      let count = 0;
      for (const meter of assets) {
        const value = values.get(`${meter.id}|${timestamp}`);
        if (value === undefined) continue;
        count++;
        received++;
        if (meter.service === 'solar') intervalSolar += value;
        else intervalLoad += value;
      }
      load += intervalLoad;
      solar += intervalSolar;
      if (count === assets.length) {
        grid += Math.max(0, intervalLoad - intervalSolar);
        selfConsumed += Math.min(intervalLoad, intervalSolar);
        exported += Math.max(0, intervalSolar - intervalLoad);
      }
    }
  }
  const complete = expected > 0 && received === expected;
  return {
    load: round(load),
    solar: round(solar),
    grid: complete ? round(grid) : null,
    selfConsumed: complete ? round(selfConsumed) : null,
    exported: complete ? round(exported) : null,
    complete,
    received,
    expected,
    coverage: expected ? round((received / expected) * 100, 2) : 0,
  };
}

export function calculateEstate(readings, prior, blocks, meters, from, to) {
  const balance = energyBalance(readings, meters, from, to);
  const days = dateRange(from, to);
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(priorTo, 1 - days.length);
  const previous = energyBalance(prior, meters, priorFrom, priorTo);

  const summaries = blocks.map(block => {
    const result = energyBalance(readings, meters.filter(meter => meter.block_id === block.id), from, to);
    return {
      ...block,
      ...result,
      kwhPerUnit: result.complete ? round(result.load / block.units, 2) : null,
      cost: result.grid === null ? null : round(result.grid * estatePolicy.tariff),
      co2Kg: result.grid === null ? null : round(result.grid * estatePolicy.gridFactor),
      issues: 0,
    };
  });

  const chart = days.map(date => {
    const point = energyBalance(readings, meters, date, date);
    return {
      date,
      label: new Intl.DateTimeFormat('en-SG', {day: 'numeric', month: 'short', timeZone: 'Asia/Singapore'}).format(new Date(dayStart(date))),
      load: point.load,
      solar: point.solar,
      grid: point.grid,
    };
  });

  const ids = new Set(meters.map(meter => meter.id));
  const services = ['lighting', 'lifts', 'pumps', 'solar'].map(service => ({
    service,
    kwh: round(readings.filter(row => ids.has(row.meter_id) && meters.find(meter => meter.id === row.meter_id)?.service === service).reduce((sum, row) => sum + row.consumption_kwh, 0)),
  }));

  const change = balance.complete && previous.complete && previous.load > 0 ? round(((balance.load - previous.load) / previous.load) * 100, 1) : null;
  return {balance, summaries, chart, services, change};
}

export const permittedEstateBlocks = (role) => role === 'manager' ? estateBlocks : estateBlocks.filter(block => block.town === 'Ang Mo Kio');

export function estateIssues(readings, meters, from, to) {
  const issues = [];
  for (const meter of meters) {
    const rows = readings.filter(row => row.meter_id === meter.id);
    const expected = dateRange(from, to).length * 24;
    if (rows.length < expected) {
      issues.push({
        key: `${meter.id}|missing`,
        block_id: meter.block_id,
        meter_id: meter.id,
        kind: 'missing',
        title: 'Missing meter intervals',
        detail: `${expected - rows.length} hourly intervals are missing. Restore data before estimating grid use or carbon.`,
        priority: 'medium',
      });
    }
    const spikes = rows.filter(row => row.consumption_kwh > meter.threshold_kwh);
    if (meter.service !== 'solar' && spikes.length) {
      issues.push({
        key: `${meter.id}|threshold`,
        block_id: meter.block_id,
        meter_id: meter.id,
        kind: 'threshold',
        title: `${serviceLabels[meter.service]} above threshold`,
        detail: `${spikes.length} intervals exceeded ${meter.threshold_kwh} kWh. Latest: ${singaporeDate(spikes.at(-1).recorded_at)}. Inspect the asset; this rule does not diagnose a fault.`,
        priority: 'high',
      });
    }
  }
  return issues;
}
