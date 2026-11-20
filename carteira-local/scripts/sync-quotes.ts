import { syncQuotes } from "../src/lib/quotes/sync";

// uso: npm run sync:quotes [-- --full] [-- PETR4 VALE3]
const full = process.argv.includes("--full");
const tickers = process.argv.slice(2).filter((a) => !a.startsWith("--"));
syncQuotes({ full, tickers: tickers.length ? tickers : undefined })
  .then((r) => console.table(r))
  .catch((e) => { console.error(e); process.exit(1); });
