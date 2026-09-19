/* Everything that is actually paint on the glass.
 *
 * No mark is a geometric primitive: a hand is a tapered ribbon with a bowed
 * spine, wobbling edges, dry-brush bristle streaks and a wet sheen that dries
 * off over the first twenty seconds of its life. Wiped hands leave a ghost the
 * cloth could not lift, and the cloth itself leaves a haze that builds up over
 * the hour until the quarter-hour clean-down.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  var noiseCache = Object.create(null);
  var noiseKeys = [];
  function seedNoise(seed) {
    var k = seed | 0;
    var n = noiseCache[k];
    if (!n) {
      n = noiseCache[k] = new U.Noise1D(k, 128);
      noiseKeys.push(k);
      if (noiseKeys.length > 96) delete noiseCache[noiseKeys.shift()];
    }
    return n;
  }

  /* Sampled centre line of a stroke, with a width at every sample. */
  function makeSpine(o) {
    var frac = U.clamp(o.frac, 0, 1);
    var n = Math.max(7, Math.round(30 * Math.max(0.15, frac)));
    var nz = seedNoise(o.seed);
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var u = (i / n) * frac;
      var r = U.lerp(o.rIn, o.rOut, u);
      var a = o.angle + o.bow * Math.sin(u * Math.PI) + nz.at(u * 4.3 + 11) * 0.007;
      var p = U.polar(o.cx, o.cy, a, r);
      var w = U.lerp(o.wBase, o.wTip, Math.pow(u, 0.78)) * (1 + nz.at(u * 9.7 + 41) * 0.17);
      if (o.endSoft && frac < 0.995) w *= U.lerp(0.4, 1, U.smoothstep(frac, frac - 0.08, u));
      pts.push({ x: p.x, y: p.y, w: w, u: u });
    }
    return pts;
  }

  function tangentAt(pts, i) {
    var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.hypot(dx, dy) || 1e-6;
    return { x: dx / d, y: dy / d };
  }

  function ribbon(ctx, pts, scale) {
    var i, t, p;
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; t = tangentAt(pts, i);
      var x = p.x - t.y * p.w * 0.5 * scale, y = p.y + t.x * p.w * 0.5 * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      p = pts[i]; t = tangentAt(pts, i);
      ctx.lineTo(p.x + t.y * p.w * 0.5 * scale, p.y - t.x * p.w * 0.5 * scale);
    }
    ctx.closePath();
    ctx.fill();
  }

  /* Dry-brush: a handful of bristle tracks running the length of the stroke. */
  function bristles(ctx, pts, o) {
    var nz = seedNoise(o.seed + 7);
    var count = 5;
    var wAvg = 0, i;
    for (i = 0; i < pts.length; i++) wAvg += pts[i].w;
    wAvg /= pts.length;
    ctx.lineWidth = Math.max(0.5, wAvg * 0.085);
    for (var k = 0; k < count; k++) {
      var off = (k / (count - 1) - 0.5) * 0.66;
      ctx.globalAlpha = o.alpha * (0.1 + 0.16 * Math.abs(nz.at(k * 3.7)));
      ctx.beginPath();
      for (i = 0; i < pts.length; i++) {
        var p = pts[i], t = tangentAt(pts, i);
        var wob = nz.at(p.u * 13 + k * 17) * 0.09;
        var d = (off + wob) * p.w;
        var x = p.x - t.y * d, y = p.y + t.x * d;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function wetSheen(ctx, pts, o) {
    var a = o.alpha * o.wet;
    if (a < 0.02) return;
    ctx.globalAlpha = a * 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(0.6, pts[0].w * 0.14);
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], t = tangentAt(pts, i);
      var d = -p.w * 0.22;
      var x = p.x - t.y * d, y = p.y + t.x * d;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    var tip = pts[pts.length - 1];
    ctx.globalAlpha = a * 0.34;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(tip.x, tip.y, tip.w * 0.55, tip.w * 0.38, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = o.color;
  }

  /* One painted hand. `frac` is how much of it is currently on the glass. */
  function drawHand(ctx, o) {
    if (o.frac <= 0.004 || o.alpha <= 0.004) return;
    var pts = makeSpine(o);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = o.color;
    ctx.strokeStyle = o.color;
    ctx.globalAlpha = o.alpha * 0.48; ribbon(ctx, pts, 0.92);
    ctx.globalAlpha = o.alpha * 0.32; ribbon(ctx, pts, 1.1);
    ctx.globalAlpha = o.alpha * 0.4; ribbon(ctx, pts, 0.52);
    bristles(ctx, pts, o);
    if (o.wet > 0.02) wetSheen(ctx, pts, o);
    ctx.restore();
    return pts;
  }

  /* The blob of paint at the pivot, built up by years of strokes starting here. */
  function drawHub(ctx, L, alpha, color, seed) {
    var nz = seedNoise(seed);
    var r = L.R * C.schedule.GEO.hub;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.55;
    ctx.beginPath();
    for (var i = 0; i <= 26; i++) {
      var a = i / 26 * TAU;
      var rr = r * (0.88 + nz.at(i * 0.7) * 0.16);
      var x = L.cx + Math.cos(a) * rr, y = L.cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha * 0.35;
    ctx.beginPath();
    ctx.arc(L.cx + r * 0.1, L.cy - r * 0.05, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* Soft smear sprite, drawn once and reused for every cloth mark. */
  function makeSmearSprite() {
    var s = document.createElement('canvas');
    s.width = 128; s.height = 128;
    var c = s.getContext('2d');
    /* radius == half the canvas, so the sprite fades out before its own edge
       and never shows a seam when it is stretched into a streak */
    var g = c.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, 'rgba(70,80,96,0.5)');
    g.addColorStop(0.45, 'rgba(70,80,96,0.18)');
    g.addColorStop(1, 'rgba(70,80,96,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    c.globalCompositeOperation = 'destination-out';
    var rnd = U.mulberry32(4242);
    for (var i = 0; i < 22; i++) {
      c.globalAlpha = 0.12 + rnd() * 0.3;
      c.fillRect(0, rnd() * 128, 128, 1 + rnd() * 2.5);
    }
    return s;
  }

  function drawSmear(ctx, sprite, m, now) {
    var age = (now - m.t0) / 1000;
    var a = m.strength * Math.exp(-age / m.life);
    if (a < 0.006) return false;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(m.x, m.y);
    ctx.rotate(m.rot);
    ctx.drawImage(sprite, -m.len * 0.5, -m.wid * 0.5, m.len, m.wid);
    ctx.restore();
    return true;
  }

  /* ---- the dial itself: painted once, when the canvas is sized ---- */

  function paintedArc(ctx, cx, cy, r, from, to, width, alpha, seed, color) {
    var nz = seedNoise(seed);
    var steps = Math.max(8, Math.round((to - from) * 40));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var a = U.lerp(from, to, t);
        var rr = r * (1 + nz.at(t * 7 + pass * 13) * 0.008);
        var p = U.polar(cx, cy, a, rr);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.globalAlpha = alpha * (pass === 0 ? 0.6 : 0.3);
      ctx.lineWidth = width * (pass === 0 ? 1 : 1.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* The markers are printed on the panel, not painted: crisp, black, and
     identical every hour. Only the hands are hand-made — that contrast is the
     whole point of the object. */
  function buildDial(L, ink, seed) {
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(L.w * L.dpr));
    cv.height = Math.max(1, Math.round(L.h * L.dpr));
    var ctx = cv.getContext('2d');
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    var R = L.R, cx = L.cx, cy = L.cy;

    ctx.fillStyle = '#20232a';
    for (var i = 0; i < 60; i++) {
      var five = i % 5 === 0;
      var a = i / 60 * TAU;
      var r0 = R * (five ? 0.770 : 0.876);
      var r1 = R * 0.949;
      var w0 = R * (five ? 0.036 : 0.0105);
      var w1 = R * (five ? 0.046 : 0.0125);
      var sn = Math.sin(a), cs = Math.cos(a);
      var px = cs, py = sn;                  /* across the marker */
      var ix = cx + sn * r0, iy = cy - cs * r0;
      var ox = cx + sn * r1, oy = cy - cs * r1;
      ctx.globalAlpha = five ? 0.93 : 0.86;
      ctx.beginPath();
      ctx.moveTo(ix - px * w0 * 0.5, iy - py * w0 * 0.5);
      ctx.lineTo(ox - px * w1 * 0.5, oy - py * w1 * 0.5);
      ctx.lineTo(ox + px * w1 * 0.5, oy + py * w1 * 0.5);
      ctx.lineTo(ix + px * w0 * 0.5, iy + py * w0 * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    void seed; void ink;
    return cv;
  }

  C.paint = {
    drawHand: drawHand, drawHub: drawHub, makeSpine: makeSpine,
    makeSmearSprite: makeSmearSprite, drawSmear: drawSmear,
    buildDial: buildDial, paintedArc: paintedArc
  };
})(typeof window !== 'undefined' ? window : globalThis);
