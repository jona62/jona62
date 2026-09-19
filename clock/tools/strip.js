/* Dev helper: a contact sheet of consecutive frames, so motion can be judged
 * instead of guessed at. Stills hide everything that matters about timing.
 *
 * Usage: node tools/strip.js "10:37:50" [frameGapMs] [cols] [rows]
 * Env:   W= H= OUT=
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const W = +(process.env.W || 1000);
const H = +(process.env.H || 1000);
const OUT = process.env.OUT || '/tmp/shots';
const when = process.argv[2] || '10:37:50';
const gap = +(process.argv[3] || 120);
const cols = +(process.argv[4] || 4);
const rows = +(process.argv[5] || 3);
const SETTLE = 2500;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const [hh, mm, ss] = when.split(':').map(Number);
  const base = new Date(2026, 8, 19, hh, mm, ss || 0, 0).getTime() - SETTLE;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.addInitScript(`(() => {
    const BASE = ${base};
    const RealDate = Date;
    const t0 = performance.now();
    const shift = () => BASE + (performance.now() - t0);
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(shift()); else super(...a); }
      static now() { return shift(); }
    }
    window.Date = FakeDate;
  })()`);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(SETTLE);

  const dataUrl = await page.evaluate(async ({ cols, rows, gap }) => {
    const src = document.getElementById('glass');
    const n = cols * rows;
    const tw = 440, th = Math.round(440 * src.height / src.width);
    const sheet = document.createElement('canvas');
    sheet.width = tw * cols; sheet.height = th * rows;
    const c = sheet.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < n; i++) {
      await new Promise(r => setTimeout(r, gap));
      c.drawImage(src, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.font = '16px monospace';
      c.fillText(String(i * gap) + 'ms', (i % cols) * tw + 8, Math.floor(i / cols) * th + 22);
    }
    return sheet.toDataURL('image/png');
  }, { cols, rows, gap });

  const file = path.join(OUT, `strip-${when.replace(/:/g, '')}-${gap}ms.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(file);
  await browser.close();
})();
