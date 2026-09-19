/* The person on the panel.
 *
 * A small biomechanical rig. Four things make it behave like a body rather
 * than a puppet:
 *
 * 1. REAL PROPORTIONS. Winter's anthropometric table (after Drillis &
 *    Contini), as fractions of stature: shoulder 0.818, hip 0.530, knee 0.285,
 *    ankle 0.039; upper arm 0.186, forearm 0.146, thigh 0.245, shank 0.246.
 *    Joint heights and segment lengths agree with each other.
 *
 * 2. SOLVED IN 3D. The panel is a plane in front of him, so reaching for it is
 *    reaching towards the camera. Limbs use a pole vector — knees forward, out
 *    of the screen; elbows back and down — then a weak perspective projection.
 *    A deep squat foreshortens instead of splaying sideways.
 *
 * 3. HE HAS TO STAY UP. The centre of mass, from Winter's segment masses,
 *    in a closed form that inverts: the pelvis is clamped every frame to keep
 *    it over his feet. A second, unclamped "where he wants to be" drives
 *    stepping, and the gap between wanting and being allowed trips a step.
 *
 * 4. HE MOVES BEFORE HE MOVES. Bodies are not reactive: postural muscles fire
 *    50-100 ms ahead of the limb they serve, gaze leads the hand by 100-200 ms,
 *    and weight transfers onto the stance foot before the other one leaves the
 *    ground. The schedule here is a pure function of time, so the rig can
 *    simply ask what the hand will be doing in 200 ms and posture for that
 *    instead of for the present. Everything postural is then driven by
 *    second-order springs rather than exponential damping, so the body
 *    overshoots and settles the way mass does.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  var P = {
    shoulderY: 0.818, hipY: 0.530, kneeY: 0.285, ankleY: 0.039,
    upperArm: 0.186, foreArm: 0.146, hand: 0.108,
    thigh: 0.245, shank: 0.246, footLen: 0.152,
    shoulderHalf: 0.129, hipHalf: 0.096,
    headRx: 0.055, headRy: 0.066, neck: 0.052,
    mHAT: 0.678, mLeg: 0.161,
    crouchMax: 0.30, leanXMax: 0.34, leanZMax: 0.62,
    /* joint limits, as the shortest root-to-end distance each joint allows:
       elbow to ~145 deg of flexion, knee to ~140 */
    elbowMin: 0.107, kneeMin: 0.168
  };
  var TORSO = P.shoulderY - P.hipY;
  var LEG = P.thigh + P.shank;
  var ARM = P.upperArm + P.foreArm;

  var GLASS_Z = 0.15;
  var CAM = 4.0;
  var PRELOAD = 0.15;      /* weight transfer before the foot leaves: an APA */
  var SWING = 0.34;        /* stance is the other ~60% of the cycle */
  var LOCK = 0.12;         /* double support before another step may start */
  var REGRIP = 0.20;
  var POLE_BRUSH = 0.80;
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
  function unproject(L, X, Y, z) {
    var f = L.fig.H * CAM;
    var k = f / (f - z);
    return v3(L.cx + (X - L.cx) / k, L.cy + (Y - L.cy) / k, z);
  }

  function solveLimb(root, target, l1, l2, pole, dmin) {
    var d = sub3(target, root);
    var dist = len3(d);
    var dmax = (l1 + l2) * 0.985;
    var lo = Math.max(dmin || 0, Math.abs(l1 - l2) * 1.02 + 1e-5);
    var clamped = U.clamp(dist, lo, dmax);
    var u = norm3(d);
    if (Math.abs(clamped - dist) > 1e-6) target = add3(root, scale3(u, clamped));
    var a = (l1 * l1 - l2 * l2 + clamped * clamped) / (2 * clamped);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var p = sub3(pole, scale3(u, dot3(pole, u)));
    if (len3(p) < 1e-4) p = v3(0, 0, 1);
    p = norm3(p);
    return { joint: add3(root, add3(scale3(u, a), scale3(p, h))), end: target };
  }

  /* Second-order spring. Slightly underdamped (zeta < 1) so the body
     overshoots and settles instead of sliding to a stop — that arrival is
     most of what separates flesh from a servo. */
  function sp(st, key, target, omega, zeta, dt) {
    var v = key + 'V';
    if (st[v] === undefined) st[v] = 0;
    st[v] += (omega * omega * (target - st[key]) - 2 * zeta * omega * st[v]) * dt;
    st[key] += st[v] * dt;
  }

  /* Winter's masses, expanded to an affine form that can be inverted:
       com = 0.855 hip + 0.427 leanDX + 0.145 feetMid   (coefficients sum to 1) */
  var COM_HIP = P.mHAT * 0.37 + 2 * P.mLeg * 0.55 + P.mHAT * 0.63;
  var COM_LEAN = P.mHAT * 0.63;
  var COM_FEET = 2 * P.mLeg * 0.45;
  function comX(hipX, leanDX, feetMid) {
    return COM_HIP * hipX + COM_LEAN * leanDX + COM_FEET * feetMid;
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
      headYaw: 0, headTilt: 0, gazeX: 0, gazeY: 0, shrug: 0, girdle: 0,
      hbx: 0, hby: 0, hbxv: 0, hbyv: 0,
      hcx: 0, hcy: 0, hcxv: 0, hcyv: 0,
      weight: 0, weightCmd: 0, preferTo: null,
      grip: 0, gripFrom: 0, gripTo: 0, gripT: 1,
      exert: 0, breath: 0, lock: 0, ready: false
    };
    this.feet = [
      { side: -1, x: 0, z: 0.02, state: 'plant', timer: 0, from: 0, to: 0, fromZ: 0, toZ: 0, lift: 0, roll: 0 },
      { side: 1, x: 0, z: -0.02, state: 'plant', timer: 0, from: 0, to: 0, fromZ: 0, toZ: 0, lift: 0, roll: 0 }
    ];
    this.lag = null;
    this.intent = null;
    this.intentKey = '';
    this.stepPhase = 0;
    this.dt = 1 / 60;
  }

  Figure.prototype.rollIntent = function (key) {
    var r = U.mulberry32(U.hash(this.seed, key));
    this.intentKey = key;
    this.intent = {
      stance: 0.055 + r() * 0.035,
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

  /* S is now; SA is the same schedule read a couple of hundred milliseconds
     into the future. The arm serves S. Everything postural serves SA. */
  Figure.prototype.update = function (dt, S, L, t, SA) {
    var s = this.s, H = L.fig.H, F = L.fig.feetY, n = this.n, feet = this.feet;
    this.dt = dt;
    var key = S.m + '|' + S.phase;
    if (key !== this.intentKey) this.rollIntent(key);
    var I = this.intent;

    var brushSide = S.active.side === 'brush';
    var sideSign = brushSide ? -1 : 1;
    var tight = S.active.tight;
    var effort = Math.max(S.active.effort, SA ? SA.active.effort * 0.9 : 0);

    if (s.hipX === null) {
      s.hipX = s.hipWant = L.fig.baseX;
      feet[0].x = feet[1].x = s.hipX;
    }
    if (!s.ready) {
      s.hbx = S.active.pt.x; s.hby = S.active.pt.y;
      s.hcx = S.active.pt.x; s.hcy = S.active.pt.y;
      s.ready = true;
    }

    var pelvisY = F - (P.hipY - s.crouch * P.crouchMax) * H;
    var spine = this.spineFrame(L, s, pelvisY);
    var chest = spine.top;
    var shoulder = brushSide ? spine.shL : spine.shR;

    var tip = unproject(L, S.active.pt.x, S.active.pt.y, GLASS_Z * H);
    /* Posture for where the work is going, not where it is. Across a change of
       hands there is nothing sensible to anticipate, so fall back to now. */
    var aheadPt = (SA && SA.active.side === S.active.side) ? SA.active.pt : S.active.pt;
    var tipAhead = unproject(L, aheadPt.x, aheadPt.y, GLASS_Z * H);

    var anchor = v3(
      chest.x + spine.right.x * sideSign * 0.06 * H,
      chest.y + 0.17 * H,
      chest.z + spine.right.z * sideSign * 0.06 * H + 0.05 * H);
    var toWork = { x: U.lerp(anchor.x, tip.x, 0.12), y: U.lerp(anchor.y, tip.y, 0.10) };

    /* --- the tool, and a hand that re-grips in discrete moves --- */
    var poleLen = (brushSide ? POLE_BRUSH : POLE_CLOTH) * L.R;
    var hx = (brushSide ? s.hbx : s.hcx), hy = (brushSide ? s.hby : s.hcy);
    var handPlane = unproject(L, hx, hy, GLASS_Z * H * 0.55);
    var shaft = sub3(handPlane, tip);
    var shaftLen = len3(shaft);
    if (shaftLen < 1e-4) { shaft = v3(sideSign * 0.3, 0.9, -0.3); shaftLen = 1; }
    var gripWant = U.clamp(shaftLen, L.R * 0.10, poleLen);
    if (!s.grip) { s.grip = s.gripTo = gripWant; }
    /* A hand does not slide continuously along a shaft: it holds, lets go, and
       takes a new hold. Only re-grip once the work has really moved. */
    if (s.gripT >= 1 && Math.abs(gripWant - s.gripTo) > L.R * 0.13) {
      s.gripFrom = s.grip; s.gripTo = gripWant; s.gripT = 0;
    }
    if (s.gripT < 1) {
      s.gripT = Math.min(1, s.gripT + dt / REGRIP);
      s.grip = U.lerp(s.gripFrom, s.gripTo, U.smootherstep(0, 1, s.gripT));
    }
    this.regrip = s.gripT < 1 ? Math.sin(s.gripT * Math.PI) : 0;
    var wrist = add3(tip, scale3(norm3(shaft), s.grip));
    this.tool = { tip: tip, base: wrist, side: S.active.side, len: s.grip };

    /* --- hands --- */
    var second = null;
    if (effort > 0.66) {
      var back = add3(tip, scale3(norm3(shaft), s.grip + 0.20 * L.R));
      second = project(L, back);
    }
    this.twoHanded = !!second;
    var kA = U.lerp(46, 300, tight), cA = U.lerp(10.5, 33, tight);
    var restB = {
      x: chest.x + spine.right.x * I.brushRest.x * H + n[0].fbm(t * 0.21) * 0.02 * H * mo(),
      y: chest.y + I.brushRest.y * H + n[1].fbm(t * 0.19) * 0.022 * H * mo()
    };
    var restC = {
      x: chest.x + spine.right.x * I.clothRest.x * H + n[2].fbm(t * 0.23 + 5) * 0.02 * H * mo(),
      y: chest.y + I.clothRest.y * H + n[3].fbm(t * 0.18 + 9) * 0.022 * H * mo()
    };
    function hand(kx, ky, target, k, c) {
      s[kx + 'v'] += (target.x - s[kx]) * k * dt; s[kx + 'v'] *= Math.exp(-c * dt); s[kx] += s[kx + 'v'] * dt;
      s[ky + 'v'] += (target.y - s[ky]) * k * dt; s[ky + 'v'] *= Math.exp(-c * dt); s[ky] += s[ky + 'v'] * dt;
    }
    if (brushSide) {
      hand('hbx', 'hby', toWork, kA, cA);
      hand('hcx', 'hcy', second || restC, second ? 90 : 30, second ? 17 : 9);
    } else {
      hand('hcx', 'hcy', toWork, kA, cA);
      hand('hbx', 'hby', second || restB, second ? 90 : 30, second ? 17 : 9);
    }

    /* --- what the body must do, aimed at the future hand --- */
    var wristAhead = add3(tipAhead, scale3(norm3(sub3(wrist, tip)), s.grip));
    var reach = sub3(wristAhead, shoulder);
    var reachLen = len3(reach);
    var comfortable = ARM * H * U.lerp(0.90, 0.82, effort);
    var deficit = Math.max(0, reachLen - comfortable);
    var dir = norm3(reach);
    var needX = dir.x * deficit, needY = dir.y * deficit, needZ = dir.z * deficit;

    var torsoLen = TORSO * H;
    var leanXT = U.clamp(Math.asin(U.clamp(needX / torsoLen, -1, 1)), -P.leanXMax, P.leanXMax);
    var crouchT = U.clamp(needY / (P.crouchMax * H) + I.crouchBias, 0, 1);
    var leanZT = U.clamp(Math.asin(U.clamp(needZ / torsoLen, -1, 1)) + crouchT * 0.55, -0.1, P.leanZMax);

    var fast = U.lerp(7.0, 10.5, effort);
    sp(s, 'leanX', leanXT, fast, 0.72, dt);
    sp(s, 'leanZ', leanZT, fast * 0.92, 0.75, dt);
    sp(s, 'crouch', crouchT, fast * 0.85, 0.92, dt);   /* barely overshoots: a bobbing pelvis reads as floating */
    sp(s, 'twist', U.clamp(needX / (torsoLen * 1.6), -0.5, 0.5) * (0.4 + 0.6 * effort), 7.5, 0.7, dt);
    sp(s, 'girdle', U.clamp((shoulder.y - wristAhead.y) / (0.35 * H), 0, 1), 8, 0.8, dt);
    sp(s, 'shrug', I.shrug * 0.4 + effort * 0.45, 7, 0.8, dt);

    /* --- balance, and the stepping it forces --- */
    var residual = needX - torsoLen * Math.sin(s.leanX);
    var preferRaw = U.clamp(L.cx + (tipAhead.x - L.cx) * 0.40, L.cx - L.R * 0.30, L.cx + L.R * 0.30);
    if (s.preferTo === null || Math.abs(preferRaw - s.preferTo) > 0.26 * H) s.preferTo = preferRaw;
    sp(s, 'hipWant', U.lerp(s.hipWant + residual, s.preferTo, 0.38), 5.2, 0.8, dt);

    /* Weight goes onto the stance foot before the other one is allowed to
       leave the ground, which is the anticipatory adjustment people make and
       never notice making. */
    s.weight = U.damp(s.weight, s.weightCmd !== 0 ? s.weightCmd
      : (I.weight + n[4].fbm(t * 0.07, 2) * 0.7) * (1 - effort * 0.6) * 0.5,
      s.weightCmd !== 0 ? 7 : 1.3, dt);

    var feetMid = (feet[0].x + feet[1].x) * 0.5;
    var leanDX = spine.top.x - s.hipX;
    var left = Math.min(feet[0].x, feet[1].x), right = Math.max(feet[0].x, feet[1].x);
    var margin = 0.030 * H;
    var trial = s.hipWant + s.weight * 0.030 * H;
    var com = comX(trial, leanDX, feetMid);
    if (com < left + margin) trial += (left + margin - com) / COM_HIP;
    else if (com > right - margin) trial -= (com - (right - margin)) / COM_HIP;
    s.hipX = trial;
    sp(s, 'hipZ', U.clamp(needZ * 0.35, -0.05 * H, 0.10 * H), 5, 0.85, dt);

    var comNow = comX(s.hipX, leanDX, feetMid);
    var busy = feet[0].state !== 'plant' || feet[1].state !== 'plant';
    s.lock = Math.max(0, s.lock - dt);

    if (!busy && s.lock <= 0) {
      var want = null, which = null;
      if (comNow < left + margin * 0.5) { which = feet[0].x <= feet[1].x ? 0 : 1; want = comNow - I.stance * H; }
      else if (comNow > right - margin * 0.5) { which = feet[0].x >= feet[1].x ? 0 : 1; want = comNow + I.stance * H; }
      else {
        var bestErr = 0.155 * H;
        for (var q = 0; q < 2; q++) {
          var ideal = s.hipWant + feet[q].side * I.stance * H;
          var err = Math.abs(ideal - feet[q].x);
          if (err > bestErr) { bestErr = err; which = q; want = ideal; }
        }
      }
      if (which !== null) {
        var f2 = feet[which], other = feet[1 - which];
        var gap = U.clamp((want - other.x) * f2.side, 0.075 * H, 0.215 * H);
        f2.state = 'preload';
        f2.timer = 0;
        f2.from = f2.x; f2.fromZ = f2.z;
        f2.to = other.x + f2.side * gap;
        f2.toZ = f2.side * I.toeOut * H + U.clamp(s.hipZ, -0.04 * H, 0.06 * H);
        s.weightCmd = -f2.side;              /* load the other foot first */
      }
    }

    for (var i = 0; i < 2; i++) {
      var f = feet[i];
      if (f.state === 'preload') {
        f.timer += dt;
        f.roll = U.lerp(f.roll, 0.6, Math.min(1, dt * 8));   /* heel comes up */
        if (f.timer >= PRELOAD) { f.state = 'swing'; f.timer = 0; }
      } else if (f.state === 'swing') {
        f.timer += dt;
        var u = U.clamp(f.timer / SWING, 0, 1);
        var m = U.smootherstep(0, 1, u);                      /* minimum jerk */
        f.x = U.lerp(f.from, f.to, m);
        f.z = U.lerp(f.fromZ, f.toZ, m) + Math.sin(u * Math.PI) * 0.035 * H;
        f.lift = Math.sin(u * Math.PI) * 0.055 * H;
        f.roll = U.lerp(0.9, -0.8, m);                        /* toe off, heel first on landing */
        if (u >= 1) {
          f.state = 'plant'; f.timer = 0; f.x = f.to; f.z = f.toZ; f.lift = 0;
          s.weightCmd = 0; s.lock = LOCK;
        }
      } else {
        f.roll = U.damp(f.roll, 0, 6, dt);
      }
    }
    this.stepPhase = feet[0].state === 'swing' ? -feet[0].timer / SWING
      : (feet[1].state === 'swing' ? feet[1].timer / SWING : 0);

    /* --- gaze leads the hand, and moves in discrete re-aims --- */
    var headPos = v3(chest.x, chest.y - P.neck * H, chest.z);
    var glance = n[5].fbm(t * 0.13 + 3, 2);
    var away = (1 - effort) * U.smoothstep(0.45, 0.85, Math.abs(glance)) * Math.sign(glance) * mo();
    var gx = tipAhead.x + away * 0.25 * H, gy = tipAhead.y;
    if (Math.hypot(gx - s.gazeX, gy - s.gazeY) > 0.09 * H) { s.gazeX = gx; s.gazeY = gy; }
    var yawT = U.clamp((s.gazeX - headPos.x) / (H * 0.45), -1, 1) * 0.7 + I.headYaw * 0.22 * (1 - effort);
    var tiltT = U.clamp((s.gazeY - headPos.y) / (H * 0.5), -1, 1) * 0.30 + I.headTilt * 0.35 * (1 - effort);
    sp(s, 'headYaw', U.clamp(yawT, -1.1, 1.1), 13, 0.85, dt);
    sp(s, 'headTilt', U.clamp(tiltT, -0.42, 0.42), 11, 0.85, dt);
    s.pelvisTwist = U.damp(s.pelvisTwist, -s.twist * 0.35 + this.stepPhase * 0.18, 4, dt);

    /* breathing: harder work, faster and deeper, and it stays up afterwards */
    s.exert = U.damp(s.exert, effort, effort > s.exert ? 1.2 : 0.35, dt);
    s.breath += dt * (0.62 + s.exert * 0.55) * TAU;
  };

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
    var s = this.s, n = this.n, H = L.fig.H, F = L.fig.feetY, feet = this.feet, dt = this.dt;
    var breath = Math.sin(s.breath) * (0.6 + s.exert * 0.9);
    var sway = n[7].fbm(t * 0.11, 2) * mo();

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

    /* the unloaded side drops, whether from a swinging leg or just weight */
    var obl = this.stepPhase * 0.030 * H - s.weight * 0.016 * H;
    var pr = s.pelvisTwist;
    var hipHalf = P.hipHalf * H;
    var hipL = v3(pelvis.x - hipHalf * Math.cos(pr), pelvis.y - obl, pelvis.z - hipHalf * Math.sin(pr));
    var hipR = v3(pelvis.x + hipHalf * Math.cos(pr), pelvis.y + obl, pelvis.z + hipHalf * Math.sin(pr));

    var ankL = v3(feet[0].x, F - P.ankleY * H - feet[0].lift, feet[0].z);
    var ankR = v3(feet[1].x, F - P.ankleY * H - feet[1].lift, feet[1].z);

    var abd = 0.22 + s.crouch * 0.45;
    var kneeL = solveLimb(hipL, ankL, P.thigh * H, P.shank * H, norm3(v3(-abd, 0, 1)), P.kneeMin * H);
    var kneeR = solveLimb(hipR, ankR, P.thigh * H, P.shank * H, norm3(v3(abd, 0, 1)), P.kneeMin * H);

    var toolLeft = this.tool && this.tool.side === 'brush';
    var handB = this.tool && toolLeft ? this.tool.base : v3(s.hbx, s.hby, 0.06 * H);
    var handC = this.tool && !toolLeft ? this.tool.base : v3(s.hcx, s.hcy, 0.06 * H);
    var swingOff = this.stepPhase * 0.05 * H;
    if (toolLeft) handC = v3(handC.x, handC.y, handC.z + swingOff);
    else handB = v3(handB.x, handB.y, handB.z - swingOff);

    /* the shoulder girdle rides up with a high reach — scapulohumeral rhythm
       contributes about a third of the elevation */
    var shL = v3(spine.shL.x, spine.shL.y - (toolLeft ? s.girdle * 0.33 * 0.09 * H : 0), spine.shL.z);
    var shR = v3(spine.shR.x, spine.shR.y - (!toolLeft ? s.girdle * 0.33 * 0.09 * H : 0), spine.shR.z);

    var elbL = solveLimb(shL, handB, P.upperArm * H, P.foreArm * H, norm3(v3(-0.45, 0.6, -1)), P.elbowMin * H);
    var elbR = solveLimb(shR, handC, P.upperArm * H, P.foreArm * H, norm3(v3(0.45, 0.6, -1)), P.elbowMin * H);

    var neck = v3(spine.top.x, spine.top.y - P.neck * H * 0.4, spine.top.z);
    var headAng = s.leanX * 0.35 + s.headTilt * 0.5 + n[8].fbm(t * 0.24) * 0.02 * mo();
    var head = v3(
      neck.x + Math.sin(headAng) * P.headRy * H * 1.5 + spine.right.x * s.headYaw * P.headRx * H * 0.5,
      neck.y - Math.cos(headAng) * P.headRy * H * 1.5,
      neck.z + s.leanZ * 0.2 * H);

    var pr2 = project.bind(null, L);
    var out = {
      H: H, feetY: F,
      pelvis: pr2(pelvis), spine: spine.pts.map(pr2),
      shL: pr2(shL), shR: pr2(shR),
      hipL: pr2(hipL), hipR: pr2(hipR),
      kneeL: pr2(kneeL.joint), kneeR: pr2(kneeR.joint),
      ankL: pr2(ankL), ankR: pr2(ankR),
      elbL: pr2(elbL.joint), elbR: pr2(elbR.joint),
      handB: pr2(handB), handC: pr2(handC),
      neck: pr2(neck),
      head: { p: pr2(head), ang: headAng, yaw: s.headYaw, rx: P.headRx * H, ry: P.headRy * H, k: pr2(head).k },
      tool: this.tool ? { tip: pr2(this.tool.tip), base: pr2(this.tool.base), side: this.tool.side } : null,
      toolLeft: toolLeft, crouch: s.crouch, regrip: this.regrip || 0,
      rollL: feet[0].roll, rollR: feet[1].roll
    };

    /* Cloth trails the limb it hangs off. One frame of lag on the joints used
       for the silhouette is enough to stop the clothing looking painted on. */
    if (!this.lag) {
      this.lag = { kL: { x: out.kneeL.x, y: out.kneeL.y }, kR: { x: out.kneeR.x, y: out.kneeR.y },
        eL: { x: out.elbL.x, y: out.elbL.y }, eR: { x: out.elbR.x, y: out.elbR.y } };
    }
    var lam = 22;
    var pairs = [['kL', 'kneeL'], ['kR', 'kneeR'], ['eL', 'elbL'], ['eR', 'elbR']];
    for (var j = 0; j < pairs.length; j++) {
      var lg = this.lag[pairs[j][0]], cur = out[pairs[j][1]];
      lg.x = U.damp(lg.x, cur.x, lam, dt);
      lg.y = U.damp(lg.y, cur.y, lam, dt);
    }
    out.drag = this.lag;
    return out;
  };

  function limb(ctx, a, b, c, w1, w2, color, drag) {
    var bx = b.x, by = b.y;
    if (drag) { bx = b.x + (drag.x - b.x) * 0.55; by = b.y + (drag.y - b.y) * 0.55; }
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = w1 * ((a.k + b.k) * 0.5);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke();
    ctx.lineWidth = w2 * ((b.k + c.k) * 0.5);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(c.x, c.y); ctx.stroke();
  }

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
    var foot = function (ank, roll) {
      /* heel-strike to toe-off: the foot rolls, so it sits differently on the
         ground through the step */
      far.fillStyle = '#2f3237';
      far.save();
      far.translate(ank.x, ank.y + 0.020 * H - roll * 0.008 * H);
      far.rotate(-roll * 0.30);
      far.beginPath();
      far.ellipse(roll * 0.010 * H, 0, 0.052 * H * ank.k, 0.021 * H * ank.k, 0, 0, TAU);
      far.fill();
      far.restore();
    };
    var drawLeg = function (hip, knee, ank, alpha, drag, roll) {
      far.globalAlpha = alpha;
      limb(far, hip, knee, ank, 0.098 * H, 0.078 * H, pal.trouser, drag);
      foot(ank, roll);
    };
    if (backLeg === 'L') {
      drawLeg(p.hipL, p.kneeL, p.ankL, 0.84, p.drag.kL, p.rollL);
      drawLeg(p.hipR, p.kneeR, p.ankR, 1, p.drag.kR, p.rollR);
    } else {
      drawLeg(p.hipR, p.kneeR, p.ankR, 0.84, p.drag.kR, p.rollR);
      drawLeg(p.hipL, p.kneeL, p.ankL, 1, p.drag.kL, p.rollL);
    }
    far.globalAlpha = 1;

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

    var idle = p.toolLeft ? [p.shR, p.elbR, p.handC, p.drag.eR] : [p.shL, p.elbL, p.handB, p.drag.eL];
    far.globalAlpha = 0.92;
    limb(far, idle[0], idle[1], idle[2], 0.066 * H, 0.052 * H, pal.shirt, idle[3]);
    far.fillStyle = pal.skin;
    far.beginPath();
    far.arc(idle[2].x, idle[2].y, 0.028 * H * idle[2].k, 0, TAU);
    far.fill();
    far.globalAlpha = 1;

    var act = p.toolLeft ? [p.shL, p.elbL, p.handB, p.drag.eL] : [p.shR, p.elbR, p.handC, p.drag.eR];
    limb(near, act[0], act[1], act[2], 0.064 * H, 0.051 * H, pal.shirt, act[3]);

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
      /* mid-re-grip the hand comes off the shaft for a moment */
      near.fillStyle = pal.skin;
      near.beginPath();
      near.arc(act[2].x - uy * p.regrip * 0.022 * H, act[2].y + ux * p.regrip * 0.022 * H,
        0.029 * H * act[2].k, 0, TAU);
      near.fill();
    } else {
      near.fillStyle = pal.skin;
      near.beginPath();
      near.arc(act[2].x, act[2].y, 0.029 * H * act[2].k, 0, TAU);
      near.fill();
    }
  };

  C.Figure = Figure;
  C.PALETTES = PALETTES;
  C.PROPORTIONS = P;
})(typeof window !== 'undefined' ? window : globalThis);
