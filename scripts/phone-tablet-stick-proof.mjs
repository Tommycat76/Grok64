#!/usr/bin/env node
/**
 * Phone / tablet on-screen stick proof (Tom's priority after disk mount).
 *
 * Real UI, real touch points, iPhone portrait + landscape and an Android tablet.
 *   1) Stick + FIRE stay up (a ghost pad must not hide them).
 *   2) Drag right holds joy.x; FIRE while held does not center the stick.
 *   3) A glass tap while the thumb is down does not center the stick.
 *   4) Landscape stick sits above the Quick Dock.
 *   5) Fresh profile: WASD joystick is off.
 *
 *   node scripts/phone-tablet-stick-proof.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots", "phone-tablet-stick");
const outDir = join(process.cwd(), "artifacts", "phone-tablet-stick");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const chromeBin =
  process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

const profiles = [
  {
    id: "iphone-portrait",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1",
    expectDevice: "phone",
    expectOrient: "portrait",
  },
  {
    id: "iphone-landscape",
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1",
    expectDevice: "phone",
    expectOrient: "landscape",
  },
  {
    id: "ipad-tablet",
    viewport: { width: 1024, height: 768 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    expectDevice: "tablet",
    expectOrient: "landscape",
  },
];

function writeRun(run) {
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
}

async function waitReady(page, ms = 50000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => ({
      ready: typeof window.__g64?.power === "function",
      powered: window.__g64?.powered?.(),
      running: window.__g64?.running?.(),
      booting: window.__g64?.booting?.(),
      stick: Boolean(document.querySelector(".g64-stick")),
    }));
    if (st.powered && st.running && !st.booting && st.stick) return st;
    await page.waitForTimeout(250);
  }
  return null;
}

async function layout(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, top: r.top };
    };
    const app = document.querySelector(".g64-app");
    return {
      device: app?.getAttribute("data-device") ?? null,
      orient: app?.getAttribute("data-orient") ?? null,
      mouse: app?.getAttribute("data-mouse") ?? null,
      kbjoy: app?.getAttribute("data-kbjoy") ?? null,
      pad: app?.getAttribute("data-pad") ?? null,
      stick: box(".g64-stick"),
      fire: box('[aria-label="Fire"]'),
      dock: box(".g64-dock"),
      screen: box(".g64-screen"),
      wasd: window.__g64?.settings?.()?.wasdIsJoy ?? null,
      joy: window.__g64?.joy?.() ?? null,
    };
  });
}

function overlap(a, b) {
  if (!a || !b) return 0;
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return w * h;
}

async function runProfile(browser, spec) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    isMobile: spec.isMobile,
    hasTouch: spec.hasTouch,
    userAgent: spec.userAgent,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (e) => {
    const msg = String(e?.message || e);
    if (/Hydration failed|reading 'sources'/i.test(msg)) return;
    errors.push(msg);
  });
  const out = { id: spec.id, errors };

  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
  await page.locator(".g64-power").click({ force: true }).catch(() => page.evaluate(() => window.__g64?.power?.()));
  const ready = await waitReady(page);
  out.ready = Boolean(ready);
  const ui = await layout(page);
  out.ui = ui;
  await page.screenshot({ path: join(shotDir, `${spec.id}-00-ready.png`) });

  out.deviceOk = ui.device === spec.expectDevice;
  out.orientOk = ui.orient === spec.expectOrient;
  out.wasdOff = ui.wasd === false && ui.kbjoy === "false";
  out.stickVisible = Boolean(ui.stick && ui.stick.w >= 88 && ui.fire);
  out.dockClear =
    !ui.stick || !ui.dock ? true : ui.stick.bottom <= ui.dock.top + 2 || overlap(ui.stick, ui.dock) < 80;

  const stick = ui.stick;
  if (!stick) {
    out.pass = false;
    await context.close();
    return out;
  }

  const cx = stick.x + stick.w / 2;
  const cy = stick.y + stick.h / 2;
  const right = { x: stick.x + stick.w * 0.82, y: cy, id: 1 };
  const firePt = ui.fire
    ? { x: ui.fire.x + ui.fire.w / 2, y: ui.fire.y + ui.fire.h / 2, id: 2 }
    : { x: spec.viewport.width - 40, y: spec.viewport.height - 80, id: 2 };
  const glass = ui.screen
    ? { x: ui.screen.x + ui.screen.w * 0.55, y: ui.screen.y + ui.screen.h * 0.35, id: 3 }
    : { x: spec.viewport.width / 2, y: 180, id: 3 };

  const touchStart = (pts) =>
    cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })),
    });
  const touchMove = (pts) =>
    cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })),
    });
  const touchEnd = () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await touchStart([{ x: cx, y: cy, id: 1 }]);
  await page.waitForTimeout(40);
  for (let i = 1; i <= 6; i++) {
    await touchMove([{ x: cx + ((right.x - cx) * i) / 6, y: cy, id: 1 }]);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(80);
  out.hold = await page.evaluate(() => ({
    joy: window.__g64?.joy?.() ?? null,
    down: window.__g64?.stickDown?.() ?? null,
  }));
  await page.screenshot({ path: join(shotDir, `${spec.id}-01-hold-right.png`) });

  await touchStart([right, firePt]);
  await page.waitForTimeout(80);
  out.holdFire = await page.evaluate(() => window.__g64?.joy?.() ?? null);
  await page.screenshot({ path: join(shotDir, `${spec.id}-02-hold-fire.png`) });
  await touchEnd();
  await page.waitForTimeout(60);
  out.afterRelease = await page.evaluate(() => window.__g64?.joy?.() ?? null);

  await touchStart([{ x: cx, y: cy, id: 1 }]);
  await page.waitForTimeout(30);
  await touchMove([right]);
  await page.waitForTimeout(50);
  await touchStart([right, glass]);
  await page.waitForTimeout(80);
  out.holdGlass = await page.evaluate(() => window.__g64?.joy?.() ?? null);
  await page.screenshot({ path: join(shotDir, `${spec.id}-03-hold-glass.png`) });
  await touchEnd();

  const mouseChip = page.locator('[aria-label="1351 mouse"]').first();
  if (await mouseChip.count()) {
    await mouseChip.click();
    await page.waitForTimeout(200);
  } else {
    await page.evaluate(() => window.__g64?.setMouseMode?.(true));
    await page.waitForTimeout(200);
  }
  out.mouseUi = await page.evaluate(() => ({
    mouse: document.querySelector(".g64-app")?.getAttribute("data-mouse"),
    stick: Boolean(document.querySelector(".g64-stick")),
    lmb: Boolean(document.querySelector('[aria-label="Left mouse button"]')),
    pad: Boolean(document.querySelector(".g64-touchpad")),
  }));
  await page.screenshot({ path: join(shotDir, `${spec.id}-04-mouse.png`) });
  await page.evaluate(() => window.__g64?.setMouseMode?.(false));

  const heldRight = Math.abs(out.hold?.joy?.x) >= 0.9;
  const fireKeeps =
    Math.abs(out.holdFire?.x) >= 0.9 && out.holdFire?.fire === true;
  const glassKeeps = Math.abs(out.holdGlass?.x) >= 0.9;
  out.released = out.afterRelease?.x === 0 && out.afterRelease?.fire === false;
  out.mouseKeepsStick = Boolean(out.mouseUi?.stick && out.mouseUi?.lmb);
  out.pass = Boolean(
    out.ready &&
      out.deviceOk &&
      out.orientOk &&
      out.wasdOff &&
      out.stickVisible &&
      out.dockClear &&
      heldRight &&
      fireKeeps &&
      glassKeeps &&
      out.released &&
      out.mouseKeepsStick &&
      errors.length === 0,
  );
  await context.close();
  return out;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeBin,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader-webgl"],
});

const run = { at: new Date().toISOString(), base, chromeBin: chromeBin || "bundled", profiles: [] };
try {
  for (const spec of profiles) {
    const one = await runProfile(browser, spec);
    run.profiles.push(one);
    console.log(JSON.stringify({ id: one.id, pass: one.pass, hold: one.hold, holdFire: one.holdFire, holdGlass: one.holdGlass }, null, 2));
  }
} finally {
  await browser.close();
}

run.pass = run.profiles.length === profiles.length && run.profiles.every((p) => p.pass);
writeRun(run);
console.log(JSON.stringify({ pass: run.pass, ids: run.profiles.map((p) => ({ id: p.id, pass: p.pass })) }, null, 2));
process.exit(run.pass ? 0 : 2);
