import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { runningCoreMismatch, bytesHaveGrok64DiskAttach } = await server.ssrLoadModule(
  "/src/lib/emu/grok64-core-loaded.ts",
);
const { isGrok64CoreCacheRequestUrl, isEmulatorJsViceCoreStorageKey, CORE_REFRESH_BUDGET, CORE_REFRESH_MAX, rewriteGrok64CoreDownloadUrl } =
  await server.ssrLoadModule("/src/lib/emu/grok64-ejs-core-cache.ts");
const { applyGrok64LocalCoreDownloadArgs, ejsCoreDownloadLeaf, ejsDownloadFileArity, requestHasForbiddenCoreCacheHeader } =
  await server.ssrLoadModule("/src/lib/emu/grok64-ejs-core-download.ts");
const { displayKindOf, kindLabelFor } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
const { appendGrok64CoreUrlCacheParams, GROK64_CORE_HEAL_PENDING_SS, GROK64_CORE_AUTO_RELOAD_SS } =
  await server.ssrLoadModule("/src/lib/emu/grok64-core-url.ts");
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

test("live WASM disk attach wins over a glue sample that missed the export name", () => {
  const report = runningCoreMismatch({
    coreStarted: true,
    diskExportsPresent: true,
    glue: { glueBytes: 1200, glueSha12: "deadbeef0001", glueHasDiskExports: false, recordedAt: 1 },
    expectedBuildId: "36a7cd049a97",
    expectedGlueSha12: "d41b59759aa4",
  });
  assert.equal(report.mismatch, false);
  assert.notEqual(report.loadedBuildId, "stale-no-disk-exports");
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
  assert.equal(CORE_REFRESH_BUDGET, 3);
  assert.equal(CORE_REFRESH_MAX, 6);
});

test("filename wins over a stale stored kind on the Software list", () => {
  assert.equal(displayKindOf("GEOS Boot Disk.d64", "d81"), "d64");
  assert.match(kindLabelFor("GEOS Boot Disk.d64", "d81"), /1541 disk/i);
  assert.equal(displayKindOf("Wheels.d81", "d64"), "d81");
});

test("EmulatorJS-core filename keys are vice cores even without ?EJS_KEYS!", () => {
  assert.equal(isEmulatorJsViceCoreStorageKey("vice_x64sc-wasm.data"), true);
  assert.equal(isEmulatorJsViceCoreStorageKey("?EJS_KEYS!"), false);
  assert.equal(isEmulatorJsViceCoreStorageKey("GROK64.state"), false);
});

test("Cache Storage matcher still hits a heal-nonce core URL", () => {
  assert.equal(
    isGrok64CoreCacheRequestUrl(
      "https://app/system/vice/emulatorjs/data/cores/vice_x64sc-grok64-iec-wasm.data?grok64core=36a7cd049a97&grok64heal=2",
    ),
    true,
  );
});

test("heal nonce is added only while a heal reload is pending", () => {
  const base = "https://app/system/vice/emulatorjs/data/cores/vice_x64sc-grok64-iec-wasm.data";
  const before = appendGrok64CoreUrlCacheParams(base);
  assert.doesNotMatch(before, /grok64heal=/);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(GROK64_CORE_HEAL_PENDING_SS, "1");
    sessionStorage.setItem(GROK64_CORE_AUTO_RELOAD_SS, "2");
    const during = appendGrok64CoreUrlCacheParams(base);
    assert.match(during, /grok64heal=2/);
    sessionStorage.removeItem(GROK64_CORE_HEAL_PENDING_SS);
    sessionStorage.removeItem(GROK64_CORE_AUTO_RELOAD_SS);
  }
});

test("stable 4-arg downloadFile keeps opts and sets notWithPath at index 2", () => {
  const opts = { responseType: "arraybuffer", method: "GET" };
  const next = applyGrok64LocalCoreDownloadArgs(
    ["cores/vice_x64sc-wasm.data", null, false, opts],
    4,
    "http://local/cores/vice_x64sc-grok64-iec-wasm.data",
  );
  assert.equal(next[0], "http://local/cores/vice_x64sc-grok64-iec-wasm.data");
  assert.equal(next[2], true);
  assert.equal(typeof next[3], "object");
  assert.equal(next[3].method, "GET");
  assert.equal(next[3].responseType, "arraybuffer");
  assert.notEqual(next[3], true);
});

test("stable 4-arg never treats args[3]=true as notWithPath when opts were smashed", () => {
  const next = applyGrok64LocalCoreDownloadArgs(
    ["https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-legacy-wasm.data", () => {}, true, true],
    4,
    "http://local/cores/vice_x64sc-grok64-iec-wasm.data",
  );
  assert.equal(next[2], true);
  assert.equal(typeof next[3], "object");
  assert.equal(next[3].method, "GET");
});

test("latest 8-arg downloadFile sets notWithPath at index 3 and dontCache at 6", () => {
  function eight(_a, _b, _c, _d, _e, _f, _g, _h) {}
  assert.equal(ejsDownloadFileArity(eight), 8);
  const next = applyGrok64LocalCoreDownloadArgs(
    ["cores/vice_x64sc-wasm.data?v=1", "Core", null, false, { method: "GET" }, false, false, false],
    8,
    "http://local/cores/vice_x64sc-grok64-iec-wasm.data",
  );
  assert.equal(next[3], true);
  assert.equal(typeof next[4], "object");
  assert.equal(next[6], true);
  assert.equal(ejsCoreDownloadLeaf("cores/vice_x64sc-wasm.data?v=99"), "vice_x64sc-wasm.data");
});

test("core requests must not carry Cache-Control or Pragma", () => {
  assert.equal(requestHasForbiddenCoreCacheHeader({ "cache-control": "no-cache" }), true);
  assert.equal(requestHasForbiddenCoreCacheHeader({ Pragma: "no-cache" }), true);
  assert.equal(requestHasForbiddenCoreCacheHeader({ accept: "*/*" }), false);
});

test("CDN vice .data rewrites to the local IEC blob when a canonical URL is known", () => {
  const local = "http://127.0.0.1:8080/system/vice/emulatorjs/data/cores/vice_x64sc-grok64-iec-wasm.data";
  assert.equal(
    rewriteGrok64CoreDownloadUrl("https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-legacy-wasm.data", local),
    local,
  );
  assert.equal(
    rewriteGrok64CoreDownloadUrl("https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-wasm.js", local),
    "https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-wasm.js",
  );
});

test("disk-attach fingerprint scans the whole buffer, not a 2.5MB head", () => {
  const padded = new Uint8Array(100);
  const name = new TextEncoder().encode("grok64_disk_attach");
  padded.set(name, 70);
  assert.equal(bytesHaveGrok64DiskAttach(padded), true);
  assert.equal(bytesHaveGrok64DiskAttach(new Uint8Array(32)), false);
});
