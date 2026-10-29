#!/usr/bin/env node
// Retrieves public Azure list prices from the Azure Retail Prices API (https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices)
// for a fixed, reviewable list of meters and writes docs/business/model/azure-prices.json. No credentials, no subscription, no Azure resource is touched:
// the API is anonymous and read-only. Prices are LIST prices in USD for one date; they are not a quote, ignore agreements and discounts, and say nothing about
// whether a service is available in a region under any residency rule. A meter present in a region is evidence of sale only.
//   node harness/scripts/azure-prices.mjs fetch     query the API and write the file (needs the network)
//   node harness/scripts/azure-prices.mjs check     validate the committed file's shape and provenance (offline)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = 'docs/business/model/azure-prices.json';
const API = 'https://prices.azure.com/api/retail/prices';

// Regions considered for an Asian port footprint. A region here is a candidate to check, not a recommendation.
export const REGIONS = ['southeastasia', 'eastasia', 'japaneast', 'koreacentral', 'australiaeast', 'centralindia', 'indonesiacentral', 'malaysiawest'];

// Exact meter selectors. `rule` says which tier is taken when a meter has tiers.
export const METERS = [
  { id: 'aca-vcpu-active', what: 'Container Apps, consumption, vCPU active', serviceName: 'Azure Container Apps', productName: 'Azure Container Apps', skuName: 'Standard', meterName: 'Standard vCPU Active Usage', unit: '1 Second' },
  { id: 'aca-vcpu-idle', what: 'Container Apps, consumption, vCPU idle', serviceName: 'Azure Container Apps', productName: 'Azure Container Apps', skuName: 'Standard', meterName: 'Standard vCPU Idle Usage', unit: '1 Second' },
  { id: 'aca-mem-active', what: 'Container Apps, consumption, memory active', serviceName: 'Azure Container Apps', productName: 'Azure Container Apps', skuName: 'Standard', meterName: 'Standard Memory Active Usage', unit: '1 GiB Second' },
  { id: 'aca-mem-idle', what: 'Container Apps, consumption, memory idle', serviceName: 'Azure Container Apps', productName: 'Azure Container Apps', skuName: 'Standard', meterName: 'Standard Memory Idle Usage', unit: '1 GiB Second' },
  { id: 'pg-gp-d4ds-v5', what: 'PostgreSQL flexible server, General Purpose Ddsv5, 4 vCore compute', serviceName: 'Azure Database for PostgreSQL', productName: 'Azure Database for PostgreSQL Flexible Server General Purpose Ddsv5 Series Compute', skuName: '4 vCore', meterName: 'vCore', unit: '1 Hour' },
  { id: 'pg-storage', what: 'PostgreSQL flexible server, storage', serviceName: 'Azure Database for PostgreSQL', productName: 'Azure Database for PostgreSQL Flex Server Storage', skuName: 'Storage', meterName: 'Storage Data Stored', unit: '1 GB/Month' },
  { id: 'pg-backup-lrs', what: 'PostgreSQL flexible server, backup storage LRS', serviceName: 'Azure Database for PostgreSQL', productName: 'Azure Database for PostgreSQL Flexible Server Backup Storage', skuName: 'Backup Storage LRS', meterName: 'Backup Storage LRS Data Stored', unit: '1 GB/Month' },
  { id: 'blob-hot-zrs', what: 'Blob storage, general-purpose v2, Hot ZRS data stored', serviceName: 'Storage', productName: 'General Block Blob v2', skuName: 'Hot ZRS', meterName: 'Hot ZRS Data Stored', unit: '1 GB/Month' },
  { id: 'blob-hot-lrs', what: 'Blob storage, general-purpose v2, Hot LRS data stored', serviceName: 'Storage', productName: 'General Block Blob v2', skuName: 'Hot LRS', meterName: 'Hot LRS Data Stored', unit: '1 GB/Month' },
  { id: 'sb-premium-mu', what: 'Service Bus Premium messaging unit', serviceName: 'Service Bus', productName: 'Service Bus', skuName: 'Premium', meterName: 'Premium Messaging Unit', unit: '1/Hour' },
  { id: 'sb-standard-base', what: 'Service Bus Standard base unit', serviceName: 'Service Bus', productName: 'Service Bus', skuName: 'Standard', meterName: 'Standard Base Unit', unit: '1/Month' },
  { id: 'akv-hsm-pool-b1', what: 'Key Vault Managed HSM pool, Standard B1 instance', serviceName: 'Key Vault', productName: 'Key Vault HSM Pool', skuName: 'Standard B1', meterName: 'Standard B1 Instance', unit: '1 Hour' },
  { id: 'law-ingest', what: 'Log Analytics, Analytics Logs ingestion (first charged tier)', serviceName: 'Log Analytics', productName: 'Log Analytics', skuName: 'Analytics Logs', meterName: 'Analytics Logs Data Ingestion', unit: '1 GB' },
  { id: 'law-retention', what: 'Log Analytics, Analytics Logs retention beyond the included period', serviceName: 'Log Analytics', productName: 'Log Analytics', skuName: 'Analytics Logs', meterName: 'Analytics Logs Data Retention', unit: '1 GB/Month' },
];

