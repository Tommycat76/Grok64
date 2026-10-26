#!/usr/bin/env node
/**
 * Click the CRT with a real (trusted) mouse, then type. The first keys after the
 * click must reach BASIC — mouse mode on and off, with typing that starts after
 * the button is released (gap) and typing that starts while the button is still
 * down (lead / overlap), plus a no-click baseline.
 *
 *   node scripts/desktop-click-first-key-qa.mjs
 *   GROK64_CLICK_GAPS=0,40 GROK64_CLICK_LEADS=30,60 GROK64_CLICK_HOLD_MS=110 node scripts/desktop-click-first-key-qa.mjs
 *
 * The "superhuman" profile (~340 wpm) overlaps every key with the next and leaves ~15 ms
 * solo windows, shorter than one KERNAL scan; the stock KERNAL drops some of those on real
 * hardware too, so it is reported but not gated.
 *
 * A screen click holds port 2 fire (or the 1351 left button), which is CIA1 PA4, the line of
 * keyboard column 4 (9 I J 0 M K O N). A column-4 key pressed and released entirely inside the
 * click shorts PA4 to its row, so every column scan reads that row and the C64 types a ghost key
 * instead, as real hardware does. Gated cases keep column-4 keys out of the click; "port2-held"
 * gates that a column-4 key held past the release still types, "port2-inside" reports the ghost.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
  assertSessionFlags,
  patchLocalStorage,
  powerOnDesktop,
  seedTomReusedProfile,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const nums = (v, d) => (v ?? d).split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
const gaps = nums(process.env.GROK64_CLICK_GAPS, "0,40,150");
const leads = nums(process.env.GROK64_CLICK_LEADS, "30,70");
const holdMs = Number(process.env.GROK64_CLICK_HOLD_MS || "110");
const modes = (process.env.GROK64_CLICK_MOUSE_MODES || "on,off").split(",").map((s) => s.trim() === "on");
const profileNames = (process.env.GROK64_CLICK_PROFILES || "steady,brisk,superhuman").split(",").map((s) => s.trim());
const tag = process.env.GROK64_CLICK_TAG || "";
const shotDir = join(process.cwd(), "screenshots", "click-first-key");
const outDir = join(process.cwd(), "artifacts", "click-first-key");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

if (!grok64DatapathFromEnv()) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "no-core" }));
  process.exit(0);
}

const WORDS = ["QWERTY", "ASDFGH", "ZXCVBN", "POIUYT", "LKJHGF", "MNBVCX", "WERTYU", "SDFGHJ", "XCVBNM", "TREWQA"];
const PROFILES = {
  steady: { dwell: 70, interval: 130, gate: true },
  brisk: { dwell: 95, interval: 70, gate: true },
  superhuman: { dwell: 55, interval: 35, gate: false },
};
const PORT2_FIRE_COLUMN = new Set(["9", "I", "J", "0", "M", "K", "O", "N"]);

/** Keys pressed and released while the mouse button is still down. */
function keysInsideClick(word, profile, c) {
  if (!c.click) return [];
  return [...word].filter((_, i) => {
    const down = c.firstKeyAt + i * profile.interval;
    return down >= 0 && down + profile.dwell <= holdMs;
  });
}

async function boot(page, mouse) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await seedTomReusedProfile(page, { jiffyDos: false, mouseMode: mouse });
  await patchLocalStorage(page, { video: "auto", jiffy: false, reu: "2048kB", drive: "cmd-layout", mouse });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await assertSessionFlags(page, { mouseMode: mouse, reuSize: "2048kB" });
  await page.waitForTimeout(1500);
}

