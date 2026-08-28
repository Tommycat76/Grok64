import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8081/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
await page.locator(".g64-power").waitFor({ timeout: 15000 });
await page.locator(".g64-power").click({ force: true });
await page.waitForSelector(".g64-top", { timeout: 20000 });
for (let i = 0; i < 80; i++) {
  if (await page.evaluate(() => window.__g64?.hasFs?.())) {
    console.log("fs at", i);
    break;
  }
  await page.waitForTimeout(400);
}
const loaded = await page.evaluate(async () => window.__g64?.load?.("/software/diagnostics.prg", "diagnostics.prg"));
console.log("load", loaded);
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => window.__g64?.title?.());
  if (t && /diag/i.test(String(t))) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(5000);
const probe = await page.evaluate(() => window.__g64?.probe?.());
const opts = await page.evaluate(() => window.__g64?.opts?.());
const joy = opts && typeof opts === "object"
  ? {
      vice_joyport: opts.vice_joyport,
      vice_joyport_type: opts.vice_joyport_type,
      vice_retropad_options: opts.vice_retropad_options,
      vice_keyrah_keypad_mappings: opts.vice_keyrah_keypad_mappings,
      vice_mapper_b: opts.vice_mapper_b,
      vice_mapper_a: opts.vice_mapper_a,
    }
  : opts;
console.log("PROBE", JSON.stringify(probe, null, 2));
console.log("JOY", JSON.stringify(joy, null, 2));

const before = await page.evaluate(async () => window.__g64?.shot?.());
if (before) {
  const buf = Buffer.from(before, "base64");
  writeFileSync("/workspace/screenshots/cia-idle.png", buf);
  console.log("idle bytes", buf.length, "sha", createHash("sha256").update(buf).digest("hex").slice(0, 16));
}

await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(1800);
const held = await page.evaluate(async () => window.__g64?.shot?.());
if (held) {
  const buf = Buffer.from(held, "base64");
  writeFileSync("/workspace/screenshots/cia-fire.png", buf);
  console.log("held bytes", buf.length, "sha", createHash("sha256").update(buf).digest("hex").slice(0, 16));
}
await page.screenshot({ path: "/workspace/screenshots/diag-fire-held.png" });

await page.evaluate(() => window.__g64?.fire?.(false));
await page.waitForTimeout(800);
const after = await page.evaluate(async () => window.__g64?.shot?.());
if (after) {
  const buf = Buffer.from(after, "base64");
  writeFileSync("/workspace/screenshots/cia-released.png", buf);
  console.log("released bytes", buf.length, "sha", createHash("sha256").update(buf).digest("hex").slice(0, 16));
}

const same = before && held && before === held;
console.log("idle_eq_held", same);
console.log("title", await page.evaluate(() => window.__g64?.title?.()));
await browser.close();
process.exit(same ? 2 : 0);
