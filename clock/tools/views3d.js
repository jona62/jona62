/* Orbit the camera round a held pose and tile the views, so limb roots and
 * joints can be checked from every side at once. Usage:
 *   node tools/views3d.js [pose]   pose = idle | reach | crouch | run | jump
 */
const path = require('path'); const fs = require('fs');
const { chromium } = require('playwright');
const POSE = process.argv[2] || 'idle';
const OUT = process.env.OUT || '/tmp/shots';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 520, height: 620 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.resolve(__dirname, '..', 'lab3d', 'index.html'));
  await p.waitForTimeout(2200);
  const url = await p.evaluate(async ({ POSE, DIST, TY }) => {
    const B = window.__body, R = window.CLOCK.rig;
    const H = B.H;
    if (POSE === 'reach') B.reach = { side: 'R', point: R.v(B.pos.x + 0.55 * H, 1.55 * H, B.pos.z + 0.35 * H), tight: 0.9, effort: 0.9 };
    if (POSE === 'crouch') B.ctl.crouch = 0.8;
    if (POSE === 'run') { B.ctl.run = true; B.ctl.moveDir = { x: 0, z: -1 }; }
    if (POSE === 'jump') B.jump();
    await new Promise(r => setTimeout(r, POSE === 'jump' ? 420 : 1400));
    window.__setCam({ dist: DIST, pitch: 0.12, ty: TY });
    const src = document.getElementById('stage');
    const cols = 4, tw = 400, th = Math.round(400 * src.height / src.width);
    const sheet = document.createElement('canvas');
    sheet.width = tw * cols; sheet.height = th;
    const c = sheet.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < cols; i++) {
      window.__setCam({ yaw: i * Math.PI / 2 + 0.35 });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      c.drawImage(src, i * tw, 0, tw, th);
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.font = '16px monospace';
      c.fillText(['front-ish', 'left', 'back', 'right'][i], i * tw + 8, 22);
    }
    return sheet.toDataURL('image/png');
  }, { POSE, DIST: +(process.env.DIST || 2.1), TY: +(process.env.TY || 1.15) });
  fs.writeFileSync(path.join(OUT, `views-${POSE}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`views-${POSE}.png`, errs.length ? 'ERRORS ' + errs.join('|') : 'ok');
  await b.close();
})();
