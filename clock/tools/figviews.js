/* The painter, held on one frame and orbited. Head-on hides every fault at a
 * limb root, which is exactly where they are.
 *   node tools/figviews.js "10:37:50"
 */
const path = require('path'); const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/shots';
const when = process.argv[2] || '10:37:50';
/* AIM = height to look at, in heights; ZOOM tightens the view on it. */
const AIM = +(process.env.AIM || 0.58), ZOOM = +(process.env.ZOOM || 1);
const SETTLE = +(process.env.SETTLE || 3900);
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
  const url = await p.evaluate(async ({ AIM, ZOOM }) => {
    const C = window.CLOCK, dev = C.dev, L = dev.layout(), f = dev.figure();
    const w = f.worldPose();
    const rig = new C.Figure3D(window.THREE, f.palette);
    rig.resize({ w: 360, h: 600, cx: L.cx, cy: L.cy,
      fig: { H: L.fig.H, feetY: L.fig.feetY, baseX: L.fig.baseX } }, 1);
    const cols = 4, tw = 360, th = 600;
    const sheet = document.createElement('canvas');
    sheet.width = tw * cols; sheet.height = th;
    const c = sheet.getContext('2d');
    c.fillStyle = '#eef1f5'; c.fillRect(0, 0, sheet.width, sheet.height);
    /* The renderer's world has the ground at y = 0 and the camera a focal
       length out on +z, so orbit at that same distance about mid-torso. */
    const cam = rig.camera, d = L.fig.H * 4 / ZOOM;
    const ox = L.fig.baseX - L.cx, oy = L.fig.H * AIM;
    for (let i = 0; i < cols; i++) {
      const a = i * Math.PI / 2 + 0.35;
      cam.position.set(ox + Math.sin(a) * d, oy + L.fig.H * 0.06, Math.cos(a) * d);
      cam.lookAt(ox, oy, 0);
      c.drawImage(rig.render(w), i * tw, 0, tw, th);
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.font = '15px monospace';
      c.fillText(['front-ish', 'left', 'back', 'right'][i], i * tw + 8, 20);
    }
    return sheet.toDataURL('image/png');
  }, { AIM, ZOOM });
  const file = path.join(OUT, `figviews-${when.replace(/:/g, '')}.png`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(path.basename(file), errs.length ? 'ERRORS ' + errs.join('|') : 'ok');
  await b.close();
})();
