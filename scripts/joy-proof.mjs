import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

function sample(path) {
  const out = execFileSync(
    "python3",
    [
      "-c",
      "from PIL import Image; im=Image.open('" +
        path +
        "').convert('RGB'); box=im.crop((70,200,320,380)); px=list(box.getdata()); n=len(px); r=sum(p[0] for p in px)/n; g=sum(p[1] for p in px)/n; b=sum(p[2] for p in px)/n; print(f'{r:.1f} {g:.1f} {b:.1f} {(r+g+b)/3:.1f}')",
    ],
    { encoding: "utf8" },
  ).trim();
  const [r, g, b, lum] = out.split(" ").map(Number);
  return { r, g, b, lum };
}

async function shot(name) {
  const path = `/workspace/screenshots/${name}.png`;
  await page.screenshot({ path });
  const box = sample(path);
  console.log(name, "lum", box.lum.toFixed(1), "rgb", box.r.toFixed(0), box.g.toFixed(0), box.b.toFixed(0));
  return { name, ...box };
}

async function waitFs() {
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.__g64?.hasFs?.())) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function load(path, name) {
  const ok = await page.evaluate(async ({ p, n }) => window.__g64?.load?.(p, n), { p: path, n: name });
  console.log("load", name, ok);
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => window.__g64?.title?.());
    if (t && String(t).toLowerCase().includes(name.split(".")[0].slice(0, 6))) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(6500);
}

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-power").waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await page.locator(".g64-power").click({ force: true });
for (let i = 0; i < 40; i++) {
  if (await page.locator(".g64-top").isVisible().catch(() => false)) break;
  if (await page.locator(".g64-power").isVisible().catch(() => false)) {
    await page.locator(".g64-power").click({ force: true }).catch(() => undefined);
  }
  await page.waitForTimeout(500);
}
if (!(await page.locator(".g64-top").isVisible().catch(() => false))) {
  throw new Error("did not power on");
}
console.log("fs", await waitFs());

await load("/software/diagnostics.prg", "diagnostics.prg");
const probe = await page.evaluate(() => window.__g64?.probe?.());
const opts = await page.evaluate(() => window.__g64?.opts?.());
console.log("PROBE", JSON.stringify({
  hasGm: probe?.hasGm, sim: probe?.sim, raw: probe?.raw, value2: probe?.value2, slot: probe?.slot, pads: probe?.pads,
}));
console.log("JOY", JSON.stringify({
  vice_joyport: opts?.vice_joyport,
  vice_joyport_type: opts?.vice_joyport_type,
  vice_retropad_options: opts?.vice_retropad_options,
  vice_keyrah_keypad_mappings: opts?.vice_keyrah_keypad_mappings,
}));

const idle = await shot("proof-idle");
await page.evaluate(() => window.__g64?.stick?.(0, 0));
await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(1800);
const held = await shot("proof-fire");
await page.evaluate(() => window.__g64?.fire?.(false));
await page.waitForTimeout(900);
const released = await shot("proof-release");

await page.evaluate(() => window.__g64?.stick?.(-1, 0));
await page.waitForTimeout(1400);
const left = await shot("proof-left");
await page.evaluate(() => window.__g64?.stick?.(0, 0));
await page.waitForTimeout(400);
await page.evaluate(() => window.__g64?.stick?.(1, 0));
await page.waitForTimeout(1400);
const right = await shot("proof-right");
await page.evaluate(() => window.__g64?.stick?.(0, 0));

await load("/software/byte-hopper.prg", "byte-hopper.prg");
const hopIdle = await shot("proof-hopper-title");
await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(1600);
await page.evaluate(() => window.__g64?.fire?.(false));
await page.waitForTimeout(800);
const hopGo = await shot("proof-hopper-go");

const fireWorked = held.lum - idle.lum > 12;
const fireReleased = released.lum < held.lum - 8;
const hopperStarted = hopGo.g - hopIdle.g > 8 || Math.abs(hopGo.lum - hopIdle.lum) > 8;
console.log("RESULT", JSON.stringify({
  fireWorked, fireReleased, hopperStarted,
  idle: idle.lum, held: held.lum, released: released.lum,
  leftR: left.r, rightG: right.g,
  hopIdle: hopIdle.lum, hopGo: hopGo.lum, hopGoG: hopGo.g, hopIdleG: hopIdle.g,
}));

await browser.close();
if (!fireWorked || !hopperStarted) process.exit(2);
process.exit(0);
