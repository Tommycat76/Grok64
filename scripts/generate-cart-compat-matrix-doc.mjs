/**
 * Render docs/CART_COMPAT_MATRIX.md from matrix JSON rows.
 */
import { writeFileSync } from "node:fs";
import { CART_COMPAT_CATALOG } from "./cart-compat-catalog.mjs";

export function writeCartCompatMatrixDoc(rows, destPath) {
  const byCart = new Map();
  for (const r of rows) {
    if (!r.cart) continue;
    if (!byCart.has(r.cart)) byCart.set(r.cart, { label: r.label, stock: null, jiffy: null });
    const slot = byCart.get(r.cart);
    if (r.kernal === "stock") slot.stock = r;
    if (r.kernal === "jiffy") slot.jiffy = r;
  }

  const cell = (r) => {
    if (!r) return "—";
    if (r.skipped) return `SKIP (${r.reason ?? "n/a"})`;
    if (!r.pass) return `**FAIL**`;
    return "PASS";
  };

  const detail = (r) => {
    if (!r || r.skipped) return "";
    const bits = [];
    if (r.boot === false) bits.push("boot");
    if (r.detect === false) bits.push("detect");
    if (r.menu === false) bits.push("menu");
    if (r.freeze === false) bits.push("freeze");
    if (r.resume === false) bits.push("resume");
    if (r.jiffy === false) bits.push("jiffy");
    if (r.game === false) bits.push("game");
    return bits.length ? bits.join(", ") : "ok";
  };

  let md = `# Cartridge compatibility matrix (Grok64)

Automated **real-UI** runs: Chromium under Xvfb with **xdotool** host keys for freezer carts (Action Replay F1, hardware freeze button). Each CRT is exercised with **stock KERNAL** and **JiffyDOS** (synthetic 8K ROM pair in Settings).

**Fixtures:** Internet Archive [C64-CRT-Collection](https://archive.org/details/C64-CRT-Collection) via \`node scripts/fetch-fixtures.mjs\`.

**Regenerate:** \`npm run test:desktop-xdotool-cart-matrix\`

_Last run: ${new Date().toISOString()}_

## Pass / fail (per cart × KERNAL)

| Cart | Stock KERNAL | JiffyDOS | Jiffy hardware note | Stock detail | Jiffy detail |
|------|--------------|----------|---------------------|--------------|--------------|
`;

  for (const entry of CART_COMPAT_CATALOG) {
    const slot = byCart.get(entry.id) ?? { stock: null, jiffy: null };
    md += `| ${entry.label} | ${cell(slot.stock)} | ${cell(slot.jiffy)} | ${entry.jiffyLevel}${entry.jiffySuppress ? " (Jiffy suppressed when cart loaded)" : ""} | ${detail(slot.stock)} | ${detail(slot.jiffy)} |\n`;
  }

  md += `
## Checks (each row)

| Check | Meaning |
|-------|---------|
| boot | Cart mounts; screen leaves plain READY |
| detect | \`fastLoadCart\` kind matches catalog |
| menu | Title/menu regex or non-trivial boot text |
| freeze | Hardware freeze opens freezer UI (where applicable) |
| resume | \`cartReset\` returns to runnable state |
| jiffy | \`jiffyLive\` matches hardware suppress/warn rules |
| game | Boulder Dash load through cart fast-load path (stock rows) |

## Missing public fixtures

These catalog entries need a CRT added under \`fixtures/carts/\` (not in the IA zip used here):

`;

  for (const entry of CART_COMPAT_CATALOG.filter((e) => !e.zipPattern)) {
    md += `- **${entry.label}** (\`${entry.fixture}\`) — ${entry.notes ?? ""}\n`;
  }

  md += `
## Source images

| Fixture | Archive path (from \`.source.txt\`) |
|---------|-------------------------------------|
`;

  for (const entry of CART_COMPAT_CATALOG.filter((e) => e.zipPattern)) {
    md += `| \`${entry.fixture}\` | IA zip match: \`${String(entry.zipPattern)}\` |\n`;
  }

  writeFileSync(destPath, md);
  return destPath;
}
