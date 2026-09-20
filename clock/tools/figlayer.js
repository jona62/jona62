/* Dump the painter layer on its own, before the glass diffuses it, so the
 * body can be judged rather than guessed at through the veil.
 *   node tools/figlayer.js "10:37:50" [frameGapMs] [cols]
 */
const path = require('path'); const fs = require('fs');
const { chromium } = require('playwright');
const W = +(process.env.W || 1000), H = +(process.env.H || 1000);
const OUT = process.env.OUT || '/tmp/shots';
const when = process.argv[2] || '10:37:50';
const gap = +(process.argv[3] || 600), cols = +(process.argv[4] || 5);
const SETTLE = 2500;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const [hh, mm, ss] = when.split(':').map(Number);
  const base = new Date(2026, 8, 19, hh, mm, ss || 0, 0).getTime() - SETTLE;
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(`(() => {
    const BASE = ${base}; const RealDate = Date; const t0 = performance.now();
    const shift = () => BASE + (performance.now() - t0);
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(shift()); else super(...a); }
      static now() { return shift(); }
    }
    window.Date = FakeDate;
  })()`);
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.waitForTimeout(SETTLE);
  const url = await p.evaluate(async ({ cols, gap }) => {
    const dev = window.CLOCK.dev;
    if (!dev) throw new Error('no CLOCK.dev handle');
    const src = dev.layer(), near = dev.near();
    const tw = 420, th = Math.round(420 * src.height / src.width);
    const sheet = document.createElement('canvas');
    sheet.width = tw * cols; sheet.height = th;
    const c = sheet.getContext('2d');
    c.fillStyle = '#f2f4f7'; c.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < cols; i++) {
      await new Promise(r => setTimeout(r, gap));
      c.drawImage(src, i * tw, 0, tw, th);
      c.drawImage(near, i * tw, 0, tw, th);
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.font = '15px monospace';
      c.fillText(i * gap + 'ms', i * tw + 8, 20);
    }
    return sheet.toDataURL('image/png');
  }, { cols, gap });
  const f = path.join(OUT, `fig-${when.replace(/:/g, '')}-${gap}ms.png`);
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  console.log(path.basename(f), errs.length ? 'ERRORS ' + errs.join('|') : 'ok');
  await b.close();
})();
