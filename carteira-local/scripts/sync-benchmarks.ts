import { syncSgsBenchmark } from "../src/lib/benchmarks/sgs";
import { syncIbovespa } from "../src/lib/quotes/sync";

// uso: npm run sync:benchmarks [-- --full]
const full = process.argv.includes("--full");
async function main() {
  for (const key of ["CDI", "SELIC", "IPCA"] as const) console.log(await syncSgsBenchmark(key, { full }));
  console.log("IBOV", await syncIbovespa({ full }));
}
main().catch((e) => { console.error(e); process.exit(1); });