async function screenCenter(page) {
  const box = await page.locator(".g64-screen").first().boundingBox();
  if (!box) throw new Error("no .g64-screen box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The line under the last READY., without trailing blanks (leading ones are typed ghosts). */
async function cursorLine(page) {
  const text = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const lines = text.split("\n").map((l) => l.trimEnd());
  const ready = lines.map((l, i) => (/^READY\.$/.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  return ready.length ? lines[ready[ready.length - 1] + 1] ?? "" : "";
}

/**
 * One timeline: optional mouse down/up on the CRT plus overlapping key strokes.
 * `firstKeyAt` is relative to the mouse down (or to t0 without a click).
 */
function buildTimeline(word, profile, { click, firstKeyAt }) {
  const ev = [];
  if (click) {
    ev.push({ at: 0, kind: "mousedown" });
    ev.push({ at: holdMs, kind: "mouseup" });
  }
  for (let i = 0; i < word.length; i++) {
    const down = firstKeyAt + i * profile.interval;
    ev.push({ at: down, kind: "keydown", code: `Key${word[i]}` });
    ev.push({ at: down + profile.dwell, kind: "keyup", code: `Key${word[i]}` });
  }
  const order = { mouseup: 0, keyup: 1, mousedown: 2, keydown: 3 };
  return ev.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

async function runTimeline(page, center, events) {
  const t0 = Date.now();
  for (const e of events) {
    const wait = t0 + e.at - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    if (e.kind === "mousedown") {
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
    } else if (e.kind === "mouseup") {
      await page.mouse.up();
    } else if (e.kind === "keydown") {
      await page.keyboard.down(e.code);
    } else {
      await page.keyboard.up(e.code);
    }
  }
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const mouse of modes) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await installGrok64CoreNetworkGuard(page, base);
    await boot(page, mouse);
    const center = await screenCenter(page);
    let w = 0;
    const cases = [];
    for (const typing of profileNames) {
      if (!PROFILES[typing]) continue;
      cases.push({ typing, click: false, firstKeyAt: 0, label: "noclick" });
      for (const gap of gaps) cases.push({ typing, click: true, firstKeyAt: holdMs + gap, label: `after+${gap}` });
      for (const lead of leads) cases.push({ typing, click: true, firstKeyAt: holdMs - lead, label: `overlap-${lead}` });
    }
    if (PROFILES.steady) {
      cases.push({ typing: "steady", click: true, firstKeyAt: holdMs - 30, label: "port2-held", word: "MNBVCX", match: "contains" });
      cases.push({ typing: "steady", click: true, firstKeyAt: holdMs - 70, label: "port2-inside", word: "MNBVCX", gate: false });
    }
    for (const c of cases) {
      const profile = PROFILES[c.typing];
      const gate = c.gate ?? profile.gate;
      let word = c.word;
      while (!word) {
        const next = WORDS[w++ % WORDS.length];
        if (!gate || !keysInsideClick(next, profile, c).some((k) => PORT2_FIRE_COLUMN.has(k))) word = next;
      }
      await page.evaluate(() => window.__g64?.typeBasic?.("PRINTCHR$(147)", { delayMs: 40 }));
      await page.waitForTimeout(900);
      if (c.click) {
        await page.locator("header").first().click({ position: { x: 4, y: 4 }, force: true }).catch(() => {});
        await page.waitForTimeout(200);
      }
      await runTimeline(page, center, buildTimeline(word, profile, c));
      await page.waitForTimeout(700);
      const raw = await cursorLine(page);
      const typed = raw.trim();
      const ok = c.match === "contains" ? typed.includes(word) : typed.startsWith(word);
      const lead = raw.length - raw.trimStart().length;
      const row = { mouse, typing: c.typing, gate, case: c.label, holdMs, word, typed: typed.slice(0, 12), lead, ok };
      results.push(row);
      console.log(JSON.stringify(row));
      if ((!ok && gate) || c.label.startsWith("port2")) {
        const kind = !ok && gate ? "fail" : "case";
        await page.screenshot({
          path: join(shotDir, `${kind}${tag ? `-${tag}` : ""}-mouse-${mouse ? "on" : "off"}-${c.typing}-${c.label}.png`),
        });
      }
      await page.keyboard.press("Enter", { delay: 60 });
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: join(shotDir, `last${tag ? `-${tag}` : ""}-mouse-${mouse ? "on" : "off"}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
const gated = results.filter((r) => r.gate);
const failed = gated.filter((r) => !r.ok);
const info = results.filter((r) => !r.gate);
writeFileSync(
  join(outDir, `results${tag ? `-${tag}` : ""}.json`),
  JSON.stringify({ gaps, leads, holdMs, profiles: PROFILES, results }, null, 2),
);
console.log(
  JSON.stringify({
    pass: failed.length === 0,
    gated: gated.length,
    failed: failed.length,
    informational: { total: info.length, dropped: info.filter((r) => !r.ok).length },
  }),
);
process.exit(failed.length ? 1 : 0);
