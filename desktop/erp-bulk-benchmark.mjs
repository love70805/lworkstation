// The existing native benchmark supplies an isolated HTTPS fixture, real inbox,
// Dexie adoption and profit worker. Only the dataset and selection mode differ.
import { fileURLToPath } from 'node:url';
process.env.ERP_BENCH_KIND = 'bulk';
process.env.ERP_BENCH_CAPS ||= '12';
process.env.ERP_BENCH_MODES ||= 'legacy-normal,bulk-normal,legacy-slow,bulk-slow,fallback';
process.env.ERP_BENCH_OUTPUT ||= fileURLToPath(new URL('../archive/erp-bulk-cost-1-0-12/native-benchmark/', import.meta.url));
await import('./erp-speed-benchmark.mjs');
