import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (err) => {
  const m = String(err);
  if (/Wake Lock/i.test(m)) return;
  errors.push("page:" + m);
});
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push("console:" + msg.text());
});

async function dump() {
  return page.evaluate(() => {
    const g = window.__g64;
    return g
      ? {
          playMode: g.playMode(),
          title: g.title(),
          bootPath: g.bootPath(),
          hasFs: g.hasFs(),
          fileName: g.fileName(),
          media: g.media(),
        }
      : null;
  }).catch(() => null);
}

async function saveShot(name) {
  const b64 = await page.evaluate(async () => {
    const g = window.__g64;
    if (!g?.shot) return null;
    return g.shot();
  }).catch(() => null);
  if (b64) writeFileSync(`/workspace/screenshots/${name}`, Buffer.from(b64, "base64"));
  return Boolean(b64);
}

async function tapStart() {
  for (let i = 0; i < 16; i++) {
    const unlock = page.locator(".g64-unlock");
    if ((await unlock.count()) > 0) {
      await unlock.first().dispatchEvent("pointerdown", { timeout: 1500 }).catch(() => null);
      await unlock.first().dispatchEvent("click", { timeout: 1500 }).catch(() => null);
      return true;
    }
    await page.waitForTimeout(350);
  }
  return false;
}

async function powerOn() {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Power on" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() =>
    document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await page.waitForSelector(".g64-top", { timeout: 15000 });
  for (let i = 0; i < 40; i++) {
    if ((await page.locator("canvas").count()) > 0) break;
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 40; i++) {
    const d = await dump();
    if (d?.hasFs) break;
    await page.waitForTimeout(250);
  }
}

async function openLibrary() {
  await page.locator('button[aria-label="Software"]').first().dispatchEvent("click");
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".g64-sheet button")];
    btns.find((b) => /on this device/i.test(b.textContent || ""))?.click();
  });
  await page.waitForTimeout(400);
}

async function playCard(name) {
  await page.locator(".g64-card").filter({ hasText: name }).waitFor({ timeout: 8000 });
  await page.locator(".g64-card").filter({ hasText: name }).dispatchEvent("click");
}

await powerOn();
const afterPower = await dump();
await page.screenshot({ path: "/workspace/screenshots/play-basic.png", timeout: 8000 });

await openLibrary();
await playCard("Byte Hopper");
const tappedHopper = await tapStart();
await page.waitForTimeout(9000);
const afterHopper = await dump();
const hopperShot = await saveShot("play-hopper-vice.png");
await page.screenshot({ path: "/workspace/screenshots/play-hopper.png", timeout: 8000 });
await page.locator(".g64-bezel").screenshot({ path: "/workspace/screenshots/play-hopper-bezel.png" }).catch(() => null);

await openLibrary();
await playCard("Grok64 Workbench");
const tappedWb = await tapStart();
await page.waitForTimeout(12000);
const afterWb = await dump();
const wbShot = await saveShot("play-workbench-vice.png");
await page.screenshot({ path: "/workspace/screenshots/play-workbench.png", timeout: 8000 });
await page.locator(".g64-bezel").screenshot({ path: "/workspace/screenshots/play-workbench-bezel.png" }).catch(() => null);

const body = (await page.locator(".g64-app").innerText().catch(() => "")).slice(0, 600);
const setImm = errors.filter((e) => /setImmediates/i.test(e));
console.log(
  JSON.stringify(
    {
      canvas: await page.locator("canvas").count(),
      overlay: await page.locator(".g64-boot").count(),
      unlock: await page.locator(".g64-unlock").count(),
      chip: (await page.locator(".g64-chip").first().innerText().catch(() => "")).trim(),
      tappedHopper,
      tappedWb,
      hopperShot,
      wbShot,
      afterPower,
      afterHopper,
      afterWb,
      setImmediates: setImm.length,
      title: body,
      errors: errors.slice(0, 20),
    },
    null,
    2,
  ),
);

await browser.close();
