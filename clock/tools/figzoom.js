/* A magnified crop of the painter layer, so the body can be judged at the
 * size it is actually drawn. Usage: node tools/figzoom.js "10:37:50" [gapMs] [cols] [zoom]
 */
const path = require('path'); const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/shots';
const when = process.argv[2] || '10:37:50';
const gap = +(process.argv[3] || 600), cols = +(process.argv[4] || 4), zoom = +(process.argv[5] || 2.4);
const SETTLE = 2600;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const [hh, mm, ss] = when.split(':').map(Number);
  const base = new Date(2026, 8, 19, hh, mm, ss || 0, 0).getTime() - SETTLE;
  const p = await b.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(`(() => {
    const BASE = ${base}; const R = Date; const t0 = performance.now();
    const s = () => BASE + (performance.now() - t0);
    class F extends R { constructor(...a) { if (a.length === 0) super(s()); else super(...a); } static now() { return s(); } }
    window.Date = F;
  })()`);
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.waitForTimeout(SETTLE);
  const url = await p.evaluate(async ({ cols, gap, zoom }) => {
    const dev = window.CLOCK.dev, L = dev.layout(), src = dev.layer(), near = dev.near();
    const s = src.width / L.w;                   /* device pixels per CSS unit */
    const fh = L.fig.H * 1.25, fw = fh * 0.62;
    const sx = (L.fig.baseX - fw / 2) * s, sy = (L.fig.feetY - fh * 0.96) * s;
    const sw = fw * s, sh = fh * s;
    const tw = Math.round(sw * zoom), th = Math.round(sh * zoom);
    const sheet = document.createElement('canvas');
    sheet.width = tw * cols; sheet.height = th;
    const c = sheet.getContext('2d');
    c.fillStyle = '#eef1f5'; c.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < cols; i++) {
      await new Promise(r => setTimeout(r, gap));
      c.drawImage(src, sx, sy, sw, sh, i * tw, 0, tw, th);
      c.drawImage(near, sx, sy, sw, sh, i * tw, 0, tw, th);
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.font = '14px monospace';
      c.fillText(i * gap + 'ms', i * tw + 8, 18);
    }
    return sheet.toDataURL('image/png');
  }, { cols, gap, zoom });
  const f = path.join(OUT, `figzoom-${when.replace(/:/g, '')}.png`);
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  console.log(path.basename(f), errs.length ? 'ERRORS ' + errs.join('|') : 'ok');
  await b.close();
})();
