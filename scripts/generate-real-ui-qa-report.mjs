/**
 * Render docs/REAL_UI_QA_REPORT.md from extended QA rows.
 */
import { writeFileSync } from "node:fs";

export function writeExtendedQaReport(rows, destPath) {
  const cell = (r) => {
    if (!r) return "—";
    if (r.skipped) return `SKIP (${r.reason ?? "n/a"})`;
    return r.pass ? "**PASS**" : "**FAIL**";
  };

  let md = `# Real-UI QA report (xdotool + desktop chrome)

Chromium under Xvfb; catalog typing via **xdotool** where noted; toolbar/hardware via real DOM clicks.

**Regenerate:** \`npm run test:desktop-xdotool-extended\`

_Last run: ${new Date().toISOString()}_

## Summary

| ID | Result | Notes |
|----|--------|-------|
`;

  for (const r of rows) {
    const note = r.detail
      ? typeof r.detail === "string"
        ? r.detail.slice(0, 60)
        : JSON.stringify(r.detail).slice(0, 60)
      : r.reason ?? "";
    md += `| ${r.id} | ${cell(r)} | ${note.replace(/\|/g, "/")} |\n`;
  }

  md += `
## Steps (per test)

`;

  for (const r of rows) {
    md += `### ${r.id} — ${r.pass ? "PASS" : r.skipped ? "SKIP" : "FAIL"}\n\n`;
    if (r.steps?.length) {
      for (let i = 0; i < r.steps.length; i++) {
        md += `${i + 1}. ${r.steps[i]}\n`;
      }
    } else {
      md += `_No steps recorded._\n`;
    }
    if (r.detail) {
      md += `\n\`\`\`json\n${JSON.stringify(r.detail, null, 2)}\n\`\`\`\n`;
    }
    if (r.reason) md += `\n**Skip reason:** ${r.reason}\n`;
    md += "\n";
  }

  writeFileSync(destPath, md);
  return destPath;
}
