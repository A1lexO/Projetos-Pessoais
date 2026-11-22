import { syncAllBenchmarks } from "../src/lib/services/sync-benchmarks";

// uso: npm run sync:benchmarks [-- --full]
const full = process.argv.includes("--full");
syncAllBenchmarks({ full })
  .then((r) => {
    console.table(r);
    process.exitCode = r.some((x) => !x.ok) ? 1 : 0;
  })
  .catch((e) => { console.error(e); process.exit(1); });
