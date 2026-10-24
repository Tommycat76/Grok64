#!/bin/sh
set -e
mkdir -p artifacts/desktop-a1bacdc-qa
sections="freeze ss5 nuvie geos jiffy timing catalog matrix"
for s in $sections; do
  echo "=== section $s ==="
  A1BACDC_ONLY="$s" npm run test:desktop-a1bacdc 2>&1 | tee "artifacts/desktop-a1bacdc-qa/$s.log" || true
done
echo "=== merged ==="
node -e "
const fs=require('fs');const path=require('path');
const dir='artifacts/desktop-a1bacdc-qa';
const rows=[];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.log')) continue;
  const t=fs.readFileSync(path.join(dir,f),'utf8');
  for (const line of t.split('\n')) {
    const m=line.match(/^(PASS|FAIL|SKIP) (\S+)/);
    if (m) rows.push({ id:m[2], pass:m[1]==='PASS', skipped:m[1]==='SKIP' });
  }
}
fs.writeFileSync(path.join(dir,'merged.json'),JSON.stringify({rows},null,2));
for (const r of rows) console.log('|',r.id,'|',r.skipped?'SKIP':r.pass?'PASS':'FAIL','|');
"
