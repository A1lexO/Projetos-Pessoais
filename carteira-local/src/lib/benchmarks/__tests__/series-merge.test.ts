import { test } from "node:test";
import assert from "node:assert/strict";
import { planSeriesReplace } from "../series-merge.ts";

test("IPCA: from no meio do mês e API devolvendo o dia 01 do mês anterior ao from", () => {
  // banco já tem 2026-07-01 (seed); from = 2026-07-18; SGS devolve 01/07 (mês que contém from)
  const plan = planSeriesReplace("2026-07-18", [
    { date: "2026-07-01", value: 0.3 }, { date: "2026-08-01", value: 0.2 }, { date: "2026-09-01", value: 0.4 },
  ], true);
  assert.equal(plan.deleteFrom, "2026-07-01"); // apaga o 01/07 antes de reinserir
  assert.equal(plan.rows.length, 3);
});

test("séries diárias: exclusão cobre a 1ª data devolvida e duplicatas somem", () => {
  const plan = planSeriesReplace("2026-11-13", [
    { date: "2026-11-12", value: 1 }, { date: "2026-11-13", value: 2 }, { date: "2026-11-13", value: 3 },
  ]);
  assert.equal(plan.deleteFrom, "2026-11-12");
  assert.deepEqual(plan.rows, [{ date: "2026-11-12", value: 1 }, { date: "2026-11-13", value: 3 }]);
  assert.equal(planSeriesReplace("2026-11-13", []).deleteFrom, "2026-11-13");
});
