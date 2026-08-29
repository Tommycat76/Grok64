import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const fails = [];
page.on("pageerror", (e) => fails.push(`pageerror ${e.message}`));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-power").waitFor({ timeout: 15000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.locator(".g64-power").click({ force: true });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  const st = await page.evaluate(() => ({
    powered: window.__g64?.powered?.(),
    running: window.__g64?.running?.(),
    booting: window.__g64?.booting?.(),
  }));
  if (st.powered && st.running && !st.booting) break;
  await page.waitForTimeout(250);
}

const send = (code, key, down) =>
  page.evaluate(({ code, key, down }) => {
    const ev = new KeyboardEvent(down ? "keydown" : "keyup", {
      code,
      key,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
  }, { code, key, down });

await send("ArrowUp", "ArrowUp", true);
await page.waitForTimeout(80);
const afterUp = await page.evaluate(() => window.__g64?.joy?.());
await send("ArrowUp", "ArrowUp", false);

await send("ArrowLeft", "ArrowLeft", true);
await page.waitForTimeout(80);
const afterLeft = await page.evaluate(() => window.__g64?.joy?.());
await send("ArrowLeft", "ArrowLeft", false);

await send("KeyK", "k", true);
await page.waitForTimeout(80);
const afterK = await page.evaluate(() => window.__g64?.joy?.());
await send("KeyK", "k", false);

await send("ControlRight", "Control", true);
await page.waitForTimeout(80);
const afterCtrl = await page.evaluate(() => window.__g64?.joy?.());
await send("ControlRight", "Control", false);
await page.waitForTimeout(80);
const afterCtrlUp = await page.evaluate(() => window.__g64?.joy?.());

await page.screenshot({ path: "/workspace/screenshots/input-map-desktop.png" });

const ui = await page.evaluate(() => ({
  stick: Boolean(document.querySelector(".g64-stick")),
  fire: Boolean(document.querySelector(".g64-fire")),
  padNote: Boolean(document.querySelector(".g64-pad-note")),
  padAttr: document.querySelector(".g64-app")?.getAttribute("data-pad"),
  powered: window.__g64?.powered?.(),
  running: window.__g64?.running?.(),
}));

const tablet = await browser.newPage({
  viewport: { width: 1200, height: 800 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36",
});
await tablet.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await tablet.locator(".g64-power").waitFor({ timeout: 15000 });
await tablet.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await tablet.locator(".g64-power").click({ force: true });
const t1 = Date.now();
while (Date.now() - t1 < 40000) {
  const st = await tablet.evaluate(() => ({
    powered: window.__g64?.powered?.(),
    running: window.__g64?.running?.(),
    booting: window.__g64?.booting?.(),
  }));
  if (st.powered && st.running && !st.booting) break;
  await tablet.waitForTimeout(250);
}
await tablet.screenshot({ path: "/workspace/screenshots/input-map-tablet.png" });
const tabletUi = await tablet.evaluate(() => ({
  stick: Boolean(document.querySelector(".g64-stick")),
  fire: Boolean(document.querySelector(".g64-fire")),
  device: document.querySelector(".g64-app")?.getAttribute("data-device"),
}));

const report = {
  afterUp,
  afterLeft,
  afterK,
  afterCtrl,
  afterCtrlUp,
  ui,
  tabletUi,
  fails,
};
console.log(JSON.stringify(report, null, 2));

const arrowsMoved = afterUp?.x || afterUp?.y || afterLeft?.x || afterLeft?.y;
const kFired = afterK?.fire;
const ctrlFired = afterCtrl?.fire === true;
const ctrlReleased = afterCtrlUp?.fire === false;
const stickVisible = ui.stick && ui.fire && !ui.padNote;
const tabletStick = tabletUi.stick && tabletUi.fire;

let exit = 0;
if (arrowsMoved) {
  console.error("FAIL arrows moved the joystick");
  exit = 2;
}
if (kFired) {
  console.error("FAIL KeyK fired the joystick");
  exit = 2;
}
if (!ctrlFired || !ctrlReleased) {
  console.error("FAIL Right Ctrl is not FIRE");
  exit = 2;
}
if (!stickVisible) {
  console.error("FAIL on-screen stick missing with no pad");
  exit = 2;
}
if (!tabletStick) {
  console.error("FAIL tablet on-screen stick missing with no pad");
  exit = 2;
}
if (!exit) console.log("PASS keyboard is C64 except Right Ctrl fire; stick is on-screen until a pad connects");
await browser.close();
process.exit(exit);
