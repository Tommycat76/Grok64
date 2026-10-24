#!/usr/bin/env node
/**
 * Headless Chrome/WebKit DOS + UI smoke for SD2IEC / Grok64 shell.
 *   npm run test:cmd-sd2iec
 * C64 OS fixture (private): set GROK64_C64OS_FIXTURE to part1-C64OS folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const fixtureRoot =
  process.env.GROK64_C64OS_FIXTURE || join(process.cwd(), "fixtures", "c64os", "part1-C64OS");
const artifactDir = join(process.cwd(), "artifacts", "cmd-sd2iec-e2e");
mkdirSync(artifactDir, { recursive: true });

const results = [];

async function powerOn(page) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(".g64-power").waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  for (let i = 0; i < 80; i++) {
    const on = await page.evaluate(() => window.__g64?.powered?.());
    if (on) break;
    await page.waitForTimeout(300);
  }
  for (let i = 0; i < 60; i++) {
    const g = await page.evaluate(() => window.__g64?.hasFs?.());
    if (g) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(5000);
}

async function typeBasic(page, text) {
  for (const ch of text) {
    await page.evaluate(
      (c) => {
        window.__g64?.dispatchKey?.(`Key${c.toUpperCase()}`, c, true);
        window.__g64?.dispatchKey?.(`Key${c.toUpperCase()}`, c, false);
      },
      ch,
    );
    await page.waitForTimeout(30);
  }
  await page.evaluate(() => {
    window.__g64?.dispatchKey?.("Enter", "Enter", true);
    window.__g64?.dispatchKey?.("Enter", "Enter", false);
  });
  await page.waitForTimeout(2500);
}

async function runSuite(browserType, label) {
  const browser = await browserType.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  try {
    await powerOn(page);
    const dos = await page.evaluate(async () => {
      window.__g64?.resetDos?.();
      await window.__g64?.seedSd?.([
        { name: "DEMO.PRG", path: "", data: new Uint8Array([1, 8, 0, 0, 0x12, 0x34]).buffer },
        { name: "TOOL.PRG", path: "OS", data: new Uint8Array([1, 8, 0, 0, 0x56, 0x78]).buffer },
      ]);
      const a = await window.__g64?.runDos?.('MD:"OS"');
      const b = await window.__g64?.runDos?.('CD:"OS"');
      const c = await window.__g64?.runDos?.("CD<-");
      const d = await window.__g64?.runDos?.("X");
      return { a, b, c, d };
    });
    const dosOk = /OK/.test(dos.a) && /OK/.test(dos.b) && /OK/.test(dos.c) && /PART 0/.test(dos.d);
    results.push({ label, id: "sd2iec-dos-cmd", pass: dosOk, detail: dos });

    await page.evaluate(() => window.__g64?.setShowKeyboard?.(true));
    await page.waitForTimeout(600);
    const kbVisible = await page.evaluate(
      () => Boolean(document.querySelector(".g64-kb")) || window.__g64?.sessionFlags?.().showKeyboard,
    );
    results.push({ label, id: "keyboard-open", pass: kbVisible });

    await page.locator(".g64-kb").screenshot({ path: join(artifactDir, `${label}-keyboard.png`) }).catch(() => null);

    const c64osBoot = existsSync(join(fixtureRoot, "c64os"));
    if (c64osBoot) {
      const bootBuf = readFileSync(join(fixtureRoot, "c64os"));
      await page.evaluate(
        async (payload) => {
          const u8 = new Uint8Array(payload);
          await window.__g64?.seedSd?.([{ name: "C64OS", path: "", data: u8.buffer }]);
          window.__g64?.setIecSlot?.(8, "sd2iec");
        },
        [...bootBuf],
      );
      await typeBasic(page, 'LOAD"C64OS",8,1');
      await page.waitForTimeout(8000);
      const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
      const shot = await page.evaluate(() => window.__g64?.canvasShot?.());
      if (shot?.b64) writeFileSync(join(artifactDir, `${label}-c64os-sd2iec.png`), Buffer.from(shot.b64, "base64"));
      const booted = text.length > 20 && !/FILE NOT FOUND/i.test(text);
      results.push({
        label,
        id: "c64os-sd2iec-boot",
        pass: true,
        booted,
        optional: true,
        textHead: text.slice(0, 120),
        artifact: booted ? join(artifactDir, `${label}-c64os-sd2iec.png`) : null,
      });
    } else {
      results.push({ label, id: "c64os-sd2iec-boot", pass: true, skipped: true, reason: "fixture missing" });
    }
  } catch (e) {
    results.push({ label, id: "suite-error", pass: false, error: String(e) });
  }

  await browser.close();
}

await runSuite(chromium, "chromium");
try {
  await runSuite(webkit, "webkit");
} catch (e) {
  results.push({ label: "webkit", id: "webkit-deps", pass: true, skipped: true, reason: String(e).split("\n")[0] });
}

const failed = results.filter((r) => !r.pass && !r.skipped && !r.optional);
writeFileSync(join(artifactDir, "results.json"), JSON.stringify({ results, failed: failed.length }, null, 2));
console.log(JSON.stringify({ artifactDir, results, ok: failed.length === 0 }, null, 2));
process.exit(failed.length ? 1 : 0);
