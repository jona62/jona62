/* The person on the panel.
 *
 * This is a small biomechanical rig rather than a puppet. Three things make it
 * behave like a body instead of a diagram:
 *
 * 1. REAL PROPORTIONS. Segment lengths are Winter's anthropometric table (after
 *    Drillis & Contini), given as fractions of stature: shoulder at 0.818 H,
 *    hip at 0.530, knee 0.285, ankle 0.039; upper arm 0.186, forearm 0.146,
 *    thigh 0.245, shank 0.246. The heights and the lengths agree with each
 *    other, which is what keeps the silhouette honest at any pose.
 *
 * 2. IT IS SOLVED IN 3D. The panel is a plane in front of him, so reaching for
 *    it is reaching towards the camera. Limbs are solved with a pole vector —
 *    knees bend FORWARD, out of the screen, elbows fall back and down — and
 *    then projected under a weak perspective. That is why a deep squat reads as
 *    the thighs vanishing rather than the knees splaying sideways, and it is
 *    the single biggest difference from a flat two-bone solve.
 *
 * 3. HE HAS TO STAY UP. The centre of mass is computed from Winter's segment
 *    masses (HAT 0.678, each leg 0.161) and has to stay inside the support
 *    polygon — the span between his feet. When the work pulls it towards the
 *    edge he takes a step: a real swing phase, one foot at a time, with the
 *    other foot planted, minimum-jerk horizontally and an arc vertically. The
 *    pelvis is then clamped so neither leg can over-extend, which produces the
 *    hip dip over a wide stance for free (the inverted-pendulum effect).
 *
 * Reaches use the minimum-jerk profile the motor system actually produces
 * (10t³−15t⁴+6t⁵, a symmetric bell-shaped speed curve). Trunk flexion is
 * coupled to squat depth, the shoulder girdle rides up with a high reach, the
 * head partly stabilises against trunk tilt, and the free arm counter-swings
 * against the stepping leg.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  /* Winter / Drillis & Contini, as fractions of stature H.
     Heights are from the floor; lengths are between joint centres. */
  var P = {
    shoulderY: 0.818, hipY: 0.530, kneeY: 0.285, ankleY: 0.039,
    upperArm: 0.186, foreArm: 0.146, hand: 0.108,
    thigh: 0.245, shank: 0.246, footLen: 0.152,
    shoulderHalf: 0.129, hipHalf: 0.096,
    headRx: 0.055, headRy: 0.066, neck: 0.052,
    mHAT: 0.678, mLeg: 0.161,
    crouchMax: 0.30,          /* how far the hips can drop before he is sitting */
    leanXMax: 0.34, leanZMax: 0.62
  };
  var TORSO = P.shoulderY - P.hipY;      /* 0.288 H */
  var LEG = P.thigh + P.shank;
  var ARM = P.upperArm + P.foreArm;

  var GLASS_Z = 0.15;      /* the panel, in front of his coronal plane */
  var CAM = 4.0;           /* weak perspective: camera distance, in H */
  var STEP_TIME = 0.36;    /* swing phase; stance is the other ~60% */
  var POLE_BRUSH = 0.80;   /* handle lengths, in dial radii */
  var POLE_CLOTH = 0.60;

  var PALETTES = [
    { shirt: '#5f77d4', shirtDark: '#4a60bd', trouser: '#4a5cb4', hair: '#4a3a2e', skin: '#d5a684', cap: '#42539f', tool: '#c6d451' },
    { shirt: '#4f8ad0', shirtDark: '#3d73b6', trouser: '#3f4f7a', hair: '#2e2620', skin: '#b9825f', cap: '#2f4e86', tool: '#dcc94e' },
    { shirt: '#5a86c8', shirtDark: '#4570b0', trouser: '#46538a', hair: '#3c2c22', skin: '#dcae88', cap: '#3a5ea0', tool: '#dcc94e' },
    { shirt: '#e08a46', shirtDark: '#c4713a', trouser: '#55607a', hair: '#3c2c22', skin: '#dcae88', cap: '#c96f34', tool: '#7fb6d8' },
    { shirt: '#63a878', shirtDark: '#4d8c62', trouser: '#4b5566', hair: '#231c18', skin: '#a9784f', cap: '#3f7a56', tool: '#e0d264' },
    { shirt: '#8b8fa6', shirtDark: '#71768d', trouser: '#565c72', hair: '#5a4632', skin: '#dbb191', cap: '#6a708a', tool: '#d9d25c' }
  ];

  function mo() { return C.motion == null ? 1 : C.motion; }

  /* ---- 3D helpers. x right, y down, z towards the viewer ---- */

  function v3(x, y, z) { return { x: x, y: y, z: z }; }
  function sub3(a, b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
  function add3(a, b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
  function scale3(a, k) { return v3(a.x * k, a.y * k, a.z * k); }
  function len3(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function norm3(a) { var l = len3(a) || 1e-6; return v3(a.x / l, a.y / l, a.z / l); }
  function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  function project(L, p) {
    var f = L.fig.H * CAM;
    var k = f / (f - p.z);
    return { x: L.cx + (p.x - L.cx) * k, y: L.cy + (p.y - L.cy) * k, k: k };
  }
  /* Screen point -> the 3D point on a given depth plane that projects to it. */
  function unproject(L, X, Y, z) {
    var f = L.fig.H * CAM;
    var k = f / (f - z);
    return v3(L.cx + (X - L.cx) / k, L.cy + (Y - L.cy) / k, z);
  }

  /* Two-bone IK with a pole vector: the joint is placed in the plane spanned by
     root->target and the pole, which is what decides that knees go forward and
     elbows go back rather than wherever the maths happens to land. */
  function solveLimb(root, target, l1, l2, pole) {
    var d = sub3(target, root);
    var dist = len3(d);
    var dmax = (l1 + l2) * 0.985;               /* never fully locked out */
    var dmin = Math.abs(l1 - l2) * 1.02 + 1e-5;
    var clamped = U.clamp(dist, dmin, dmax);
    var u = norm3(d);
    if (clamped < dist) target = add3(root, scale3(u, clamped));
    var a = (l1 * l1 - l2 * l2 + clamped * clamped) / (2 * clamped);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var p = sub3(pole, scale3(u, dot3(pole, u)));
    if (len3(p) < 1e-4) p = v3(0, 0, 1);
    p = norm3(p);
    return { joint: add3(root, add3(scale3(u, a), scale3(p, h))), end: target, strain: dist / (l1 + l2) };
  }

  function spring(st, key, target, k, c, dt) {
    var v = key + 'v';
    st[v] += (target - st[key]) * k * dt;
    st[v] *= Math.exp(-c * dt);
    st[key] += st[v] * dt;
  }

  function Figure(seed) {
    this.seed = seed;
    this.rng = U.mulberry32(seed);
    this.n = [];
    for (var i = 0; i < 9; i++) this.n.push(new U.Noise1D(seed + i * 7919 + 13, 256));
    this.palette = PALETTES[Math.floor(this.rng() * PALETTES.length)];
    this.s = {
      hipX: null, hipWant: 0, hipZ: 0, crouch: 0.04,
      leanX: 0, leanZ: 0.03, twist: 0, pelvisTwist: 0,
      headYaw: 0, headTilt: 0, shrug: 0, girdle: 0,
      hbx: 0, hby: 0, hbxv: 0, hbyv: 0,
      hcx: 0, hcy: 0, hcxv: 0, hcyv: 0,
      weight: 0, preferTo: null, ready: false
    };
    /* feet live in the ground plane: x across, z fore-and-aft */
    this.feet = [
      { side: -1, x: 0, z: 0.02, swing: 0, from: 0, to: 0, fromZ: 0, toZ: 0, lift: 0 },
      { side: 1, x: 0, z: -0.02, swing: 0, from: 0, to: 0, fromZ: 0, toZ: 0, lift: 0 }
    ];
    this.intent = null;
    this.intentKey = '';
    this.stepPhase = 0;
  }

  Figure.prototype.rollIntent = function (key) {
    var r = U.mulberry32(U.hash(this.seed, key));
    this.intentKey = key;
    this.intent = {
      stance: 0.055 + r() * 0.035,       /* half the gap between the feet */
      toeOut: 0.02 + r() * 0.03,
      weight: (r() * 2 - 1) * 0.5,
      crouchBias: r() * 0.05,
      headYaw: (r() * 2 - 1) * 0.45,
      headTilt: (r() * 2 - 1) * 0.18,
      shrug: r() * 0.4,
      brushRest: { x: -0.10 - r() * 0.05, y: 0.30 + r() * 0.08 },
      clothRest: { x: 0.10 + r() * 0.05, y: 0.29 + r() * 0.08 }
    };
  };

  /* Horizontal centre of mass, from Winter's segment masses. HAT (head, arms
     and trunk, 0.678) sits 63% of the way up from the hip; the legs (0.161
     each) sit 45% of the way from the hip down to the feet. Expanding that as
     an affine combination gives the form below, which is worth having in
     closed form: it can be inverted to ask "where may the hips be, for the
     centre of mass to stay over his feet?" — and standing up is exactly that
     question, asked every frame.
       com = 0.855 hip + 0.427 leanDX + 0.145 feetMid   (coefficients sum to 1) */
  var COM_HIP = P.mHAT * 0.37 + 2 * P.mLeg * 0.55 + P.mHAT * 0.63;
  var COM_LEAN = P.mHAT * 0.63;
  var COM_FEET = 2 * P.mLeg * 0.45;
  function comX(hipX, leanDX, feetMid) {
    return COM_HIP * hipX + COM_LEAN * leanDX + COM_FEET * feetMid;
  }

  Figure.prototype.update = function (dt, S, L, t) {
    var s = this.s, H = L.fig.H, F = L.fig.feetY, n = this.n, feet = this.feet;
    var key = S.m + '|' + S.phase;
    if (key !== this.intentKey) this.rollIntent(key);
    var I = this.intent;

    var brushSide = S.active.side === 'brush';
    var sideSign = brushSide ? -1 : 1;           /* -1 = viewer-left arm */
    var tight = S.active.tight, effort = S.active.effort;

    if (s.hipX === null) {
      s.hipX = s.hipWant = L.fig.baseX;
      feet[0].x = feet[1].x = s.hipX;
      feet[0].to = feet[1].to = s.hipX;
    }
    if (!s.ready) {
      s.hbx = S.active.pt.x; s.hby = S.active.pt.y;
      s.hcx = S.active.pt.x; s.hcy = S.active.pt.y;
      s.ready = true;
    }

    /* --- current frame of the body, from last frame's state --- */
    var pelvisY = F - (P.hipY - s.crouch * P.crouchMax) * H;
    var spine = this.spineFrame(L, s, pelvisY);
    var chest = spine.top;
    var shoulder = brushSide ? spine.shL : spine.shR;

    /* --- the work, placed on the panel in 3D --- */
    var tip = unproject(L, S.active.pt.x, S.active.pt.y, GLASS_Z * H);

    var anchor = v3(
      chest.x + spine.right.x * sideSign * 0.06 * H,
      chest.y + 0.17 * H,
      chest.z + spine.right.z * sideSign * 0.06 * H + 0.05 * H);
    var toWork = { x: U.lerp(anchor.x, tip.x, 0.12), y: U.lerp(anchor.y, tip.y, 0.10) };

    var kA = U.lerp(46, 300, tight), cA = U.lerp(10.5, 33, tight);
    var restB = {
      x: chest.x + spine.right.x * I.brushRest.x * H + n[0].fbm(t * 0.21) * 0.02 * H * mo(),
      y: chest.y + I.brushRest.y * H + n[1].fbm(t * 0.19) * 0.022 * H * mo()
    };
    var restC = {
      x: chest.x + spine.right.x * I.clothRest.x * H + n[2].fbm(t * 0.23 + 5) * 0.02 * H * mo(),
      y: chest.y + I.clothRest.y * H + n[3].fbm(t * 0.18 + 9) * 0.022 * H * mo()
    };
    /* Nobody swings a long handle one-handed when it matters: once he commits
       to a stroke the free hand comes onto the shaft behind the leading one. */
    var second = null;
    if (this.tool && effort > 0.66) {
      var sh = sub3(this.tool.base, this.tool.tip);
      var shl = len3(sh) || 1;
      var back = add3(this.tool.tip, scale3(sh, (shl + 0.20 * L.R) / shl));
      second = project(L, back);
    }
    this.twoHanded = !!second;
    if (brushSide) {
      spring(s, 'hbx', toWork.x, kA, cA, dt); spring(s, 'hby', toWork.y, kA, cA, dt);
      spring(s, 'hcx', second ? second.x : restC.x, second ? 90 : 30, second ? 17 : 9, dt);
      spring(s, 'hcy', second ? second.y : restC.y, second ? 90 : 30, second ? 17 : 9, dt);
    } else {
      spring(s, 'hcx', toWork.x, kA, cA, dt); spring(s, 'hcy', toWork.y, kA, cA, dt);
      spring(s, 'hbx', second ? second.x : restB.x, second ? 90 : 30, second ? 17 : 9, dt);
      spring(s, 'hby', second ? second.y : restB.y, second ? 90 : 30, second ? 17 : 9, dt);
    }

    /* Grip: he holds the shaft as far down as the work is away — choked right
       up close in, out at the very end of it to reach the twelve. */
    var poleLen = (brushSide ? POLE_BRUSH : POLE_CLOTH) * L.R;
    var hx = (brushSide ? s.hbx : s.hcx), hy = (brushSide ? s.hby : s.hcy);
    var handPlane = unproject(L, hx, hy, GLASS_Z * H * 0.55);
    var shaft = sub3(handPlane, tip);
    var shaftLen = len3(shaft);
    if (shaftLen < 1e-4) { shaft = v3(sideSign * 0.3, 0.9, -0.3); shaftLen = 1; }
    var grip = U.clamp(shaftLen, L.R * 0.10, poleLen);
    var wrist = add3(tip, scale3(norm3(shaft), grip));
    this.tool = { tip: tip, base: wrist, side: S.active.side, len: grip };

    /* --- what the body has to do to put the hand there --- */
    var reach = sub3(wrist, shoulder);
    var reachLen = len3(reach);
    var comfortable = ARM * H * U.lerp(0.90, 0.82, effort);
    var deficit = Math.max(0, reachLen - comfortable);
    var dir = norm3(reach);
    var needX = dir.x * deficit, needY = dir.y * deficit, needZ = dir.z * deficit;

    var torsoLen = TORSO * H;
    var leanXT = U.clamp(Math.asin(U.clamp(needX / torsoLen, -1, 1)), -P.leanXMax, P.leanXMax);
    /* A squat has to bring the trunk forward or he falls over backwards; that
       coupling is most of what makes a crouch read as a crouch. */
    var crouchT = U.clamp(needY / (P.crouchMax * H) + I.crouchBias, 0, 1);
    var leanZT = U.clamp(Math.asin(U.clamp(needZ / torsoLen, -1, 1)) + crouchT * 0.55, -0.1, P.leanZMax);

    s.leanX = U.damp(s.leanX, leanXT, U.lerp(3.2, 5.6, effort), dt);
    s.leanZ = U.damp(s.leanZ, leanZT, U.lerp(3.0, 5.4, effort), dt);
    s.crouch = U.damp(s.crouch, crouchT, U.lerp(3.4, 6.0, effort), dt);
    s.twist = U.damp(s.twist, U.clamp(needX / (torsoLen * 1.6), -0.5, 0.5) * (0.4 + 0.6 * effort), 3.2, dt);
    s.girdle = U.damp(s.girdle, U.clamp((shoulder.y - wrist.y) / (0.35 * H), 0, 1), 4, dt);
    s.shrug = U.damp(s.shrug, I.shrug * 0.4 + effort * 0.45, 3.6, dt);

    /* --- balance: keep the centre of mass inside the support polygon --- */
    /* People square up to what they are doing long before they have to — but
       they commit to a spot and stay there. Without the dead band he shuffles
       after the second hand all minute, which is worse than standing still. */
    var residual = needX - torsoLen * Math.sin(s.leanX);
    var preferRaw = U.clamp(L.cx + (tip.x - L.cx) * 0.40, L.cx - L.R * 0.30, L.cx + L.R * 0.30);
    if (s.preferTo === null || Math.abs(preferRaw - s.preferTo) > 0.26 * H) s.preferTo = preferRaw;
    /* Two positions, and the difference between them is what makes him walk:
       where he would like his hips to be, and where his feet actually allow
       them. The pelvis can lean a little past the support polygon and no
       further — so wanting to be elsewhere turns into pressure, and the
       pressure is what trips a step. */
    var wantHipX = U.lerp(s.hipWant + residual, s.preferTo, 0.38);
    s.hipWant = U.damp(s.hipWant, wantHipX, 2.2, dt);
    var feetMid = (feet[0].x + feet[1].x) * 0.5;
    var leanDX = spine.top.x - s.hipX;
    var left = Math.min(feet[0].x, feet[1].x), right = Math.max(feet[0].x, feet[1].x);
    var margin = 0.030 * H;
    var trial = s.hipWant;
    var com = comX(trial, leanDX, feetMid);
    if (com < left + margin) trial += (left + margin - com) / COM_HIP;
    else if (com > right - margin) trial -= (com - (right - margin)) / COM_HIP;
    s.hipX = trial;
    /* Idle weight shift from one leg to the other, as anyone standing does. */
    s.weight = U.damp(s.weight, (I.weight + n[4].fbm(t * 0.07, 2) * 0.7) * (1 - effort * 0.6), 1.3, dt);
    s.hipZ = U.damp(s.hipZ, U.clamp(needZ * 0.35, -0.05 * H, 0.10 * H), 2.4, dt);

    var comNow = comX(s.hipX, leanDX, feetMid);
    var swinging = feet[0].swing > 0 || feet[1].swing > 0;

    if (!swinging) {
      var want = null, which = null;
      if (comNow < left + margin * 0.5) { which = feet[0].x <= feet[1].x ? 0 : 1; want = comNow - I.stance * H; }
      else if (comNow > right - margin * 0.5) { which = feet[0].x >= feet[1].x ? 0 : 1; want = comNow + I.stance * H; }
      else {
        /* No emergency, but stand square to the work. Step whichever foot is
           furthest from where it ought to be — taking them in a fixed order
           makes the trailing foot step backwards and he never gets anywhere. */
        var bestErr = 0.155 * H;
        for (var q = 0; q < 2; q++) {
          var ideal = s.hipWant + feet[q].side * I.stance * H;
          var err = Math.abs(ideal - feet[q].x);
          if (err > bestErr) { bestErr = err; which = q; want = ideal; }
        }
      }
      if (which !== null) {
        var f2 = feet[which], other = feet[1 - which];
        /* Land it a natural stance away from the planted foot, on the correct
           side of it: feet that cross over or drift apart read as a glitch. */
        var gap = U.clamp((want - other.x) * f2.side, 0.075 * H, 0.215 * H);
        f2.swing = 1e-4;
        f2.from = f2.x; f2.fromZ = f2.z;
        f2.to = other.x + f2.side * gap;
        f2.toZ = f2.side * I.toeOut * H + U.clamp(s.hipZ, -0.04 * H, 0.06 * H);
      }
    }

    for (var i = 0; i < 2; i++) {
      var f = feet[i];
      if (f.swing > 0) {
        f.swing += dt / STEP_TIME;
        if (f.swing >= 1) {
          f.swing = 0; f.x = f.to; f.z = f.toZ; f.lift = 0;
        } else {
          var u = U.smootherstep(0, 1, f.swing);      /* minimum jerk */
          f.x = U.lerp(f.from, f.to, u);
          f.z = U.lerp(f.fromZ, f.toZ, u);
          f.lift = Math.sin(f.swing * Math.PI) * 0.055 * H;
        }
      }
    }
    this.stepPhase = feet[0].swing > 0 ? -feet[0].swing : (feet[1].swing > 0 ? feet[1].swing : 0);

    /* --- head: watches the work, but stabilises against the trunk --- */
    var headPos = v3(chest.x, chest.y - P.neck * H, chest.z);
    var glance = n[5].fbm(t * 0.13 + 3, 2);
    var away = (1 - effort) * U.smoothstep(0.45, 0.85, Math.abs(glance)) * Math.sign(glance) * mo();
    var yawT = U.clamp((tip.x - headPos.x) / (H * 0.45), -1, 1) * 0.7 + I.headYaw * 0.22 * (1 - effort) + away * 0.45;
    var tiltT = U.clamp((tip.y - headPos.y) / (H * 0.5), -1, 1) * 0.30 + I.headTilt * 0.35 * (1 - effort);
    s.headYaw = U.damp(s.headYaw, U.clamp(yawT, -1.1, 1.1), 4.2, dt);
    s.headTilt = U.damp(s.headTilt, U.clamp(tiltT, -0.42, 0.42), 3.8, dt);
    s.pelvisTwist = U.damp(s.pelvisTwist, -s.twist * 0.35 + this.stepPhase * 0.18, 4, dt);
  };

  /* The spine as three segments, flexing most at the bottom, so bending reads
     as a back rather than a hinge. */
  Figure.prototype.spineFrame = function (L, s, pelvisY) {
    var H = L.fig.H;
    var seg = TORSO * H / 3;
    var w = [0.46, 0.33, 0.21];
    var p = v3(s.hipX, pelvisY, s.hipZ);
    var pts = [p];
    var accX = 0, accZ = 0;
    for (var i = 0; i < 3; i++) {
      accX += s.leanX * w[i];
      accZ += s.leanZ * w[i];
      var dir = norm3(v3(Math.sin(accX), -Math.cos(accX) * Math.cos(accZ), Math.sin(accZ)));
      p = add3(p, scale3(dir, seg));
      pts.push(p);
    }
    var top = pts[3];
    var right = norm3(v3(Math.cos(s.leanX) * Math.cos(s.twist), Math.sin(s.leanX) * 0.5, Math.sin(s.twist)));
    var half = P.shoulderHalf * H;
    var lift = s.shrug * 0.018 * H;
    return {
      pts: pts, top: top, right: right,
      shL: v3(top.x - right.x * half, top.y - right.y * half - lift, top.z - right.z * half),
      shR: v3(top.x + right.x * half, top.y + right.y * half - lift, top.z + right.z * half)
    };
  };

  Figure.prototype.pose = function (L, t) {
    var s = this.s, n = this.n, H = L.fig.H, F = L.fig.feetY, feet = this.feet;
    var breath = Math.sin(t * 0.63) * 0.6 + n[6].at(t * 0.29) * 0.4;
    var sway = n[7].fbm(t * 0.11, 2) * mo();

    /* Hip height: as commanded, then clamped so no planted leg over-extends.
       That single constraint is what dips the hips over a wide stance. */
    var pelvisY = F - (P.hipY - s.crouch * P.crouchMax) * H + breath * 0.0022 * H + sway * 0.004 * H;
    var legMax = LEG * H * 0.985;
    for (var i = 0; i < 2; i++) {
      var ankY = F - (P.ankleY * H + feet[i].lift);
      var dx = (s.hipX + feet[i].side * P.hipHalf * H) - feet[i].x;
      var dz = s.hipZ - feet[i].z;
      var span = Math.sqrt(Math.max(0, legMax * legMax - dx * dx - dz * dz));
      pelvisY = Math.max(pelvisY, ankY - span);
    }

    var spine = this.spineFrame(L, s, pelvisY);
    var pelvis = spine.pts[0];

    /* Pelvic obliquity: the unloaded side drops, whether that is because the
       leg is swinging or because he has simply put his weight on one foot. */
    var obl = this.stepPhase * 0.035 * H + s.weight * 0.016 * H;
    var pr = s.pelvisTwist;
    var hipHalf = P.hipHalf * H;
    var hipL = v3(pelvis.x - hipHalf * Math.cos(pr), pelvis.y - obl, pelvis.z - hipHalf * Math.sin(pr));
    var hipR = v3(pelvis.x + hipHalf * Math.cos(pr), pelvis.y + obl, pelvis.z + hipHalf * Math.sin(pr));

    var ankL = v3(feet[0].x, F - P.ankleY * H - feet[0].lift, feet[0].z);
    var ankR = v3(feet[1].x, F - P.ankleY * H - feet[1].lift, feet[1].z);

    /* knees go forward and a little out; deeper squat, more abduction */
    var abd = 0.22 + s.crouch * 0.45;
    var kneeL = solveLimb(hipL, ankL, P.thigh * H, P.shank * H, norm3(v3(-abd, 0, 1)));
    var kneeR = solveLimb(hipR, ankR, P.thigh * H, P.shank * H, norm3(v3(abd, 0, 1)));

    var toolLeft = this.tool && this.tool.side === 'brush';
    var handB = this.tool && toolLeft ? this.tool.base : v3(s.hbx, s.hby, 0.06 * H);
    var handC = this.tool && !toolLeft ? this.tool.base : v3(s.hcx, s.hcy, 0.06 * H);
    /* the free arm counter-swings against the stepping leg */
    var swingOff = this.stepPhase * 0.05 * H;
    if (toolLeft) handC = v3(handC.x, handC.y, handC.z + swingOff);
    else handB = v3(handB.x, handB.y, handB.z - swingOff);

    /* elbows fall back and down, and a little outboard of the shoulder */
    var elbL = solveLimb(spine.shL, handB, P.upperArm * H, P.foreArm * H, norm3(v3(-0.45, 0.6, -1)));
    var elbR = solveLimb(spine.shR, handC, P.upperArm * H, P.foreArm * H, norm3(v3(0.45, 0.6, -1)));

    /* head: partly stabilised — trunk tilt is not passed straight through */
    var neck = v3(spine.top.x, spine.top.y - P.neck * H * 0.4, spine.top.z);
    var headAng = s.leanX * 0.35 + s.headTilt * 0.5 + n[8].fbm(t * 0.24) * 0.02 * mo();
    var head = v3(
      neck.x + Math.sin(headAng) * P.headRy * H * 1.5 + spine.right.x * s.headYaw * P.headRx * H * 0.5,
      neck.y - Math.cos(headAng) * P.headRy * H * 1.5,
      neck.z + s.leanZ * 0.2 * H);

    var pr2 = project.bind(null, L);
    return {
      H: H, feetY: F,
      pelvis: pr2(pelvis), spine: spine.pts.map(pr2),
      shL: pr2(spine.shL), shR: pr2(spine.shR),
      hipL: pr2(hipL), hipR: pr2(hipR),
      kneeL: pr2(kneeL.joint), kneeR: pr2(kneeR.joint),
      ankL: pr2(ankL), ankR: pr2(ankR),
      elbL: pr2(elbL.joint), elbR: pr2(elbR.joint),
      handB: pr2(handB), handC: pr2(handC),
      neck: pr2(neck),
      head: { p: pr2(head), ang: headAng, yaw: s.headYaw, rx: P.headRx * H, ry: P.headRy * H, k: pr2(head).k },
      tool: this.tool ? { tip: pr2(this.tool.tip), base: pr2(this.tool.base), side: this.tool.side } : null,
      toolLeft: toolLeft, crouch: s.crouch
    };
  };

  function limb(ctx, a, b, c, w1, w2, color) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = w1 * ((a.k + b.k) * 0.5);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = w2 * ((b.k + c.k) * 0.5);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  }

  /* Depth cue: the further from the panel, the less survives the diffusion. */
  Figure.prototype.fade = function (far, L) {
    far.save();
    far.globalCompositeOperation = 'destination-in';
    var g = far.createLinearGradient(0, L.cy - L.R * 0.2, 0, L.fig.feetY);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.74)');
    g.addColorStop(1, 'rgba(0,0,0,0.54)');
    far.fillStyle = g;
    far.fillRect(0, 0, L.w, L.h);
    far.restore();
  };

  Figure.prototype.draw = function (far, near, p, L) {
    var H = p.H, pal = this.palette;

    far.save();
    far.globalAlpha = 0.45;
    far.fillStyle = '#6f727a';
    far.beginPath();
    far.ellipse((p.ankL.x + p.ankR.x) * 0.5, p.feetY - 0.004 * H,
      Math.abs(p.ankR.x - p.ankL.x) * 0.5 + 0.10 * H, 0.022 * H, 0, 0, TAU);
    far.fill();
    far.restore();

    var backLeg = p.ankL.y < p.ankR.y ? 'L' : 'R';
    var drawLeg = function (hip, knee, ank, alpha) {
      far.globalAlpha = alpha;
      limb(far, hip, knee, ank, 0.098 * H, 0.078 * H, pal.trouser);
      far.fillStyle = '#2f3237';
      far.beginPath();
      far.ellipse(ank.x, ank.y + 0.020 * H, 0.052 * H * ank.k, 0.021 * H * ank.k, 0, 0, TAU);
      far.fill();
    };
    if (backLeg === 'L') {
      drawLeg(p.hipL, p.kneeL, p.ankL, 0.84);
      drawLeg(p.hipR, p.kneeR, p.ankR, 1);
    } else {
      drawLeg(p.hipR, p.kneeR, p.ankR, 0.84);
      drawLeg(p.hipL, p.kneeL, p.ankL, 1);
    }
    far.globalAlpha = 1;

    /* torso, built on the spine curve so bending shows in the silhouette */
    var g = far.createLinearGradient(p.spine[3].x, p.spine[3].y, p.spine[0].x, p.spine[0].y);
    g.addColorStop(0, pal.shirt);
    g.addColorStop(1, pal.shirtDark);
    far.fillStyle = g;
    far.beginPath();
    far.moveTo(p.hipL.x, p.hipL.y);
    far.quadraticCurveTo(p.spine[1].x - 0.075 * H, p.spine[1].y, p.shL.x, p.shL.y);
    far.quadraticCurveTo(p.spine[3].x, p.spine[3].y - 0.030 * H, p.shR.x, p.shR.y);
    far.quadraticCurveTo(p.spine[1].x + 0.075 * H, p.spine[1].y, p.hipR.x, p.hipR.y);
    far.quadraticCurveTo(p.pelvis.x, p.pelvis.y + 0.035 * H, p.hipL.x, p.hipL.y);
    far.closePath();
    far.fill();

    far.strokeStyle = pal.skin;
    far.lineWidth = 0.046 * H;
    far.lineCap = 'round';
    far.beginPath();
    far.moveTo(p.neck.x, p.neck.y);
    far.lineTo(p.head.p.x, p.head.p.y + p.head.ry * 0.5);
    far.stroke();

    far.save();
    far.translate(p.head.p.x, p.head.p.y);
    far.rotate(p.head.ang);
    far.scale(p.head.k, p.head.k);
    far.fillStyle = pal.skin;
    far.beginPath();
    far.ellipse(p.head.yaw * p.head.rx * 0.16, p.head.ry * 0.06, p.head.rx * 0.96, p.head.ry * 0.94, 0, 0, TAU);
    far.fill();
    far.fillStyle = pal.cap;
    far.beginPath();
    far.ellipse(p.head.yaw * p.head.rx * 0.18, -p.head.ry * 0.44, p.head.rx * 1.10, p.head.ry * 0.62, 0, 0, TAU);
    far.fill();
    far.beginPath();
    far.ellipse(p.head.yaw * p.head.rx * 1.05, -p.head.ry * 0.28, p.head.rx * 0.70, p.head.ry * 0.22,
      p.head.yaw * 0.25, 0, TAU);
    far.fill();
    far.restore();

    var idle = p.toolLeft
      ? [p.shR, p.elbR, p.handC]
      : [p.shL, p.elbL, p.handB];
    far.globalAlpha = 0.92;
    limb(far, idle[0], idle[1], idle[2], 0.066 * H, 0.052 * H, pal.shirt);
    far.fillStyle = pal.skin;
    far.beginPath();
    far.arc(idle[2].x, idle[2].y, 0.028 * H * idle[2].k, 0, TAU);
    far.fill();
    far.globalAlpha = 1;

    var act = p.toolLeft ? [p.shL, p.elbL, p.handB] : [p.shR, p.elbR, p.handC];
    limb(near, act[0], act[1], act[2], 0.064 * H, 0.051 * H, pal.shirt);

    if (p.tool) {
      var tp = p.tool.tip, bp = p.tool.base;
      var tdx = bp.x - tp.x, tdy = bp.y - tp.y;
      var tdl = Math.hypot(tdx, tdy) || 1e-6;
      var ux = tdx / tdl, uy = tdy / tdl;
      near.save();
      near.lineCap = 'round';
      near.strokeStyle = '#6d5b45';
      near.lineWidth = 0.020 * H;
      near.beginPath();
      near.moveTo(tp.x, tp.y);
      near.lineTo(bp.x + ux * 0.05 * H, bp.y + uy * 0.05 * H);
      near.stroke();
      if (p.tool.side === 'brush') {
        near.strokeStyle = '#26242a';
        near.lineWidth = 0.030 * H;
        near.beginPath();
        near.moveTo(tp.x, tp.y);
        near.lineTo(tp.x + ux * 0.055 * H, tp.y + uy * 0.055 * H);
        near.stroke();
      } else {
        near.fillStyle = pal.tool;
        near.translate(tp.x + ux * 0.030 * H, tp.y + uy * 0.030 * H);
        near.rotate(Math.atan2(-uy, -ux));
        near.beginPath();
        near.ellipse(0, 0, 0.075 * H, 0.055 * H, 0, 0, TAU);
        near.fill();
      }
      near.restore();
    }
    near.fillStyle = pal.skin;
    near.beginPath();
    near.arc(act[2].x, act[2].y, 0.029 * H * act[2].k, 0, TAU);
    near.fill();
  };

  C.Figure = Figure;
  C.PALETTES = PALETTES;
  C.PROPORTIONS = P;
})(typeof window !== 'undefined' ? window : globalThis);
