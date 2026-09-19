/* The object on the wall.
 *
 * A brass-faced box with a round aperture, and behind the aperture a backlit
 * diffuser panel: the face is a lit screen, not a white card, so the light
 * comes from behind the painter. That is why he reads as a colour-bled
 * silhouette — the panel is blowing out around him.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;

  /* Fine grid of the diffuser, as a repeating tile — cheaper and crisper than
     baking it across the whole face. */
  function makeDiffuserTile(px) {
    var n = Math.max(3, Math.round(px));
    var cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    var c = cv.getContext('2d');
    c.fillStyle = 'rgba(148,156,168,0.085)';
    c.fillRect(0, 0, n, 1);
    c.fillRect(0, 0, 1, n);
    c.fillStyle = 'rgba(148,156,168,0.05)';
    c.fillRect(1, 1, n - 1, n - 1);
    return cv;
  }

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
      d[o] = 126; d[o + 1] = 132; d[o + 2] = 142;
      d[o + 3] = v < 0.55 ? 0 : Math.round((v - 0.55) * 26);
    }
    ctx.putImageData(img, 0, 0);

    /* old cloth passes, still in the surface */
    ctx.lineCap = 'round';
    for (var k = 0; k < 12; k++) {
      var y0 = rnd() * h, x0 = rnd() * w;
      var len = w * (0.25 + rnd() * 0.6);
      var ang = (rnd() - 0.5) * 0.7;
      var gl = ctx.createLinearGradient(x0, y0, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      gl.addColorStop(0, 'rgba(255,255,255,0)');
      gl.addColorStop(0.5, 'rgba(255,255,255,' + (0.05 + rnd() * 0.08).toFixed(3) + ')');
      gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = gl;
      ctx.lineWidth = h * (0.01 + rnd() * 0.05);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      ctx.stroke();
    }
    return cv;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* The wall the box hangs on. */
  function drawRoom(ctx, L) {
    var g = ctx.createLinearGradient(0, 0, 0, L.h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#fbfbfa');
    g.addColorStop(1, '#f0efec');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.w, L.h);
  }

  /* The box: brushed brass, lit from high left, with the aperture cut out of
     it and the panel's own thickness shading the inside of the hole. */
  function drawHousing(ctx, L) {
    var P = L.panel, R = L.R;

    ctx.save();
    ctx.shadowColor = 'rgba(70,66,58,0.28)';
    ctx.shadowBlur = R * 0.22;
    ctx.shadowOffsetY = R * 0.06;
    var g = ctx.createLinearGradient(P.x, P.y, P.x + P.s * 0.55, P.y + P.s);
    g.addColorStop(0, '#bdae91');
    g.addColorStop(0.18, '#ab9c80');
    g.addColorStop(0.55, '#97886e');
    g.addColorStop(1, '#7f7259');
    ctx.fillStyle = g;
    roundRect(ctx, P.x, P.y, P.s, P.s, P.s * 0.045);
    ctx.fill();
    ctx.restore();

    /* highlight running along the top edge and down the left */
    var hi = ctx.createLinearGradient(P.x, P.y, P.x + P.s * 0.4, P.y + P.s * 0.28);
    hi.addColorStop(0, 'rgba(255,250,236,0.55)');
    hi.addColorStop(1, 'rgba(255,250,236,0)');
    ctx.fillStyle = hi;
    roundRect(ctx, P.x, P.y, P.s, P.s, P.s * 0.045);
    ctx.fill();

    /* the aperture, punched out */
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';          /* opaque: the punch must erase fully */
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R, 0, U.TAU);
    ctx.fill();
    ctx.restore();
  }

  /* Inside the aperture: a lit panel, hottest a little above centre. */
  function drawFace(ctx, L, tile) {
    var R = L.R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R, 0, U.TAU);
    ctx.clip();

    var g = ctx.createRadialGradient(L.cx, L.cy - R * 0.12, R * 0.05, L.cx, L.cy, R * 1.12);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.62, '#fbfbfb');
    g.addColorStop(1, '#eeeeef');
    ctx.fillStyle = g;
    ctx.fillRect(L.cx - R, L.cy - R, R * 2, R * 2);

    if (tile) {
      var pat = ctx.createPattern(tile, 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(L.cx - R, L.cy - R, R * 2, R * 2);
      }
    }
    ctx.restore();
  }

  /* The panel edge shades the first few millimetres inside the hole. */
  function drawApertureEdge(ctx, L) {
    var R = L.R;
    var g = ctx.createRadialGradient(L.cx, L.cy, R * 0.90, L.cx, L.cy, R);
    g.addColorStop(0, 'rgba(126,118,100,0)');
    g.addColorStop(0.75, 'rgba(126,118,100,0.07)');
    g.addColorStop(1, 'rgba(112,104,88,0.30)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R, 0, U.TAU);
    ctx.fill();
  }

  /* Diffusion: what stops you reading his face. Light, because the blur and
     the blown-out panel are doing most of the work. */
  function drawVeil(ctx, L) {
    var g = ctx.createRadialGradient(
      L.cx, L.cy - L.R * 0.2, L.R * 0.1,
      L.cx, L.cy, L.R * 1.1);
    g.addColorStop(0, 'rgba(255,255,255,0.20)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(250,250,250,0.44)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.R, 0, U.TAU);
    ctx.fill();
  }

  function drawStatics(ctx, L, tex) {
    if (tex) {
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.drawImage(tex, 0, 0, L.w, L.h);
      ctx.restore();
    }
    var g2 = ctx.createRadialGradient(L.cx - L.R * 0.5, L.cy - L.R * 0.6, 0,
      L.cx - L.R * 0.5, L.cy - L.R * 0.6, L.R * 1.4);
    g2.addColorStop(0, 'rgba(255,255,255,0.20)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, L.w, L.h);
  }

  /* The cover glass, drifting slower than you can watch. */
  function drawGloss(ctx, L, bx) {
    var h = L.h, w = L.w;
    var g1 = ctx.createLinearGradient(bx - w * 0.5, -h * 0.2, bx + w * 0.35, h * 1.2);
    g1.addColorStop(0, 'rgba(255,255,255,0)');
    g1.addColorStop(0.45, 'rgba(255,255,255,0.07)');
    g1.addColorStop(0.56, 'rgba(255,255,255,0.12)');
    g1.addColorStop(0.7, 'rgba(255,255,255,0.03)');
    g1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w * 2, h);
  }

  /* Where a hand presses the glass the diffusion clears a little. */
  function contactGlow(ctx, x, y, r, strength) {
    if (strength <= 0.01) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.26 * strength).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(255,255,255,' + (0.09 * strength).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, U.TAU);
    ctx.fill();
  }

  C.glass = {
    buildTexture: buildTexture, makeDiffuserTile: makeDiffuserTile,
    drawRoom: drawRoom, drawHousing: drawHousing, drawFace: drawFace,
    drawApertureEdge: drawApertureEdge, drawVeil: drawVeil,
    drawStatics: drawStatics, drawGloss: drawGloss, contactGlow: contactGlow
  };
})(typeof window !== 'undefined' ? window : globalThis);
