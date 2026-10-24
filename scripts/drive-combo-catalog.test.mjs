import assert from "node:assert/strict";
import { DRIVE_COMBO_SMOKE_ROWS, iecMapFromLabel, mapId } from "./drive-combo-catalog.mjs";

const m = iecMapFromLabel("1541·1541·1581·cmdhd");
assert.equal(m[8], "1541");
assert.equal(m[11], "cmdhd");
assert.equal(mapId(m), "8:1541|9:1541|10:1581|11:cmdhd");
assert.equal(DRIVE_COMBO_SMOKE_ROWS.length, 5);
assert.equal(DRIVE_COMBO_SMOKE_ROWS.find((r) => r.id === "SM-05")?.parkedSkip, true);

console.log("ok drive-combo-catalog");
