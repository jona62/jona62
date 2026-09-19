/* The person behind the glass.
 *
 * A small skeleton with two-bone IK in the arms and legs. Nothing is keyframed.
 * Each frame the schedule hands over one point on the glass — the tip of the
 * brush, or the corner of the cloth — and the body is solved backwards from it:
 *
 *   brush tip  ->  wrist  ->  where the shoulder would have to be
 *              ->  how far to lean and how deep to sit  ->  knees, feet
 *
 * On top of that solve sit layers of value noise (sway, breath, tremor, the
 * head drifting off its mark) and a per-beat "intent" — a fresh set of stance,
 * weight and head preferences rolled every time the phase or the minute
 * changes. That is what keeps it from reading as a machine: the body is always
 * arriving at a slightly different version of the same position.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;

  /* Proportions, in fractions of total standing height H. */
  var P = {
    pelvis: 0.520, torso: 0.300, neck: 0.040,
    headRx: 0.050, headRy: 0.064,
    shoulder: 0.104, hip: 0.064,
    upperArm: 0.163, foreArm: 0.150, handLen: 0.052,
    thigh: 0.245, shin: 0.235,
    crouchMax: 0.215
  };

  var PALETTES = [
    { shirt: '#4e6079', shirtDark: '#3b4a60', trouser: '#39404c', hair: '#33241d', skin: '#c8a086' },
    { shirt: '#7c5a4a', shirtDark: '#654639', trouser: '#3f4348', hair: '#1f1a18', skin: '#a97b5c' },
    { shirt: '#5f6b52', shirtDark: '#4a553f', trouser: '#37393c', hair: '#5a4230', skin: '#d8b596' },
    { shirt: '#6a5b78', shirtDark: '#544763', trouser: '#3c3a44', hair: '#241c1a', skin: '#8e6a52' },
    { shirt: '#8a7a5e', shirtDark: '#6d604a', trouser: '#414247', hair: '#3f3028', skin: '#c99a7b' },
    { shirt: '#44686a', shirtDark: '#345254', trouser: '#3a3f42', hair: '#2a211d', skin: '#b98d6e' }
  ];

  /* Global motion scale: trimmed back under prefers-reduced-motion. */
  function mo() { return C.motion == null ? 1 : C.motion; }

  function spring(st, key, target, k, c, dt) {
    var v = key + 'v';
    st[v] += (target - st[key]) * k * dt;
    st[v] *= Math.exp(-c * dt);
    st[key] += st[v] * dt;
  }

  /* Pick the elbow/knee solution that hangs lower on screen. */
  function jointDown(ax, ay, bx, by, l1, l2) {
    var a = U.solveIK(ax, ay, bx, by, l1, l2, 1);
    var b = U.solveIK(ax, ay, bx, by, l1, l2, -1);
    return a.y > b.y ? a : b;
  }

  function Figure(seed) {
    this.seed = seed;
    this.rng = U.mulberry32(seed);
    this.n = [];
    for (var i = 0; i < 9; i++) this.n.push(new U.Noise1D(seed + i * 7919 + 13, 256));
    this.palette = PALETTES[Math.floor(this.rng() * PALETTES.length)];
    this.s = {
      crouch: 0.06, lean: 0.03, pelvisDX: 0, twist: 0,
      footL: -0.085, footR: 0.10, footLPrev: -0.085, footRPrev: 0.10,
      headYaw: 0, headTilt: 0, shrug: 0,
      hbx: 0, hby: 0, hbxv: 0, hbyv: 0,
      hcx: 0, hcy: 0, hcxv: 0, hcyv: 0,
      ready: false
    };
    this.intent = null;
    this.intentKey = '';
  }

  Figure.prototype.rollIntent = function (key) {
    var r = U.mulberry32(U.hash(this.seed, key));
    this.intentKey = key;
    this.intent = {
      footL: -0.040 - r() * 0.055,
      footR: 0.045 + r() * 0.065,
      weight: (r() * 2 - 1) * 0.6,
      crouchBias: (r() * 2 - 1) * 0.07,
      leanBias: (r() * 2 - 1) * 0.035,
      headYaw: (r() * 2 - 1) * 0.5,
      headTilt: (r() * 2 - 1) * 0.2,
      shrug: r() * 0.5,
      brushRest: { x: -0.11 - r() * 0.05, y: 0.23 + r() * 0.10 },
      clothRest: { x: 0.11 + r() * 0.05, y: 0.22 + r() * 0.11 },
      glance: r()
    };
  };

  Figure.prototype.update = function (dt, S, L, t) {
    var s = this.s, H = L.fig.H, F = L.fig.feetY, n = this.n;
    var key = S.m + '|' + S.phase;
    if (key !== this.intentKey) this.rollIntent(key);
    var I = this.intent;

    var brushSide = S.active.side === 'brush';
    var sideSign = brushSide ? -1 : 1;           /* -1 = viewer-left arm */
    var T = S.active.pt;
    var tight = S.active.tight, effort = S.active.effort;

    if (!s.ready) {
      s.hbx = T.x; s.hby = T.y; s.hcx = T.x; s.hcy = T.y; s.ready = true;
    }

    /* --- where each hand wants to be --- */
    var leanNow = s.lean;
    var dirX = Math.sin(leanNow), dirY = -Math.cos(leanNow);
    var perpX = Math.cos(leanNow), perpY = Math.sin(leanNow);
    var pelvisX = L.fig.baseX + s.pelvisDX * H;
    var pelvisY = F - (P.pelvis - s.crouch * P.crouchMax) * H;
    var chestX = pelvisX + dirX * P.torso * H, chestY = pelvisY + dirY * P.torso * H;

    var restB = {
      x: chestX + perpX * I.brushRest.x * H + n[0].fbm(t * 0.21) * 0.02 * H * mo(),
      y: chestY + I.brushRest.y * H + n[1].fbm(t * 0.19) * 0.022 * H * mo()
    };
    var restC = {
      x: chestX + perpX * I.clothRest.x * H + n[2].fbm(t * 0.23 + 5) * 0.02 * H * mo(),
      y: chestY + I.clothRest.y * H + n[3].fbm(t * 0.18 + 9) * 0.022 * H * mo()
    };

    var kA = U.lerp(46, 320, tight), cA = U.lerp(10.5, 34, tight);
    var kR = 30, cR = 9;
    if (brushSide) {
      spring(s, 'hbx', T.x, kA, cA, dt); spring(s, 'hby', T.y, kA, cA, dt);
      spring(s, 'hcx', restC.x, kR, cR, dt); spring(s, 'hcy', restC.y, kR, cR, dt);
    } else {
      spring(s, 'hcx', T.x, kA, cA, dt); spring(s, 'hcy', T.y, kA, cA, dt);
      spring(s, 'hbx', restB.x, kR, cR, dt); spring(s, 'hby', restB.y, kR, cR, dt);
    }

    /* The tool always meets the glass at the exact point the schedule asked
       for; the spring only decides from which direction the hand comes at it. */
    var toolLen = (brushSide ? P.handLen * 1.55 : P.handLen * 0.8) * H;
    var ax = (brushSide ? s.hbx : s.hcx) - T.x;
    var ay = (brushSide ? s.hby : s.hcy) - T.y;
    var ad = Math.hypot(ax, ay);
    if (ad < 1e-3) { ax = sideSign * 0.4; ay = 0.9; ad = 1; }
    var wrist = { x: T.x + (ax / ad) * toolLen, y: T.y + (ay / ad) * toolLen };
    this.tool = { tip: T, base: wrist, side: S.active.side, tight: tight };

    /* --- solve the body from the working wrist --- */
    var armLen = (P.upperArm + P.foreArm) * H;
    var restSX = L.fig.baseX + sideSign * P.shoulder * H;
    var restSY = F - (P.pelvis + P.torso) * H;
    var dx = restSX - wrist.x, dy = restSY - wrist.y;
    var d = Math.hypot(dx, dy) || 1e-6;
    var pull = U.smoothstep(armLen * 0.5, armLen * 0.94, d);
    var comfort = U.lerp(0.80, 0.70, effort);
    var sStarX = U.lerp(restSX, wrist.x + (dx / d) * armLen * comfort, pull);
    var sStarY = U.lerp(restSY, wrist.y + (dy / d) * armLen * comfort, pull);

    var chestStarX = sStarX - perpX * sideSign * P.shoulder * H;
    var chestStarY = sStarY - perpY * sideSign * P.shoulder * H;

    var weightT = I.weight * 0.6 + (T.x - L.fig.baseX) / H * 0.10 * effort;
    var pelvisDXT = U.clamp(weightT * 0.055, -0.075, 0.075);
    s.pelvisDX = U.damp(s.pelvisDX, pelvisDXT, 2.4, dt);

    var pxNow = L.fig.baseX + s.pelvisDX * H;
    var torsoLen = P.torso * H;
    var ddx = U.clamp(chestStarX - pxNow, -torsoLen * 0.88, torsoLen * 0.88);
    var ddy = Math.sqrt(Math.max(1e-6, torsoLen * torsoLen - ddx * ddx));
    var pelvisYNeed = chestStarY + ddy;
    var pelvisBaseY = F - P.pelvis * H;
    var crouchT = U.clamp((pelvisYNeed - pelvisBaseY) / (P.crouchMax * H) + I.crouchBias, -0.12, 1);
    var leanT = U.clamp(Math.atan2(ddx, ddy) + I.leanBias, -0.44, 0.44);

    s.crouch = U.damp(s.crouch, crouchT, U.lerp(3.4, 6.2, effort), dt);
    s.lean = U.damp(s.lean, leanT, U.lerp(3.0, 5.6, effort), dt);

    var twistT = U.clamp((wrist.x - pxNow) / H * 1.5, -0.55, 0.55) * (0.35 + 0.65 * effort);
    s.twist = U.damp(s.twist, twistT, 3.2, dt);
    s.shrug = U.damp(s.shrug, I.shrug * 0.4 + effort * 0.5, 3.6, dt);

    /* feet: planted, but re-placed whenever the intent changes */
    var footLT = I.footL - s.crouch * 0.018 - Math.max(0, weightT) * 0.010;
    var footRT = I.footR + s.crouch * 0.022 + Math.max(0, -weightT) * 0.010;
    s.footLPrev = s.footL; s.footRPrev = s.footR;
    s.footL = U.damp(s.footL, footLT, 2.1, dt);
    s.footR = U.damp(s.footR, footRT, 2.1, dt);
    this.liftL = U.clamp(Math.abs(s.footL - footLT) * 0.9, 0, 0.026);
    this.liftR = U.clamp(Math.abs(s.footR - footRT) * 0.9, 0, 0.026);

    /* head: mostly watching the work, occasionally not */
    var headPos = { x: chestX + dirX * P.neck * H, y: chestY + dirY * P.neck * H - P.headRy * H };
    var glance = n[5].fbm(t * 0.13 + 3, 2);
    var away = (1 - effort) * U.smoothstep(0.45, 0.85, Math.abs(glance)) * Math.sign(glance) * mo();
    var yawT = U.clamp((T.x - headPos.x) / (H * 0.42), -1, 1) * 0.72 + I.headYaw * 0.25 * (1 - effort) + away * 0.5;
    var tiltT = U.clamp((T.y - headPos.y) / (H * 0.5), -1, 1) * 0.3 + I.headTilt * 0.4 * (1 - effort);
    s.headYaw = U.damp(s.headYaw, U.clamp(yawT, -1.1, 1.1), 4.2, dt);
    s.headTilt = U.damp(s.headTilt, U.clamp(tiltT, -0.42, 0.42), 3.8, dt);
  };

  Figure.prototype.pose = function (L, t) {
    var s = this.s, n = this.n, H = L.fig.H, F = L.fig.feetY;
    var breath = Math.sin(t * 0.63) * 0.6 + n[6].at(t * 0.29) * 0.4;
    var sway = n[7].fbm(t * 0.11, 2) * mo();

    var lean = s.lean + n[4].fbm(t * 0.16 + 2) * 0.014 * mo();
    var dir = { x: Math.sin(lean), y: -Math.cos(lean) };
    var perp = { x: Math.cos(lean), y: Math.sin(lean) };

    var pelvis = {
      x: L.fig.baseX + s.pelvisDX * H + sway * 0.012 * H,
      y: F - (P.pelvis - s.crouch * P.crouchMax) * H + breath * 0.0026 * H
    };
    var torsoLen = P.torso * H * (1 + breath * 0.005);
    var chest = { x: pelvis.x + dir.x * torsoLen, y: pelvis.y + dir.y * torsoLen };

    var shW = P.shoulder * H * (1 - 0.22 * Math.abs(s.twist));
    var shCx = chest.x + perp.x * s.twist * shW * 0.5;
    var shCy = chest.y + perp.y * s.twist * shW * 0.5 - s.shrug * 0.012 * H;
    var shL = { x: shCx - perp.x * shW, y: shCy - perp.y * shW - s.shrug * 0.004 * H };
    var shR = { x: shCx + perp.x * shW, y: shCy + perp.y * shW - s.shrug * 0.004 * H };

    var hipL = { x: pelvis.x - perp.x * P.hip * H, y: pelvis.y - perp.y * P.hip * H };
    var hipR = { x: pelvis.x + perp.x * P.hip * H, y: pelvis.y + perp.y * P.hip * H };
    var ankL = { x: L.fig.baseX + s.footL * H, y: F - (0.032 + this.liftL) * H };
    var ankR = { x: L.fig.baseX + s.footR * H, y: F - (0.030 + this.liftR) * H };

    /* legs shorten a little as the knees come forward — cheap foreshortening */
    var legK = 1 - 0.42 * s.crouch;
    var kneeL = U.solveIK(hipL.x, hipL.y, ankL.x, ankL.y, P.thigh * H * legK, P.shin * H * legK, 1);
    var kneeR = U.solveIK(hipR.x, hipR.y, ankR.x, ankR.y, P.thigh * H * legK, P.shin * H * legK, -1);

    var handB = { x: s.hbx, y: s.hby }, handC = { x: s.hcx, y: s.hcy };
    if (this.tool) {
      if (this.tool.side === 'brush') handB = this.tool.base; else handC = this.tool.base;
    }
    var elbowL = jointDown(shL.x, shL.y, handB.x, handB.y, P.upperArm * H, P.foreArm * H);
    var elbowR = jointDown(shR.x, shR.y, handC.x, handC.y, P.upperArm * H, P.foreArm * H);

    var neck = { x: chest.x + dir.x * P.neck * H, y: chest.y + dir.y * P.neck * H };
    var headAng = lean + s.headTilt * 0.55 + n[8].fbm(t * 0.24) * 0.02 * mo();
    var hdir = { x: Math.sin(headAng), y: -Math.cos(headAng) };
    var head = {
      x: neck.x + hdir.x * P.headRy * H * 1.02 + perp.x * s.headYaw * P.headRx * H * 0.55,
      y: neck.y + hdir.y * P.headRy * H * 1.02 + s.headTilt * P.headRy * H * 0.22,
      ang: headAng, yaw: s.headYaw,
      rx: P.headRx * H, ry: P.headRy * H
    };

    return {
      H: H, pelvis: pelvis, chest: chest, dir: dir, perp: perp,
      shL: shL, shR: shR, hipL: hipL, hipR: hipR,
      kneeL: kneeL, kneeR: kneeR, ankL: ankL, ankR: ankR,
      elbowL: elbowL, elbowR: elbowR, handB: handB, handC: handC,
      neck: neck, head: head, tool: this.tool, crouch: s.crouch, feetY: F
    };
  };

  function limb(ctx, a, b, c, w1, w2, color) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = w1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = w2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  }

  Figure.prototype.draw = function (far, near, p, L) {
    var H = p.H, pal = this.palette;

    /* contact shadow on the floor */
    far.save();
    far.globalAlpha = 0.5;
    far.fillStyle = '#6f727a';
    far.beginPath();
    far.ellipse(p.pelvis.x, p.feetY - 0.006 * H, 0.20 * H, 0.030 * H, 0, 0, U.TAU);
    far.fill();
    far.restore();

    /* far leg reads a touch lighter than the near one */
    far.globalAlpha = 0.82;
    limb(far, p.hipR, p.kneeR, p.ankR, 0.088 * H, 0.070 * H, pal.trouser);
    far.globalAlpha = 1;
    limb(far, p.hipL, p.kneeL, p.ankL, 0.092 * H, 0.074 * H, pal.trouser);

    /* shoes */
    far.fillStyle = '#2f3237';
    [p.ankL, p.ankR].forEach(function (a) {
      far.beginPath();
      far.ellipse(a.x, a.y + 0.020 * H, 0.046 * H, 0.020 * H, 0, 0, U.TAU);
      far.fill();
    });

    /* torso */
    var g = far.createLinearGradient(p.chest.x, p.chest.y, p.pelvis.x, p.pelvis.y);
    g.addColorStop(0, pal.shirt);
    g.addColorStop(1, pal.shirtDark);
    far.fillStyle = g;
    far.beginPath();
    far.moveTo(p.hipL.x, p.hipL.y);
    far.quadraticCurveTo(
      p.hipL.x + (p.shL.x - p.hipL.x) * 0.35 - p.perp.x * 0.022 * H,
      p.hipL.y + (p.shL.y - p.hipL.y) * 0.5,
      p.shL.x, p.shL.y);
    far.quadraticCurveTo(p.chest.x + p.dir.x * 0.035 * H, p.chest.y + p.dir.y * 0.035 * H, p.shR.x, p.shR.y);
    far.quadraticCurveTo(
      p.hipR.x + (p.shR.x - p.hipR.x) * 0.35 + p.perp.x * 0.022 * H,
      p.hipR.y + (p.shR.y - p.hipR.y) * 0.5,
      p.hipR.x, p.hipR.y);
    far.quadraticCurveTo(p.pelvis.x, p.pelvis.y + 0.035 * H, p.hipL.x, p.hipL.y);
    far.closePath();
    far.fill();

    /* neck + head, no features — through the glass there is nothing to read */
    far.strokeStyle = pal.skin;
    far.lineWidth = 0.044 * H;
    far.lineCap = 'round';
    far.beginPath();
    far.moveTo(p.neck.x, p.neck.y);
    far.lineTo(p.head.x - p.dir.x * p.head.ry * 0.6, p.head.y - p.dir.y * p.head.ry * 0.6);
    far.stroke();

    far.save();
    far.translate(p.head.x, p.head.y);
    far.rotate(p.head.ang);
    far.fillStyle = pal.hair;
    far.beginPath();
    far.ellipse(-p.head.yaw * p.head.rx * 0.22, -p.head.ry * 0.10, p.head.rx * 1.16, p.head.ry * 1.12, 0, 0, U.TAU);
    far.fill();
    far.fillStyle = pal.skin;
    far.beginPath();
    far.ellipse(p.head.yaw * p.head.rx * 0.16, p.head.ry * 0.06, p.head.rx * 0.94, p.head.ry * 0.92, 0, 0, U.TAU);
    far.fill();
    far.fillStyle = pal.hair;          /* fringe */
    far.beginPath();
    far.ellipse(p.head.yaw * p.head.rx * 0.2, -p.head.ry * 0.52, p.head.rx * 1.02, p.head.ry * 0.5, 0, 0, U.TAU);
    far.fill();
    far.restore();

    /* the arm that is not working stays on the far layer */
    var workingLeft = p.tool && p.tool.side === 'brush';
    var idleArm = workingLeft
      ? [p.shR, p.elbowR, p.handC, pal.shirt]
      : [p.shL, p.elbowL, p.handB, pal.shirt];
    far.globalAlpha = 0.9;
    limb(far, idleArm[0], idleArm[1], idleArm[2], 0.062 * H, 0.050 * H, idleArm[3]);
    far.fillStyle = pal.skin;
    far.beginPath();
    far.arc(idleArm[2].x, idleArm[2].y, 0.026 * H, 0, U.TAU);
    far.fill();
    far.globalAlpha = 1;

    /* the working arm sits against the glass: sharper, on its own layer */
    var act = workingLeft
      ? [p.shL, p.elbowL, p.handB]
      : [p.shR, p.elbowR, p.handC];
    limb(near, act[0], act[1], act[2], 0.060 * H, 0.049 * H, pal.shirt);
    near.fillStyle = pal.skin;
    near.beginPath();
    near.arc(act[2].x, act[2].y, 0.027 * H, 0, U.TAU);
    near.fill();

    if (p.tool) {
      var tp = p.tool.tip, bp = p.tool.base;
      if (p.tool.side === 'brush') {
        near.strokeStyle = '#5b4632';
        near.lineCap = 'round';
        near.lineWidth = 0.014 * H;
        near.beginPath(); near.moveTo(bp.x, bp.y); near.lineTo(tp.x, tp.y); near.stroke();
        near.strokeStyle = '#2b2622';
        near.lineWidth = 0.017 * H;
        near.beginPath();
        near.moveTo(U.lerp(bp.x, tp.x, 0.55), U.lerp(bp.y, tp.y, 0.55));
        near.lineTo(tp.x, tp.y);
        near.stroke();
      } else {
        near.fillStyle = '#c0ae93';
        near.save();
        near.translate(U.lerp(bp.x, tp.x, 0.45), U.lerp(bp.y, tp.y, 0.45));
        near.rotate(Math.atan2(tp.y - bp.y, tp.x - bp.x));
        near.beginPath();
        near.ellipse(0, 0, 0.050 * H, 0.036 * H, 0, 0, U.TAU);
        near.fill();
        near.globalAlpha = 0.5;
        near.fillStyle = '#9d8d74';
        near.beginPath();
        near.ellipse(-0.012 * H, 0.008 * H, 0.030 * H, 0.020 * H, 0.4, 0, U.TAU);
        near.fill();
        near.globalAlpha = 1;
        near.restore();
      }
    }
  };

  C.Figure = Figure;
  C.PALETTES = PALETTES;
  C.PROPORTIONS = P;
})(typeof window !== 'undefined' ? window : globalThis);
