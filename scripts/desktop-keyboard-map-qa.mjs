#!/usr/bin/env node
/**
 * Every key lands on the C64 key it names, per the core's positional keymap
 * (vice-libretro `retrodep/arch_keymap.c`, X64: Backslash is =, Insert is £, OEM-102 is < / >,
 * Tab is CTRL, Left Ctrl is C=). Covers on-screen keys (tapped in the UI), host keys with real
 * Shift chords (Shift held, as from a physical keyboard), fast shifted typing order, and typeC64.
 * Each case types on a fresh `REM` line and reads screen RAM at the cursor.
 *
 *   node scripts/desktop-keyboard-map-qa.mjs
 * Output: artifacts/keyboard-map/results.json, screenshots/keyboard-map.png
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertGrok64WasmCore, grok64DatapathFromEnv, installGrok64CoreNetworkGuard } from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "keyboard-map");
mkdirSync(outDir, { recursive: true });
mkdirSync(join(process.cwd(), "screenshots"), { recursive: true });
if (!grok64DatapathFromEnv()) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** ASCII → C64 screen code for the characters these cases type. */
function sc(text) {
  return [...text].map((ch) => {
    if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 64;
    if (ch === "@") return 0;
    if (ch === "£") return 0x1c;
    return ch.charCodeAt(0);
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await installGrok64CoreNetworkGuard(page, base);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message || e)));
const cases = [];
let fatal = null;

const drain = async () => {
  await sleep(150);
  await page.evaluate(() => window.__g64?.kbdDrain?.());
  await sleep(120);
};
const cursor = () =>
  page.evaluate(() => {
    const r = window.__g64.readC64Byte;
    const row = r(0xd6);
    const col = r(0xd3);
    const line = [];
    for (let i = 0; i < 40; i++) line.push(r(0x0400 + row * 40 + i));
    return { row, col, line };
  });
const blurUi = () => page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
const hostPress = async (combo) => {
  await blurUi();
  await page.keyboard.press(combo, { delay: 60 });
  await drain();
};
const hostType = async (text) => {
  await blurUi();
  await page.keyboard.type(text, { delay: 70 });
  await drain();
};
const osk = async (id) => {
  await page.locator(`.g64-kb [data-key-id="${id}"]`).first().click();
  await drain();
};
const layer = async (sym) => {
  const now = await page.locator(".g64-kb").getAttribute("data-layer");
  if ((now === "sym") !== sym) {
    await page.locator(".g64-kb-bar > button").first().click();
    await page.waitForFunction((want) => document.querySelector(".g64-kb")?.getAttribute("data-layer") === want, sym ? "sym" : "abc");
  }
};
const freshLine = async () => {
  await hostPress("Enter");
  await hostType("rem");
};
/** Screen codes after `REM`; the cell under the blinking cursor is read without its reverse bit. */
const check = async (label, want, { from = 3 } = {}) => {
  const c = await cursor();
  const got = c.line.slice(from, from + want.length).map((v, i) => (from + i === c.col ? v & 0x7f : v));
  const pass = got.every((v, i) => v === want[i]);
  cases.push({ label, pass, want: want.map((v) => v.toString(16)), got: got.map((v) => v.toString(16)) });
};

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await patchLocalStorage(page, { video: "pal", jiffy: false, mouse: false });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), null, { timeout: 90_000 });
  await sleep(1200);
  await page.locator('button[aria-label="Keyboard"]:visible').first().click();
  await page.locator(".g64-kb").waitFor({ state: "visible", timeout: 10_000 });

  await layer(false);
  for (const [id, glyph] of [
    ["eq", "="],
    ["pound", "£"],
    ["plus", "+"],
    ["minus", "-"],
    ["at", "@"],
    ["star", "*"],
    ["colon", ":"],
    ["semi", ";"],
  ]) {
    await freshLine();
    await osk(id);
    await check(`on-screen ${id} → ${glyph}`, sc(glyph));
  }
  for (const [id, code] of [
    ["uparr", 0x1e],
    ["arr", 0x1f],
  ]) {
    await freshLine();
    await osk(id);
    await check(`on-screen ${id} → screen code ${code.toString(16)}`, [code]);
  }

  await freshLine();
  await osk("cbm");
  await osk("a");
  await osk("cbm");
  await check("on-screen C= + A → C= graphic (screen code 70)", [0x70]);

  await freshLine();
  await osk("ctrl");
  await osk("r");
  await osk("ctrl");
  await osk("a");
  await check("on-screen CTRL + R (RVS ON) then A → reverse A (screen code 81)", [0x81]);

  await freshLine();
  await hostType("x");
  await osk("left");
  await osk("lshift");
  await osk("del");
  await osk("lshift");
  await check("on-screen SHIFT + DEL → INST (REM X)", sc(" X"));

  await layer(true);
  await freshLine();
  await hostType("x");
  await osk("left");
  await osk("inst");
  await check("on-screen INST → insert (REM X)", sc(" X"));

  await freshLine();
  await osk("pi");
  await check("on-screen π → screen code 5e", [0x5e]);
  await layer(false);

  for (const [combo, glyph] of [
    ["Equal", "="],
    ["Shift+Comma", "<"],
    ["Shift+Period", ">"],
    ["Shift+Equal", "+"],
    ["Minus", "-"],
    ["Shift+Digit9", "("],
    ["Shift+Digit0", ")"],
    ["Shift+Digit4", "$"],
    ["Shift+Quote", '"'],
    ["Backslash", "="],
    ["Insert", "£"],
  ]) {
    await freshLine();
    await hostPress(combo);
    await check(`host ${combo} → ${glyph}`, sc(glyph));
  }

  await freshLine();
  await blurUi();
  for (const ch of ' LOAD"$",8') {
    const shifted = ch === '"' || ch === "$";
    const code = { " ": "Space", '"': "Quote", $: "Digit4", ",": "Comma", 8: "Digit8" }[ch] ?? `Key${ch}`;
    if (shifted) await page.keyboard.down("Shift");
    await page.keyboard.down(code);
    await sleep(35);
    await page.keyboard.up(code);
    if (shifted) await page.keyboard.up("Shift");
    await sleep(25);
  }
  await drain();
  await sleep(600);
  await check('host fast Shift chords keep order (REM LOAD"$",8)', sc(' LOAD"$",8'));

  await freshLine();
  await page.evaluate(() => window.__g64?.typeC64?.(" A=(1)", { delayMs: 55 }));
  await drain();
  await check("typeC64 text (REM A=(1))", sc(" A=(1)"));

  await page.screenshot({ path: join(process.cwd(), "screenshots", "keyboard-map.png") });
} catch (e) {
  fatal = String(e?.stack || e);
}
await browser.close();
const pass = !fatal && cases.length > 0 && cases.every((c) => c.pass) && errors.length === 0;
writeFileSync(join(outDir, "results.json"), JSON.stringify({ pass, fatal, errors, cases }, null, 2));
for (const c of cases) console.log(`${c.pass ? "ok  " : "FAIL"} ${c.label}${c.pass ? "" : `  want ${c.want} got ${c.got}`}`);
console.log(JSON.stringify({ pass, cases: cases.length, failed: cases.filter((c) => !c.pass).length, fatal, errors: errors.slice(0, 3) }));
process.exit(pass ? 0 : 1);
