/**
 * Renders every .svg in a folder to one PNG per colour scheme, so a figure can
 * be looked at before it is committed.
 *
 *   node render-figures.cjs <folder-of-svgs> <output-folder>
 *
 * Writes figs-light.png and figs-dark.png. Needs Playwright with Chromium.
 */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => { const dir = process.argv[2], out = process.argv[3]; const b = await chromium.launch();
  for (const scheme of ['light','dark']) { const p = await b.newPage({ viewport: { width: 960, height: 800 }, colorScheme: scheme });
    const imgs = fs.readdirSync(dir).filter(f => f.endsWith('.svg')).map(f => `<p style="font:12px sans-serif;color:gray">${f}</p><div style="width:920px">${fs.readFileSync(path.join(dir,f),'utf8')}</div>`).join('');
    await p.setContent(`<body style="margin:16px;background:${scheme==='dark'?'#16150f':'#f0ece1'}">${imgs}</body>`); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/figs-${scheme}.png`, fullPage: true }); }
  await b.close(); })();