const q = (s) => String(s).replace(/'/g, "''");
export function filterFor(m, region) {
  return `serviceName eq '${q(m.serviceName)}' and productName eq '${q(m.productName)}' and skuName eq '${q(m.skuName)}' and meterName eq '${q(m.meterName)}' and armRegionName eq '${region}' and priceType eq 'Consumption'`;
}

// The first tier with a price above zero, taking the most recent effective date not in the future. Returns null when the region has no such meter.
export function pick(items, now = new Date(), unit = null) {
  const live = items.filter((i) => Number.isFinite(i.retailPrice) && Date.parse(i.effectiveStartDate) <= now.getTime() && (!unit || i.unitOfMeasure === unit));
  const paid = live.filter((i) => i.retailPrice > 0);
  if (!paid.length) return null;
  const minTier = Math.min(...paid.map((i) => i.tierMinimumUnits ?? 0));
  const ofTier = paid.filter((i) => (i.tierMinimumUnits ?? 0) === minTier).sort((a, b) => Date.parse(b.effectiveStartDate) - Date.parse(a.effectiveStartDate));
  const i = ofTier[0];
  return { retailPrice: i.retailPrice, unitOfMeasure: i.unitOfMeasure, tierMinimumUnits: i.tierMinimumUnits ?? 0, effectiveStartDate: i.effectiveStartDate, meterId: i.meterId, tiersSeen: [...new Set(live.map((x) => `${x.tierMinimumUnits ?? 0}:${x.retailPrice}`))].sort() };
}

async function getAll(url, fetchImpl) {
  const items = []; let next = url; let pages = 0;
  while (next && pages < 10) { const res = await fetchImpl(next); if (!res.ok) throw new Error(`Retail Prices API answered ${res.status}`); const j = await res.json(); items.push(...(j.Items ?? [])); next = j.NextPageLink; pages += 1; }
  return items;
}

export async function fetchAll({ fetchImpl = fetch, now = new Date() } = {}) {
  const meters = [];
  for (const m of METERS) {
    const perRegion = {};
    for (const r of REGIONS) {
      const url = `${API}?currencyCode=USD&$filter=${encodeURIComponent(filterFor(m, r))}`;
      perRegion[r] = pick(await getAll(url, fetchImpl), now, m.unit);
    }
    meters.push({ ...m, perRegion });
  }
  // Model meters: how many Azure OpenAI / Foundry model meters exist per region and which processing-scope hint their names carry. A heuristic over abbreviations in meter names.
  const aiHints = {};
  for (const r of REGIONS) {
    const items = await getAll(`${API}?currencyCode=USD&$filter=${encodeURIComponent(`armRegionName eq '${r}' and priceType eq 'Consumption' and contains(productName,'OpenAI')`)}`, fetchImpl);
    const names = [...new Set(items.map((i) => i.meterName))];
    const g = names.filter((n) => /(^|[\s-])(gl|glbl|global)([\s-]|$)/i.test(n)).length; const dz = names.filter((n) => /(^|[\s-])(dz|datazone)([\s-]|$)/i.test(n)).length;
    aiHints[r] = { meters: names.length, nameSuggestsGlobal: g, nameSuggestsDataZone: dz, neitherMarker: names.length - g - dz };
  }
  return { schema: 'greenfuel.azure-prices/v1', source: API, documentation: 'https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices', retrievedAt: now.toISOString(), currency: 'USD', priceType: 'Consumption list price (retail), no agreement or discount', regions: REGIONS, meters, aiMeterNameHints: aiHints,
    limits: ['List prices at the retrieval date; they change and differ by agreement.', 'A price meter in a region shows the item is sold there. It does not show the service meets any residency rule, runs in the zones needed, or supports private networking.', 'The model-meter hints come from abbreviations in meter names and are a heuristic, not a statement of where processing happens (D-028).', 'Services without a meter here (Microsoft Entra ID, private endpoints, API Management, defender tooling, edge hardware) are not priced and are scenario assumptions in the model.'] };
}

export function checkFile(file) {
  const errors = []; const fail = (m) => errors.push(m);
  let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return [`cannot read ${file}: ${e.message}`]; }
  if (j.schema !== 'greenfuel.azure-prices/v1') fail('schema is not greenfuel.azure-prices/v1');
  if (j.source !== API) fail('source must be the Azure Retail Prices API');
  if (Number.isNaN(Date.parse(j.retrievedAt))) fail('retrievedAt must be an ISO date');
  if (j.currency !== 'USD') fail('currency must be USD');
  const ids = new Set(METERS.map((m) => m.id));
  for (const m of j.meters ?? []) {
    if (!ids.has(m.id)) fail(`unknown meter ${m.id}`);
    for (const r of j.regions ?? []) { const p = m.perRegion?.[r]; if (p !== null && p !== undefined && !(p.retailPrice > 0 && p.meterId && p.effectiveStartDate)) fail(`${m.id}/${r}: a price needs retailPrice, meterId and effectiveStartDate`); }
  }
  for (const id of ids) if (!(j.meters ?? []).some((m) => m.id === id)) fail(`meter ${id} is missing`);
  if (!Array.isArray(j.limits) || j.limits.length < 3) fail('the limits statement is required');
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'fetch') {
    const data = await fetchAll();
    writeFileSync(path.join(root, OUT), `${JSON.stringify(data, null, 2)}\n`);
    const missing = data.meters.flatMap((m) => REGIONS.filter((r) => !m.perRegion[r]).map((r) => `${m.id}/${r}`));
    console.log(`azure-prices: wrote ${OUT} (${data.meters.length} meters x ${REGIONS.length} regions, retrieved ${data.retrievedAt}); ${missing.length} meter/region pair(s) have no price`);
  } else if (cmd === 'check') {
    const f = path.join(root, OUT);
    if (!existsSync(f)) { console.error(`FAIL ${OUT} is missing`); process.exit(1); }
    const errors = checkFile(f); errors.forEach((e) => console.error(`FAIL ${e}`));
    console.log(errors.length ? `${errors.length} problem(s)` : 'azure-prices: OK'); process.exit(errors.length ? 1 : 0);
  } else { console.error('usage: azure-prices.mjs fetch | check'); process.exit(2); }
}
