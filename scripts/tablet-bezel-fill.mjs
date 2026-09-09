/**
 * Layout-only check: tablet CRT glass contain-fits a flexed bezel.
 * No VICE. Onn-sized portrait + a short keyboard bezel.
 */
import { chromium } from "playwright";

const css = `
html, body { margin: 0; height: 100%; }
.g64-app {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #0a0a0b;
}
.g64-top { flex: 0 0 52px; background: #222; }
.g64-stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 16px 8px;
}
.g64-app[data-device="tablet"] .g64-bezel {
  padding: 0;
  position: relative;
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  background: #0c0c0e;
}
.g64-app[data-device="tablet"] .g64-screen {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 50%;
  bottom: auto;
  transform: translateY(-50%);
  margin: 0;
  flex: none;
  width: auto;
  height: auto;
  max-width: none;
  max-height: calc(100% - 24px);
  min-width: 0;
  min-height: 0;
  aspect-ratio: 384 / 272;
  background: #2e2c9b;
}
`;

const html = `<!doctype html>
<html><head><style>${css}</style></head>
<body>
  <div class="g64-app" data-device="tablet">
    <div class="g64-top"></div>
    <div class="g64-stage">
      <div class="g64-bezel"><div class="g64-screen"></div></div>
    </div>
  </div>
</body></html>`;

function measure(page) {
  return page.evaluate(() => {
    const bezel = document.querySelector(".g64-bezel");
    const screen = document.querySelector(".g64-screen");
    const b = bezel.getBoundingClientRect();
    const s = screen.getBoundingClientRect();
    return {
      bezel: { w: Math.round(b.width), h: Math.round(b.height) },
      screen: { w: Math.round(s.width), h: Math.round(s.height), y: Math.round(s.y) },
      aspect: Math.round((s.width / s.height) * 100) / 100,
      fill: Math.round((s.width / b.width) * 100) / 100,
    };
  });
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const failures = [];

{
  const context = await browser.newContext({ viewport: { width: 800, height: 1280 } });
  const page = await context.newPage();
  await page.setContent(html);
  const m = await measure(page);
  console.log("portrait", JSON.stringify(m));
  if (m.fill < 0.7) failures.push(`portrait stamp fill ${m.fill} screen ${m.screen.w} bezel ${m.bezel.w}`);
  if (m.screen.w < 500) failures.push(`portrait screen too narrow ${m.screen.w}`);
  if (Math.abs(m.aspect - 384 / 272) > 0.08) failures.push(`portrait aspect ${m.aspect}`);
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  await page.setContent(html);
  const m = await measure(page);
  console.log("short", JSON.stringify(m));
  if (m.screen.h > m.bezel.h + 2) failures.push(`short overflow h ${m.screen.h} > bezel ${m.bezel.h}`);
  if (m.screen.w < 200) failures.push(`short screen too narrow ${m.screen.w}`);
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error("tablet-bezel-fill FAIL", failures);
  process.exit(1);
}
console.log("tablet-bezel-fill OK");
