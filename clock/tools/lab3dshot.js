/* Drive the lab headlessly and screenshot it. Usage:
 *   node tools/labshot.js <script>   where <script> is a comma list of steps:
 *   wait:800, click:jump, drag:0.7:0.35, grid:6:180
 */
const path = require('path'); const fs = require('fs');
const { chromium } = require('playwright');
const W = +(process.env.W || 900), H = +(process.env.H || 700);
const OUT = process.env.OUT || '/tmp/shots';
const steps = (process.argv[2] || 'wait:1200').split(',');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'lab3d', 'index.html'));
  await page.waitForTimeout(2500);
  let name = 'lab3d';
  for (const st of steps) {
    const [cmd, a, c] = st.split(':');
    if (cmd === 'wait') await page.waitForTimeout(+a);
    else if (cmd === 'click') { await page.click('#' + a); name += '-' + a; }
    else if (cmd === 'drag') {
      const box = await page.locator('#stage').boundingBox();
      await page.mouse.move(box.x + box.width * +a, box.y + box.height * +c);
      await page.mouse.down();
      await page.waitForTimeout(60);
    }
    else if (cmd === 'moveto') {
      const box = await page.locator('#stage').boundingBox();
      await page.mouse.move(box.x + box.width * +a, box.y + box.height * +c, { steps: 8 });
    }
    else if (cmd === 'shot') { await page.screenshot({ path: path.join(OUT, name + '-' + a + '.png') }); }
    else if (cmd === 'grid') {
      const n = +a, gapMs = +c;
      const url = await page.evaluate(async ({ n, gapMs }) => {
        const src = document.getElementById('stage');
        const cols = 3, rows = Math.ceil(n / cols);
        const tw = 420, th = Math.round(420 * src.height / src.width);
        const sheet = document.createElement('canvas');
        sheet.width = tw * cols; sheet.height = th * rows;
        const c = sheet.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, sheet.width, sheet.height);
        for (let i = 0; i < n; i++) {
          await new Promise(r => setTimeout(r, gapMs));
          c.drawImage(src, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
          c.fillStyle = 'rgba(0,0,0,0.6)'; c.font = '15px monospace';
          c.fillText(i * gapMs + 'ms', (i % cols) * tw + 8, Math.floor(i / cols) * th + 20);
        }
        return sheet.toDataURL('image/png');
      }, { n, gapMs });
      fs.writeFileSync(path.join(OUT, name + '-grid.png'), Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log(name, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok');
  await b.close();
})();
