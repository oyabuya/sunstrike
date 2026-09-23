// Read-only diagnostic: relaxed query counts never become deploy candidates.
import { config } from '../config.js';
import { buildDiscoveryFilters } from '../tools/screening.js';
const filters = buildDiscoveryFilters();
const snapshot = { at: new Date().toISOString(), timeframe: config.screening.timeframe, category: config.screening.category, stages: [] };
for (let i = 1; i <= filters.length; i++) {
  const query = new URLSearchParams({ page_size: '1', timeframe: snapshot.timeframe, category: snapshot.category, filter_by: filters.slice(0, i).join('&&') });
  const response = await fetch(`https://pool-discovery-api.datapi.meteora.ag/pools?${query}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.data) || !Number.isFinite(data.total)) throw new Error('Invalid discovery response');
  snapshot.stages.push({ added_filter: filters[i - 1], matches: data.total });
}
console.log(JSON.stringify(snapshot, null, 2));
