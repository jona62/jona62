/* The pane between you and them.
 *
 * Three things stack up here: a milky veil that swallows the figure's detail,
 * a grain/smudge texture baked once per resize, and a slowly drifting gloss
 * that never quite repeats. The veil sits *behind* the paint, because the
 * paint is on the glass and the painter is not.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;

  function buildTexture(L, seed) {
    var w = Math.max(2, Math.round(L.w * 0.5));
    var h = Math.max(2, Math.round(L.h * 0.5));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var rnd = U.mulberry32(seed);

    var img = ctx.createImageData(w, h);
    var d = img.data;
    for (var i = 0; i < w * h; i++) {
      var v = rnd();
      var o = i * 4;
      d[o] = 120; d[o + 1] = 128; d[o + 2] = 138;
      d[o + 3] = v < 0.5 ? 0 : Math.round((v - 0.5) * 34);
    }
    ctx.putImageData(img, 0, 0);

    /* old cloth passes, still in the surface */
    ctx.lineCap = 'round';
    for (var k = 0; k < 16; k++) {
      var y0 = rnd() * h, x0 = rnd() * w;
      var len = w * (0.25 + rnd() * 0.6);
      var ang = (rnd() - 0.5) * 0.7;
      var gl = ctx.createLinearGradient(x0, y0, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      gl.addColorStop(0, 'rgba(255,255,255,0)');
      gl.addColorStop(0.5, 'rgba(255,255,255,' + (0.05 + rnd() * 0.09).toFixed(3) + ')');
      gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = gl;
      ctx.lineWidth = h * (0.01 + rnd() * 0.05);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      ctx.stroke();
    }
    /* dust */
    ctx.fillStyle = 'rgba(90,96,106,0.35)';
    for (var s = 0; s < 90; s++) {
      ctx.globalAlpha = 0.1 + rnd() * 0.4;
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, rnd() * 1.4 + 0.2, 0, U.TAU);
      ctx.fill();
    }
    return cv;
  }

  /* The wall the clock hangs on, and the shadow the disc casts on it. */
  function drawWall(ctx, L) {
    var g = ctx.createLinearGradient(0, 0, 0, L.h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.62, '#fbfaf9');
    g.addColorStop(1, '#f3f1ee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.w, L.h);

    var sh = ctx.createRadialGradient(L.cx, L.cy + L.R * 0.03, L.R * 0.97, L.cx, L.cy + L.R * 0.03, L.R * 1.17);
    sh.addColorStop(0, 'rgba(96,100,108,0.13)');
    sh.addColorStop(0.45, 'rgba(96,100,108,0.05)');
    sh.addColorStop(1, 'rgba(96,100,108,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, L.w, L.h);
  }

  /* Inside the case: light pools in the middle, the far wall falls away. */
  function drawCase(ctx, L) {
    var g = ctx.createRadialGradient(
      L.cx - L.R * 0.2, L.cy - L.R * 0.3, L.R * 0.05,
      L.cx, L.cy, L.R * 1.05);
    g.addColorStop(0, '#f4f2ee');
    g.addColorStop(0.55, '#eae7e2');
    g.addColorStop(1, '#d8d4cd');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.R, 0, U.TAU);
    ctx.fill();
  }

  /* Milky pane: heavier towards the edges, thinner where the light is. */
  function drawVeil(ctx, L) {
    var g = ctx.createRadialGradient(
      L.cx - L.R * 0.35, L.cy - L.R * 0.5, L.R * 0.1,
      L.cx, L.cy, L.R * 1.15);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.45, 'rgba(252,252,251,0.30)');
    g.addColorStop(1, 'rgba(250,250,249,0.62)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.R, 0, U.TAU);
    ctx.fill();
  }

  /* The edge of the disc: glass has thickness and catches the light. */
  function drawRim(ctx, L) {
    var R = L.R;
    ctx.save();
    ctx.lineCap = 'butt';

    var g = ctx.createLinearGradient(L.cx - R, L.cy - R, L.cx + R, L.cy + R);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.62, 'rgba(163,172,182,0.30)');
    g.addColorStop(1, 'rgba(128,137,148,0.45)');
    ctx.strokeStyle = g;
    ctx.lineWidth = R * 0.016;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R - R * 0.008, 0, U.TAU);
    ctx.stroke();

    var g2 = ctx.createLinearGradient(L.cx - R, L.cy - R, L.cx + R, L.cy + R);
    g2.addColorStop(0, 'rgba(255,255,255,0.7)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g2.addColorStop(1, 'rgba(255,255,255,0.55)');
    ctx.strokeStyle = g2;
    ctx.lineWidth = R * 0.006;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R - R * 0.026, 0, U.TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* Everything in the pane that never changes: grain, the window reflection,
     and the cool falloff that gives the glass thickness. Baked once. */
  function drawStatics(ctx, L, tex) {
    var w = L.w, h = L.h;

    if (tex) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.drawImage(tex, 0, 0, w, h);
      ctx.restore();
    }

    /* window reflection, high left */
    var g2 = ctx.createRadialGradient(w * 0.24, h * 0.12, 0, w * 0.24, h * 0.12, Math.max(w, h) * 0.5);
    g2.addColorStop(0, 'rgba(255,255,255,0.22)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    /* cool edge falloff, so the pane has thickness */
    var g3 = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.30, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    g3.addColorStop(0, 'rgba(214,222,229,0)');
    g3.addColorStop(0.72, 'rgba(206,215,224,0.16)');
    g3.addColorStop(1, 'rgba(188,199,211,0.42)');
    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, w, h);
  }

  /* The travelling gloss, baked centred in a canvas twice the window wide so
     the frame loop only has to slide it. */
  function drawGloss(ctx, L, bx) {
    var h = L.h, w = L.w;
    var g1 = ctx.createLinearGradient(bx - w * 0.5, -h * 0.2, bx + w * 0.35, h * 1.2);
    g1.addColorStop(0, 'rgba(255,255,255,0)');
    g1.addColorStop(0.42, 'rgba(255,255,255,0.10)');
    g1.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    g1.addColorStop(0.7, 'rgba(255,255,255,0.04)');
    g1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w * 2, h);
  }

  /* Where a hand presses the glass the frost clears a little. */
  function contactGlow(ctx, x, y, r, strength) {
    if (strength <= 0.01) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.30 * strength).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(255,255,255,' + (0.10 * strength).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, U.TAU);
    ctx.fill();
  }

  C.glass = {
    buildTexture: buildTexture, drawVeil: drawVeil,
    drawWall: drawWall, drawCase: drawCase, drawRim: drawRim,
    drawStatics: drawStatics, drawGloss: drawGloss, contactGlow: contactGlow
  };
})(typeof window !== 'undefined' ? window : globalThis);
