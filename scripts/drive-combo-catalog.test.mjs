import assert from "node:assert/strict";
import {
  DRIVE_COMBO_SMOKE_ROWS,
  iecMapForHarness,
  iecMapFromLabel,
  mapId,
  rowTouchesCmdHd,
} from "./drive-combo-catalog.mjs";

const m = iecMapFromLabel("1541·1541·1581·cmdhd");
assert.equal(m[8], "1541");
assert.equal(m[11], "cmdhd");
assert.equal(mapId(m), "8:1541|9:1541|10:1581|11:cmdhd");
assert.equal(DRIVE_COMBO_SMOKE_ROWS.length, 5);
assert.equal(DRIVE_COMBO_SMOKE_ROWS.find((r) => r.id === "SM-05")?.parkedSkip, true);
const sm01 = DRIVE_COMBO_SMOKE_ROWS.find((r) => r.id === "SM-01");
assert.equal(rowTouchesCmdHd(sm01), false);
assert.equal(iecMapForHarness(sm01, { cmdRomAvailable: false })[11], "none");
assert.equal(iecMapForHarness(sm01, { cmdRomAvailable: false })[10], "none");

console.log("ok drive-combo-catalog");
