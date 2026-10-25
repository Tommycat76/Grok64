import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { runningCoreMismatch } = await server.ssrLoadModule("/src/lib/emu/grok64-core-loaded.ts");
const { isGrok64CoreCacheRequestUrl, CORE_REFRESH_BUDGET } = await server.ssrLoadModule(
  "/src/lib/emu/grok64-ejs-core-cache.ts",
);
const { formatMissingDiskExportsMessage, formatViceReattachFailure } = await server.ssrLoadModule(
  "/src/lib/emu/disk-mount-ready.ts",
);
await server.close();

test("a running core without grok64_disk_attach is a mismatch even when glue was never recorded", () => {
  const report = runningCoreMismatch({
    coreStarted: true,
    diskExportsPresent: false,
    glue: null,
    expectedBuildId: "36a7cd049a97",
    expectedGlueSha12: "d41b59759aa4",
  });
  assert.equal(report.mismatch, true);
  assert.equal(report.reason, "wasm-exports-missing");
  assert.equal(report.expectedBuildId, "36a7cd049a97");
});

test("glue without the disk-attach symbol is stale", () => {
  const report = runningCoreMismatch({
    coreStarted: false,
    diskExportsPresent: false,
    glue: { glueBytes: 1200, glueSha12: "deadbeef0001", glueHasDiskExports: false, recordedAt: 1 },
    expectedBuildId: "36a7cd049a97",
    expectedGlueSha12: "d41b59759aa4",
  });
  assert.equal(report.mismatch, true);
  assert.equal(report.reason, "glue-missing-disk-exports");
  assert.equal(report.loadedBuildId, "stale-no-disk-exports");
});

test("glue SHA that is not the manifest SHA is a mismatch even if WASM exports exist", () => {
  const report = runningCoreMismatch({
    coreStarted: true,
    diskExportsPresent: true,
    glue: { glueBytes: 2000, glueSha12: "aaaaaaaaaaaa", glueHasDiskExports: true, recordedAt: 1 },
    expectedBuildId: "36a7cd049a97",
    expectedGlueSha12: "d41b59759aa4",
  });
  assert.equal(report.mismatch, true);
  assert.equal(report.reason, "glue-sha-mismatch");
});

test("matching glue plus live disk attach is not a mismatch", () => {
  const report = runningCoreMismatch({
    coreStarted: true,
    diskExportsPresent: true,
    glue: { glueBytes: 2000, glueSha12: "d41b59759aa4", glueHasDiskExports: true, recordedAt: 1 },
    expectedBuildId: "36a7cd049a97",
    expectedGlueSha12: "d41b59759aa4",
  });
  assert.equal(report.mismatch, false);
  assert.equal(report.reason, null);
});

test("glue-only stage does not treat missing WASM exports as stale", () => {
  const report = runningCoreMismatch({
    coreStarted: false,
    diskExportsPresent: false,
    glue: { glueBytes: 2000, glueSha12: "d41b59759aa4", glueHasDiskExports: true, recordedAt: 1 },
    expectedBuildId: "36a7cd049a97",
    expectedGlueSha12: "d41b59759aa4",
  });
  assert.equal(report.mismatch, false);
});

test("Cache Storage purge only matches VICE / Grok64 core blobs", () => {
  assert.equal(
    isGrok64CoreCacheRequestUrl("https://app/system/vice/emulatorjs/data/cores/vice_x64sc-grok64-iec-wasm.data?grok64core=36a7cd049a97"),
    true,
  );
  assert.equal(isGrok64CoreCacheRequestUrl("https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-wasm.data"), true);
  assert.equal(isGrok64CoreCacheRequestUrl("https://app/assets/index-abc.js"), false);
  assert.equal(isGrok64CoreCacheRequestUrl("https://app/icon.png"), false);
});

test("missing-exports toast names the loaded and needed build instead of rc=-99", () => {
  const msg = formatMissingDiskExportsMessage({
    loadedBuildId: "stale-no-disk-exports",
    expectedBuildId: "36a7cd049a97",
  });
  assert.match(msg, /old VICE core without disk attach/);
  assert.match(msg, /stale-no-disk-exports/);
  assert.match(msg, /36a7cd049a97/);
  const attach = formatViceReattachFailure(
    -99,
    {
      path: "/home/web_user/retroarch/userdata/saves/vice_work.d64",
      rc: -99,
      before: null,
      after: null,
      at: Date.now(),
      stage: "exports-missing",
      jsReason: "js-exports-missing",
      attachRc: -99,
      cReached: false,
    },
    null,
  );
  assert.match(attach, /old VICE core without disk attach/);
  assert.doesNotMatch(attach, /rc=-99/);
  assert.equal(CORE_REFRESH_BUDGET, 2);
});
