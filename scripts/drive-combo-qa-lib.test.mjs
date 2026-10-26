import assert from "node:assert/strict";
import { firstPrgNameFromListing } from "./drive-combo-qa-lib.mjs";

assert.equal(firstPrgNameFromListing('"BOULDER DASH" PRG'), "BOULDER DASH");
assert.equal(firstPrgNameFromListing("0 \"TEST\"       PRG   2049"), "TEST");
assert.equal(firstPrgNameFromListing("no files here"), null);

console.log("ok drive-combo-qa-lib");
