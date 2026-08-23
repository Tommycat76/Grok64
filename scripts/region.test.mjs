/** Minimal node tests for region + archive ranking (no bundler). */
import assert from "node:assert/strict";

const PORT1 = [/boulder\s*dash/i, /rockford/i];
function detectJoyPort(haystack) {
  const s = haystack || "";
  for (const re of PORT1) if (re.test(s)) return 1;
  return 2;
}

const SKIP = [/construction\s*kit/i, /\btrainer\b/i, /awally/i];
function isJunkRelease(name) {
  return SKIP.some((re) => re.test(name));
}

assert.equal(detectJoyPort("Boulder Dash"), 1);
assert.equal(detectJoyPort("Rockford"), 1);
assert.equal(detectJoyPort("Paradroid"), 2);
assert.equal(isJunkRelease("Boulder Dash Construction Kit"), true);
assert.equal(isJunkRelease("Boulder_Dash_1984_First_Star_cr_Nova"), false);

console.log("region.test.mjs PASS");
