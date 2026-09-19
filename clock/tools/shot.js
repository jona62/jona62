/* Dev helper: render the clock at chosen instants and save PNGs.
 * Usage: node tools/shot.js "10:37:20" "10:37:45" ...   (HH:MM:SS, local)
 * Env:   W=1440 H=900 SETTLE=2200 OUT=/tmp/shots
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const W = +(process.env.W || 1440);
const H = +(process.env.H || 900);
const SETTLE = +(process.env.SETTLE || 2200);
const OUT = process.env.OUT || '/tmp/shots';
const times = process.argv.slice(2);
if (!times.length) times.push('10:37:20');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  for (const t of times) {
    const [hh, mm, ss] = t.split(':').map(Number);
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
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(url);
    await page.waitForTimeout(SETTLE);
    const name = `${W}x${H}-${t.replace(/:/g, '')}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
    console.log(name, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok');
    await page.close();
  }
  await browser.close();
})();
