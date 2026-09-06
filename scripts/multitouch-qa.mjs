import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function");
await page.locator(".g64-splash").click({ force: true });
for (let i = 0; i < 100; i++) {
  const st = await page.evaluate(() => ({
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    booting: window.__g64?.booting?.(),
    controls: !!document.querySelector(".g64-controls"),
  }));
  if (st.fs && st.running && !st.booting && st.controls) break;
  await page.waitForTimeout(400);
}
await page.waitForSelector(".g64-controls", { timeout: 5000 });
await page.evaluate(() => [...document.querySelectorAll(".g64-chip-gate")].find((b) => /jump/i.test(b.textContent || ""))?.click());
await page.locator('[aria-label="Jump, stick up"]').waitFor({ timeout: 5000 });

const layout = await page.evaluate(() => {
  const fire = document.querySelector('[aria-label="Fire"]');
  const jump = document.querySelector('[aria-label="Jump, stick up"]');
  if (!fire || !jump) return null;
  const fr = fire.getBoundingClientRect();
  const jr = jump.getBoundingClientRect();
  return {
    fireLeft: fr.left,
    jumpLeft: jr.left,
    sameRow: Math.abs(fr.top - jr.top) < 8,
    overlap: fr.right > jr.left,
  };
});
console.log("LAYOUT", JSON.stringify(layout));

const pt = await page.evaluate(() => {
  const fire = document.querySelector('[aria-label="Fire"]');
  const jump = document.querySelector('[aria-label="Jump, stick up"]');
  const fr = fire.getBoundingClientRect();
  const jr = jump.getBoundingClientRect();
  return {
    fire: { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 },
    jump: { x: jr.left + jr.width / 2, y: jr.top + jr.height / 2 },
    fat: { x: (fr.right + jr.left) / 2, y: (fr.top + fr.bottom) / 2 },
  };
});

async function readState() {
  return page.evaluate(() => ({
    fire: document.querySelector('[aria-label="Fire"]')?.getAttribute("data-down") === "true",
    jump: document.querySelector('[aria-label="Jump, stick up"]')?.getAttribute("data-down") === "true",
    joy: window.__g64?.joy?.() ?? null,
  }));
}

async function touchMove(points) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
  });
}

async function touchStart(points) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
  });
}

async function touchEnd() {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

await touchStart([{ ...pt.fire, id: 1 }]);
const fireHold = await readState();
await touchEnd();

await touchStart([{ ...pt.jump, id: 2 }]);
const jumpHold = await readState();
await touchEnd();

await touchStart([{ ...pt.fire, id: 1 }, { ...pt.jump, id: 2 }]);
const bothHold = await readState();
await touchEnd();

await touchStart([{ ...pt.fat, id: 3 }]);
const fatHold = await readState();
await touchEnd();

// NES chord: hold FIRE, roll thumb onto JUMP without lifting — FIRE stays down.
await touchStart([{ ...pt.fire, id: 10 }]);
const chordFireOnly = await readState();
await touchMove([{ ...pt.jump, id: 10 }]);
const chordBoth = await readState();
await touchMove([{ ...pt.fire, id: 10 }]);
const chordFireAgain = await readState();
await touchEnd();

console.log("MULTITOUCH", JSON.stringify({ layout, fireHold, jumpHold, bothHold, fatHold, chordFireOnly, chordBoth, chordFireAgain }));

await browser.close();

const pass =
  layout &&
  layout.fireLeft < layout.jumpLeft &&
  layout.sameRow &&
  fireHold.fire &&
  !fireHold.jump &&
  jumpHold.jump &&
  !jumpHold.fire &&
  bothHold.fire &&
  bothHold.jump &&
  fatHold.fire &&
  fatHold.jump &&
  chordFireOnly.fire &&
  !chordFireOnly.jump &&
  chordBoth.fire &&
  chordBoth.jump &&
  chordFireAgain.fire &&
  !chordFireAgain.jump;

if (!pass) {
  console.log("FAIL multitouch QA");
  process.exit(2);
}
console.log("PASS multitouch FIRE left of JUMP with dual-thumb overlap + hold-fire roll-jump chord");
process.exit(0);
