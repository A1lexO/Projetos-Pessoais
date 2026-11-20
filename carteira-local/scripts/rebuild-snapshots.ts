import { rebuildSnapshots } from "../src/lib/services/snapshots";

rebuildSnapshots()
  .then((r) => { console.log(r); if (r.warnings.length) console.warn("avisos:", r.warnings); })
  .catch((e) => { console.error(e); process.exit(1); });
