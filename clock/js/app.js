/* Wiring: layout, the history of marks on the glass, and the frame loop.
 *
 * The whole clock is a pure function of the wall clock. Nothing accumulates in
 * a buffer, so opening the page at 09:41:12 shows nine minutes of ghosts and a
 * half-wiped hand, exactly as if it had been running all morning.
 *
 * Cost control: everything that does not change from frame to frame is baked
 * into a layer once (the room, the milky pane, the grain and reflections, the
 * dial and the fan of old ghosts) and blitted. Only the figure, the four or so
 * live brush strokes and the damp trail are redrawn every frame, and the
 * figure is blurred at a fraction of the display resolution — which is free
 * softness as well as cheap.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  var INK = '#181c23';
  var GHOST = '#646c79';
  var LOOKAHEAD_MS = 210; /* postural lead — people move before they move */
  var FIG_SCALE = 0.55;   /* figure buffers, in CSS pixels */
  var OVER_SCALE = 0.5;   /* baked soft overlays */

  var canvas, ctx, srTime;
  var figFar, figFarCtx, figNear, figNearCtx, figBlur, figBlurCtx;
  var wallCv, housingCv, veilCv, sheenCv, glossCv, marksCv, marksCtx;
  var diffuser;
  var texture, smearSprite;
  var L = null, figure = null, marksKey = -1, fig3d = null;
  var last = 0, running = false, lastSrMinute = -1;
  var supportsFilter = false;
  var frameCount = 0, frameSum = 0, downgraded = false, dprCap = 1.75;

  function measure() {
    var w = Math.max(240, global.innerWidth || 800);
    var h = Math.max(240, global.innerHeight || 600);
    var dpr = Math.min(dprCap, global.devicePixelRatio || 1);
    /* A brass box with a round aperture, and a man inside it who comes up to
       about the six o'clock marker. He is small because he works on the end of
       a long handle — which is also what lets him reach the twelve. */
    var R = Math.min(w * 0.345, h * 0.325);
    var H = R * 1.25;
    var cy = h * 0.5;
    var feetY = cy + R * 0.78;
    return {
      w: w, h: h, dpr: dpr,
      cx: w * 0.5, cy: cy, R: R,
      fig: { H: H, feetY: feetY, baseX: w * 0.5 + R * 0.10 },
      panel: { s: R * 2.72, x: w * 0.5 - R * 1.36, y: cy - R * 1.36 }
    };
  }

  function makeCanvas(w, h, scale) {
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    var c = cv.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0);
    cv._ctx = c;
    return cv;
  }

  /* ---- baked layers ---- */

  function bakeWall() {
    var cv = makeCanvas(L.w, L.h, OVER_SCALE), c = cv._ctx;
    C.glass.drawRoom(c, L);
    C.glass.drawFace(c, L, diffuser);
    return cv;
  }

  function bakeHousing() {
    var cv = makeCanvas(L.w, L.h, OVER_SCALE), c = cv._ctx;
    C.glass.drawHousing(c, L);
    C.glass.drawApertureEdge(c, L);
    return cv;
  }

  function bakeVeil() {
    var cv = makeCanvas(L.w, L.h, OVER_SCALE);
    C.glass.drawVeil(cv._ctx, L);
    return cv;
  }

  function bakeSheen() {
    var cv = makeCanvas(L.w, L.h, OVER_SCALE), c = cv._ctx;
    c.save();
    c.beginPath();
    c.arc(L.cx, L.cy, L.R, 0, TAU);
    c.clip();
    C.glass.drawStatics(c, L, texture);
    c.restore();
    return cv;
  }

  /* The travelling gloss is baked twice as wide as the window and simply slid
     across it, so no gradient is ever computed during a frame. */
  function bakeGloss() {
    var cv = makeCanvas(L.w * 2, L.h, OVER_SCALE);
    C.glass.drawGloss(cv._ctx, L, L.w);
    return cv;
  }

  /* ---- marks that are still on the glass, derived from the clock ---- */

  var GHOST_LIFE = 170;   /* seconds for a wiped hand to fade out of sight */
  var SMEAR_LIFE = 900;   /* cloth haze hangs around far longer */
  var HISTORY = 14;       /* how many past minutes are worth drawing */

  function bakeMarks(S) {
    var cx2 = marksCtx, G = C.schedule.GEO, R = L.R;
    cx2.clearRect(0, 0, L.w, L.h);
    var totalMin = S.h * 60 + S.m;
    var lastClean = Math.floor(totalMin / 15) * 15;
    var k, age, a;

    /* cloth haze, oldest first */
    for (k = HISTORY; k >= 1; k--) {
      age = k * 60 + S.sec - 48;
      if (age <= 0) continue;
      a = Math.exp(-age / SMEAR_LIFE) * 0.30;
      if (totalMin - k < lastClean) a *= 0.30;
      if (a < 0.008) continue;
      var ang = C.schedule.minuteAngle(totalMin - k);
      var mid = U.polar(L.cx, L.cy, ang, R * (G.minuteInner + G.minuteOuter) * 0.5);
      C.paint.drawSmear(cx2, smearSprite, {
        x: mid.x, y: mid.y, rot: ang - Math.PI / 2,
        len: R * (G.minuteOuter - G.minuteInner) * 1.25,
        wid: R * 0.30, strength: a, life: 1e9, t0: 0
      }, 0);
    }

    /* ghosts of hands the cloth could not lift */
    for (k = 1; k <= HISTORY; k++) {
      age = k * 60 + S.sec - 48;
      if (age <= 0) continue;
      a = 0.055 * Math.exp(-age / GHOST_LIFE);
      if (a < 0.006) continue;
      var gm = ((S.m - k) % 60 + 60) % 60;
      C.paint.drawHand(cx2, {
        cx: L.cx, cy: L.cy, angle: C.schedule.minuteAngle(gm),
        rIn: R * G.minuteInner, rOut: R * G.minuteOuter,
        wBase: R * 0.052, wTip: R * 0.042, frac: 1,
        bow: ((U.hash(gm) % 1000) / 1000 - 0.5) * 0.026,
        seed: U.hash(gm, 'm'), alpha: a, color: GHOST, wet: 0
      });
    }

    cx2.drawImage(dialLayer, 0, 0, L.w, L.h);
  }

  var dialLayer;

  /* Marks that change too fast to bake: the hand under the cloth right now,
     and the wet streak the cloth is leaving. */
  function drawLiveHistory(cx2, S) {
    var G = C.schedule.GEO, R = L.R;
    if (S.phase === 'wipe' || S.phase === 'hour-wipe') {
      var hour = S.phase === 'hour-wipe';
      var ang = hour ? S.hour.angle : S.minute.angle;
      var rO = hour ? G.hourOuter : G.minuteOuter;
      var rI = hour ? G.hourInner : G.minuteInner;
      var live = hour ? S.hour.live : S.minute.live;
      var to = U.lerp(rI, rO, live);
      var mid = U.polar(L.cx, L.cy, ang, R * (to + rO) * 0.5);
      C.paint.drawSmear(cx2, smearSprite, {
        x: mid.x, y: mid.y, rot: ang - Math.PI / 2,
        len: R * (rO - to + 0.08) * 1.4, wid: R * 0.26,
        strength: 0.4, life: 1e9, t0: 0
      }, 0);
    }
    if (S.minute.live < 0.999) {
      C.paint.drawHand(cx2, {
        cx: L.cx, cy: L.cy, angle: S.minute.angle,
        rIn: R * G.minuteInner, rOut: R * G.minuteOuter,
        wBase: R * 0.050, wTip: R * 0.032, frac: 1,
        bow: ((U.hash(S.m) % 1000) / 1000 - 0.5) * 0.026,
        seed: U.hash(S.m, 'm'), alpha: 0.30 * (1 - S.minute.live), color: GHOST, wet: 0
      });
    }
    if (S.hour.live < 0.999) {
      C.paint.drawHand(cx2, {
        cx: L.cx, cy: L.cy, angle: S.hour.angle,
        rIn: R * G.hourInner, rOut: R * G.hourOuter,
        wBase: R * 0.074, wTip: R * 0.060, frac: 1,
        bow: 0.012, seed: U.hash(S.h, 'h'), alpha: 0.32 * (1 - S.hour.live),
        color: GHOST, wet: 0
      });
    }
  }

  function drawHands(cx2, S) {
    var G = C.schedule.GEO, R = L.R;
    var qi = (S.h * 4 + Math.floor(S.m / 15)) % 96;
    var hSeed = U.hash(qi, 'h');
    var hNext = U.hash((qi + 1) % 96, 'h');
    C.paint.drawHand(cx2, {
      cx: L.cx, cy: L.cy, angle: S.hour.angle,
      rIn: R * G.hourInner, rOut: R * G.hourOuter,
      wBase: R * 0.076, wTip: R * 0.062, frac: S.hour.live,
      bow: ((hSeed % 1000) / 1000 - 0.5) * 0.02, seed: hSeed,
      alpha: 0.92, color: INK, wet: S.hour.wet, endSoft: true
    });
    if (S.hour.fresh > 0) {
      C.paint.drawHand(cx2, {
        cx: L.cx, cy: L.cy, angle: S.hour.nextAngle,
        rIn: R * G.hourInner, rOut: R * G.hourOuter,
        wBase: R * 0.076, wTip: R * 0.062, frac: S.hour.fresh,
        bow: ((hNext % 1000) / 1000 - 0.5) * 0.02, seed: hNext,
        alpha: 0.92, color: INK, wet: 1, endSoft: true
      });
    }

    var mSeed = U.hash(S.m, 'm');
    C.paint.drawHand(cx2, {
      cx: L.cx, cy: L.cy, angle: S.minute.angle,
      rIn: R * G.minuteInner, rOut: R * G.minuteOuter,
      wBase: R * 0.054, wTip: R * 0.044, frac: S.minute.live,
      bow: ((mSeed % 1000) / 1000 - 0.5) * 0.026, seed: mSeed,
      alpha: 0.9, color: INK, wet: S.minute.wet, endSoft: true
    });
    if (S.minute.fresh > 0) {
      var nSeed = U.hash((S.m + 1) % 60, 'm');
      C.paint.drawHand(cx2, {
        cx: L.cx, cy: L.cy, angle: S.minute.nextAngle,
        rIn: R * G.minuteInner, rOut: R * G.minuteOuter,
        wBase: R * 0.054, wTip: R * 0.044, frac: S.minute.fresh,
        bow: ((nSeed % 1000) / 1000 - 0.5) * 0.026, seed: nSeed,
        alpha: 0.9, color: INK, wet: 1, endSoft: true
      });
    }
    C.paint.drawHub(cx2, L, 0.85, INK, U.hash('hub'));
  }

  /* Damp track the brush has left in the frost over the last few seconds —
     the closest thing this clock has to a second hand. */
  function drawTrail(cx2, now) {
    var steps = 20, span = 6.2;
    cx2.save();
    cx2.fillStyle = '#6f7d8d';
    for (var i = steps; i >= 1; i--) {
      var age = (i / steps) * span;
      var p = C.schedule.read(new Date(now - age * 1000), L).active.pt;
      var f = 1 - age / span;
      cx2.globalAlpha = 0.18 * f * f;
      cx2.beginPath();
      cx2.arc(p.x, p.y, L.R * (0.015 + 0.026 * f), 0, TAU);
      cx2.fill();
    }
    cx2.restore();
  }

  function compositeFigure(buf, blurPx, alpha) {
    figBlurCtx.setTransform(1, 0, 0, 1, 0, 0);
    figBlurCtx.clearRect(0, 0, figBlur.width, figBlur.height);
    if (supportsFilter) {
      figBlurCtx.filter = 'blur(' + (blurPx * FIG_SCALE).toFixed(2) + 'px)';
      figBlurCtx.drawImage(buf, 0, 0);
      figBlurCtx.filter = 'none';
    } else {
      var n = 5;
      figBlurCtx.globalAlpha = 1 / n;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU;
        figBlurCtx.drawImage(buf, Math.cos(a) * blurPx * FIG_SCALE, Math.sin(a) * blurPx * FIG_SCALE);
      }
      figBlurCtx.globalAlpha = 1;
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(figBlur, 0, 0, L.w, L.h);
    ctx.globalAlpha = 1;
  }

  function layout() {
    L = measure();
    canvas.style.width = L.w + 'px';
    canvas.style.height = L.h + 'px';
    canvas.width = Math.round(L.w * L.dpr);
    canvas.height = Math.round(L.h * L.dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);

    figFar = makeCanvas(L.w, L.h, FIG_SCALE); figFarCtx = figFar._ctx;
    if (fig3d) fig3d.resize(L, FIG_SCALE);
    figNear = makeCanvas(L.w, L.h, FIG_SCALE); figNearCtx = figNear._ctx;
    figBlur = makeCanvas(L.w, L.h, FIG_SCALE); figBlurCtx = figBlur._ctx;

    var daySeed = U.hash(new Date().toDateString(), 'dial');
    dialLayer = C.paint.buildDial(L, INK, daySeed);
    texture = C.glass.buildTexture(L, daySeed + 17);
    diffuser = C.glass.makeDiffuserTile(Math.max(3, Math.round(L.R * 0.016)));
    wallCv = bakeWall();
    housingCv = bakeHousing();
    veilCv = bakeVeil();
    sheenCv = bakeSheen();
    glossCv = bakeGloss();
    marksCv = makeCanvas(L.w, L.h, L.dpr); marksCtx = marksCv._ctx;
    marksKey = -1;
  }

  function frame(ts) {
    if (!running) return;
    global.requestAnimationFrame(frame);
    var dt = Math.min(0.05, (ts - last) / 1000);
    if (!(dt > 0)) dt = 1 / 60;
    last = ts;

    var date = new Date();
    var now = date.getTime();
    var t = now / 1000;
    var S = C.schedule.read(date, L);
    /* The rig postures for where the work is going, not where it is: gaze and
       the trunk lead the hand by about a fifth of a second, the way a body
       does. The schedule is a pure function of time, so the future is simply
       another read of it. */
    var SA = C.schedule.read(new Date(now + LOOKAHEAD_MS), L);

    figure.update(dt, S, L, t, SA);
    var pose = figure.pose(L, t);

    figFarCtx.clearRect(0, 0, L.w, L.h);
    figNearCtx.clearRect(0, 0, L.w, L.h);
    if (fig3d) {
      /* The body is a lit, lofted, three-dimensional thing; the panel then
         does to it exactly what it did to the flat one. */
      figFarCtx.drawImage(fig3d.render(figure.worldPose()), 0, 0, L.w, L.h);
      figure.drawTool(figNearCtx, pose, L, null);
    } else {
      figure.draw(figFarCtx, figNearCtx, pose, L);
    }
    figure.fade(figFarCtx, L);

    var key = Math.floor(now / 1000);
    if (key !== marksKey) { marksKey = key; bakeMarks(S); }

    ctx.drawImage(wallCv, 0, 0, L.w, L.h);

    ctx.save();
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.R, 0, TAU);
    ctx.clip();
    compositeFigure(figFar, L.R * (fig3d ? 0.026 : 0.034), fig3d ? 0.86 : 0.82);
    compositeFigure(figNear, L.R * 0.020, 0.88);
    ctx.drawImage(veilCv, 0, 0, L.w, L.h);
    drawTrail(ctx, now);
    ctx.drawImage(marksCv, 0, 0, L.w, L.h);
    drawLiveHistory(ctx, S);
    drawHands(ctx, S);
    C.glass.contactGlow(ctx, S.active.pt.x, S.active.pt.y, L.R * 0.30, 0.35 + 0.5 * S.active.tight);
    var drift = Math.sin(t * 0.021) * 0.5 + 0.5;
    ctx.drawImage(glossCv, U.lerp(-1.35, 0.15, drift) * L.w, 0, L.w * 2, L.h);
    ctx.drawImage(sheenCv, 0, 0, L.w, L.h);
    ctx.restore();
    ctx.drawImage(housingCv, 0, 0, L.w, L.h);

    /* One-shot quality fallback: if the first couple of seconds are clearly
       not keeping up, drop to one device pixel per CSS pixel and stay there. */
    if (!downgraded) {
      frameCount++;
      frameSum += dt;
      if (frameCount > 100) {
        if (frameSum / frameCount > 0.038 && L.dpr > 1) {
          downgraded = true;
          dprCap = 1;
          layout();
        } else if (frameCount > 160) {
          downgraded = true;
        }
      }
    }

    if (S.m !== lastSrMinute) {
      lastSrMinute = S.m;
      srTime.textContent = 'The painted hands read ' +
        date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
    }
  }

  function start() {
    canvas = document.getElementById('glass');
    srTime = document.getElementById('srtime');

    var probe = document.createElement('canvas').getContext('2d');
    probe.filter = 'blur(2px)';
    supportsFilter = probe.filter === 'blur(2px)';

    smearSprite = C.paint.makeSmearSprite();
    figure = new C.Figure(U.hash(new Date().toDateString(), 'painter'));

    /* Render the painter in three dimensions where we can, and fall back to
       the flat renderer where we cannot — no WebGL, no three.js, no figure. */
    if (global.THREE && C.Figure3D && C.Skin3D) {
      try {
        fig3d = new C.Figure3D(global.THREE, figure.palette);
      } catch (e) {
        fig3d = null;
      }
    }

    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    C.motion = reduce ? 0.35 : 1;

    layout();

    var resizeTimer = null;
    global.addEventListener('resize', function () {
      global.clearTimeout(resizeTimer);
      resizeTimer = global.setTimeout(layout, 140);
    });
    global.addEventListener('orientationchange', function () {
      global.setTimeout(layout, 220);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
      } else if (!running) {
        running = true;
        last = global.performance.now();
        global.requestAnimationFrame(frame);
      }
    });

    running = true;
    last = global.performance.now();
    global.requestAnimationFrame(frame);

    /* One handle for the screenshot tools, so the figure layer can be read
       back before the glass diffuses it. Costs nothing at runtime. */
    C.dev = { figure: function () { return figure; },
              layer: function () { return figFar; },
              near: function () { return figNear; },
              three: function () { return fig3d; },
              layout: function () { return L; } };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
