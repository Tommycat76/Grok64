#!/usr/bin/env node
/**
 * NUVIE / REU video playback — 16 MB REU, frame motion, no hang.
 *   GROK64_NUVIE_DIR=/path  or  GROK64_NUVIE_URL=prg-url (optional GROK64_NUVIE_REU_URL=)
 *   npm run test:desktop-nuvie
 *
 * Without env, fetches nuvieplayer + C64ReloadedMK2-Ad.reu from CSDb (free releases).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const dir = process.env.GROK64_NUVIE_DIR;
const outDir = join(process.cwd(), "artifacts", "desktop-nuvie-e2e");
const fixtureDir = join(process.cwd(), "public", "__e2e_nuvie");
mkdirSync(outDir, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });

const STEM = "nuvie-play";
const DEFAULT_PLAYER =
  "http://csdb.dk/getinternalfile.php/110242/nuvieplayer1.0.prg";
const DEFAULT_REU =
  "http://csdb.dk/getinternalfile.php/160329/C64ReloadedMK2-Ad.reu";

async function fetchBytes(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`NUVIE fetch ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function materializeFixtures() {
  if (dir && existsSync(dir)) {
    const names = readdirSync(dir);
    const prgName = names.find((f) => /\.prg$/i.test(f));
    const reuName = names.find((f) => /\.(reu|nuv)$/i.test(f));
    if (!prgName || !reuName) {
      return { ok: false, reason: "GROK64_NUVIE_DIR needs a .prg player and .reu/.nuv video" };
    }
    writeFileSync(join(fixtureDir, `${STEM}.prg`), readFileSync(join(dir, prgName)));
    writeFileSync(join(fixtureDir, `${STEM}.reu`), readFileSync(join(dir, reuName)));
    return { ok: true, source: `dir:${prgName}+${reuName}` };
  }
  const prgUrl = process.env.GROK64_NUVIE_URL || process.env.GROK64_NUVIE_PRG_URL || DEFAULT_PLAYER;
  const reuUrl = process.env.GROK64_NUVIE_REU_URL || DEFAULT_REU;
  const prg = await fetchBytes(prgUrl);
  const reu = await fetchBytes(reuUrl);
  writeFileSync(join(fixtureDir, `${STEM}.prg`), prg);
  writeFileSync(join(fixtureDir, `${STEM}.reu`), reu);
  return { ok: true, source: "csdb-default" };
}

const mat = await materializeFixtures();
if (!mat.ok) {
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ skipped: true, reason: mat.reason }));
  console.log("SKIP desktop-nuvie —", mat.reason);
  process.exit(0);
}

const fixtureBase = new URL(`/__e2e_nuvie/${STEM}`, base).href;

async function frameSample(page, n, gapMs) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const sig = await page.evaluate(async () => {
      const shot = await window.__g64?.shot?.();
      if (!shot?.b64) return "";
      return shot.b64.slice(0, 512);
    });
    samples.push(sig);
    await page.waitForTimeout(gapMs);
  }
  return new Set(samples.filter(Boolean)).size;
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await patchLocalStorage(page, {
  video: "pal",
  sid: "6581",
  reu: "16384kB",
  drive: "1541",
});
await page.reload();
await powerOnDesktop(page, base, { navigate: false });

const reuOk = await page.evaluate(() => {
  window.__g64?.setReuSize?.("16384kB");
  const rt = window.__g64?.runtimeViceOpts?.() || {};
  return rt.vice_ram_expansion_unit === "16384kB";
});

const playOk = await page.evaluate(async ({ stem, root }) => {
  const prgRes = await fetch(`${root}.prg`);
  const reuRes = await fetch(`${root}.reu`);
  if (!prgRes.ok || !reuRes.ok) return false;
  const prg = await prgRes.arrayBuffer();
  const reu = await reuRes.arrayBuffer();
  await window.__g64?.playNuvie?.(prg, reu, stem);
  return true;
}, { stem: STEM, root: fixtureBase });

if (!playOk) {
  const report = { source: mat.source, pass: false, error: "fixture fetch or playNuvie failed" };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
  process.exit(1);
}

await waitRunning(page, 120000);
await page.waitForTimeout(6000);
await page.evaluate(() => window.__g64?.toggleWarp?.());
const unique = await frameSample(page, 8, 2500);
const alive = await page.evaluate(
  () => window.__g64?.powered?.() && !document.querySelector(".g64-splash[data-on='true']"),
);

const report = {
  source: mat.source,
  reu16mb: reuOk,
  uniqueFrames: unique,
  alive,
  pass: reuOk && alive && unique >= 2,
};
writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await browser.close();
process.exit(report.pass ? 0 : 1);
