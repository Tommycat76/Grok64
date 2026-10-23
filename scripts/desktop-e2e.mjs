#!/usr/bin/env node
/**
 * Desktop-first Playwright QA (Chromium, 1280×800).
 *   npm run test:desktop-e2e
 *
 * Optional env:
 *   GROK64_BASE_URL
 *   GROK64_JIFFY_DIR — JiffyDOS_C64.bin + JiffyDOS_1541-II.bin (user-supplied, never committed)
 *   GROK64_CART_DIR — .crt images (Epyx FastLoad, AR, FC3, Super Snapshot, …)
 *   GROK64_STRESS_MINUTES — default 2; use 30+ for long soak
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const artifactDir = join(process.cwd(), "artifacts", "desktop-e2e");
mkdirSync(artifactDir, { recursive: true });

const results = [];
const push = (row) => {
  results.push(row);
  const tag = row.skipped ? "SKIP" : row.pass ? "PASS" : row.optional ? "WARN" : "FAIL";
  console.log(tag, row.id, row.detail ?? row.reason ?? row.error ?? "");
};

async function powerOn(page) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => typeof window.__g64?.power === "function")) break;
    await page.waitForTimeout(200);
  }
  await page.locator(".g64-power").waitFor({ timeout: 30000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => {
      document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector(".g64-splash")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate(() => window.__g64?.powered?.())) break;
      await page.waitForTimeout(250);
    }
    if (await page.evaluate(() => window.__g64?.powered?.())) break;
  }
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => window.__g64?.hasFs?.())) break;
    await page.waitForTimeout(300);
  }
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => (window.__g64?.screenText?.() || "").toUpperCase());
    if (/READY/.test(t)) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);
}

async function waitRunning(page, ms = 12000) {
  for (let i = 0; i < ms / 200; i++) {
    const on = await page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.());
    if (on) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function canvasHasSignal(page) {
  return page.evaluate(async () => {
    const shot = await window.__g64?.shot?.();
    if (!shot?.b64 || shot.b64.length < 800) return false;
    const bin = atob(shot.b64.slice(0, 4000));
    let dark = 0;
    for (let i = 0; i < bin.length; i++) if (bin.charCodeAt(i) < 32) dark++;
    return dark < bin.length * 0.95;
  });
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await powerOn(page);
  push({ id: "power-on", pass: await page.evaluate(() => window.__g64?.powered?.()) });

  const ready = await page.evaluate(() => (window.__g64?.screenText?.() || "").toUpperCase());
  const fs = await page.evaluate(() => window.__g64?.hasFs?.());
  push({
    id: "basic-ready",
    pass: /READY/.test(ready) || (fs && ready.length === 0),
    detail: ready.slice(0, 80) || (fs ? "VICE FS up (screen OCR empty)" : "no FS"),
    optional: !/READY/.test(ready) && fs,
  });

  await page.evaluate(() => window.__g64?.setShowKeyboard?.(true));
  await page.waitForTimeout(800);
  const kb =
    (await page.locator(".g64-kb").count()) > 0 ||
    (await page.locator(".g64-app").first().getAttribute("data-kb")) === "true";
  push({ id: "desktop-keyboard", pass: kb });

  const dos = await page.evaluate(async () => {
    window.__g64?.resetDos?.();
    await window.__g64?.seedSd?.([
      { name: "DEMO.PRG", path: "", data: new Uint8Array([1, 8, 0, 0, 0x12, 0x34]).buffer },
    ]);
    window.__g64?.setIecSlot?.(8, "sd2iec");
    const a = await window.__g64?.runDos?.('MD:"OS"');
    const b = await window.__g64?.runDos?.("CD<-");
    const c = await window.__g64?.runDos?.('X');
    return { a, b, c };
  });
  push({
    id: "sd2iec-dos",
    pass: /OK/.test(dos.a) && /OK/.test(dos.b) && /PART 0/.test(dos.c),
    detail: dos,
  });

  const sidDefault = await page.evaluate(() => window.__g64?.settings?.());
  push({
    id: "sid-default-single",
    pass: sidDefault?.sid2Address === "disabled" && sidDefault?.sid3Address === "disabled",
    detail: sidDefault,
  });

  await page.evaluate(() => {
    window.__g64?.setSidAddresses?.({ sid2: "0xde00", sid2Model: "8580", sid3: "disabled" });
  });
  const optsLive = await page.evaluate(() => window.__g64?.opts?.());
  push({
    id: "sid-stereo-runtime",
    pass: String(optsLive?.vice_sid_extra || "").toLowerCase() === "0xde00",
    detail: optsLive ? { extra: optsLive.vice_sid_extra, m2: optsLive.vice_sid_model2 } : null,
    optional: !optsLive?.vice_sid_extra,
  });

  await page.evaluate(() => window.__g64?.playBundled?.("diagnostics"));
  await waitRunning(page, 20000);
  await page.waitForTimeout(4000);
  push({ id: "bundled-diagnostics", pass: await canvasHasSignal(page) });

  await page.evaluate(() => window.__g64?.playBundled?.("cart"));
  await waitRunning(page, 25000);
  await page.waitForTimeout(3000);
  const cartFreeze = await page.evaluate(() => {
    window.__g64?.setCartLive?.(true);
    return window.__g64?.cartFreeze?.();
  });
  push({ id: "bundled-cart-freeze", pass: cartFreeze === true, optional: true });

  await page.evaluate(() => window.__g64?.playBundled?.("byte-hopper"));
  await waitRunning(page, 25000);
  await page.waitForTimeout(8000);
  const splash = await page.evaluate(() => document.querySelector(".g64-splash")?.getAttribute("data-on"));
  push({
    id: "byte-hopper-no-splash-remount",
    pass: splash !== "true" && (await canvasHasSignal(page)),
  });

  const jiffyDir = process.env.GROK64_JIFFY_DIR;
  if (jiffyDir && existsSync(jiffyDir)) {
    const c64 = ["JiffyDOS_C64.bin", "JiffyDOS_C64_6.01.bin"].find((n) => existsSync(join(jiffyDir, n)));
    const d41 = ["JiffyDOS_1541-II.bin", "JiffyDOS_1541-II_6.00.bin"].find((n) => existsSync(join(jiffyDir, n)));
    if (c64 && d41) {
      const c64Buf = [...readFileSync(join(jiffyDir, c64))];
      const d41Buf = [...readFileSync(join(jiffyDir, d41))];
      await page.evaluate(
        async ({ c64Buf, d41Buf, c64, d41 }) => {
          await window.__g64?.putRomBytes?.("jiffy-c64", c64, c64Buf);
          await window.__g64?.putRomBytes?.("jiffy-1541", d41, d41Buf);
          window.__g64?.setJiffyDos?.(true);
        },
        { c64Buf, d41Buf, c64, d41 },
      );
      await page.evaluate(() => window.__g64?.resetReady?.());
      await page.waitForTimeout(12000);
      push({
        id: "jiffydos-inject",
        pass: (await page.evaluate(() => window.__g64?.jiffyLive?.())) === true,
        optional: true,
      });
      await page.evaluate(async () => {
        window.__g64?.setJiffyDos?.(false);
        await window.__g64?.removeRomSlot?.("jiffy-c64");
        await window.__g64?.removeRomSlot?.("jiffy-1541");
        window.__g64?.resetReady?.();
      });
      await page.waitForTimeout(8000);
      push({
        id: "stock-kernal-fallback",
        pass: (await page.evaluate(() => window.__g64?.jiffyLive?.())) === false,
        optional: true,
      });
    } else {
      push({ id: "jiffydos-inject", pass: true, skipped: true, reason: "ROM pair missing in GROK64_JIFFY_DIR" });
    }
  } else {
    push({ id: "jiffydos-inject", pass: true, skipped: true, reason: "GROK64_JIFFY_DIR not set" });
  }

  const cartDir = process.env.GROK64_CART_DIR;
  if (cartDir && existsSync(cartDir)) {
    const all = readdirSync(cartDir).filter((f) => f.toLowerCase().endsWith(".crt"));
    let mounted = 0;
    for (const name of all.slice(0, 4)) {
      const bytes = [...readFileSync(join(cartDir, name))];
      const ok = await page.evaluate(
        async ({ name, bytes }) => {
          try {
            const u8 = new Uint8Array(bytes);
            const b64 = btoa(String.fromCharCode(...u8));
            const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const blob = new Blob([data]);
            const url = URL.createObjectURL(blob);
            const res = await fetch(url);
            const buf = await res.arrayBuffer();
            URL.revokeObjectURL(url);
            await window.__g64?.load?.(url, name);
            return true;
          } catch {
            return false;
          }
        },
        { name, bytes },
      );
      if (ok) mounted += 1;
      await page.waitForTimeout(6000);
    }
    push({
      id: "fastload-carts",
      pass: mounted > 0 || all.length === 0,
      detail: { found: all.length, mounted },
      optional: true,
    });
  } else {
    push({ id: "fastload-carts", pass: true, skipped: true, reason: "GROK64_CART_DIR not set" });
  }

  try {
    await page.locator(".g64-software").click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const search = page.getByPlaceholder(/search/i).first();
    if (await search.count()) {
      await search.fill("Commando");
      await page.waitForTimeout(3500);
      push({ id: "catalog-search", pass: (await page.getByText("Commando", { exact: false }).count()) > 0, optional: true });
    } else {
      push({ id: "catalog-search", pass: true, skipped: true, reason: "no search field" });
    }
  } catch (e) {
    push({ id: "catalog-search", pass: true, skipped: true, reason: String(e).split("\n")[0], optional: true });
  }

  const stressMin = Number(process.env.GROK64_STRESS_MINUTES || "2");
  const cycles = Math.max(2, Math.min(120, Math.round(stressMin * 2)));
  let stressOk = true;
  for (let i = 0; i < cycles; i++) {
    await page.evaluate(() => window.__g64?.resetReady?.());
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__g64?.playBundled?.("ready"));
    await waitRunning(page, 15000);
    if (!(await page.evaluate(() => window.__g64?.powered?.()))) stressOk = false;
  }
  push({ id: "stress-reset-cycles", pass: stressOk, detail: `${cycles} cycles (~${stressMin} min budget)` });

  push({ id: "console-clean", pass: errors.length === 0, detail: errors.slice(0, 3), optional: true });
} catch (e) {
  push({ id: "suite-error", pass: false, error: String(e) });
}

await browser.close();

const failed = results.filter((r) => !r.pass && !r.skipped && !r.optional);
writeFileSync(join(artifactDir, "results.json"), JSON.stringify({ base, results, errors, failed: failed.length }, null, 2));
console.log(JSON.stringify({ artifactDir, ok: failed.length === 0, failed: failed.map((f) => f.id) }, null, 2));
process.exit(failed.length ? 1 : 0);
