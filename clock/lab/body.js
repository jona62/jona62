/* A body with dynamics, for the sandbox.
 *
 * The clock's rig (../js/figure.js) only ever stands and reaches: its feet
 * never leave the ground and nothing has a velocity. This one is the same
 * skeleton and the same anthropometry with actual locomotion on top —
 * gravity, a rhythmic gait with a flight phase, a ballistic jump, and a throw
 * sequenced the way a throw really is, hips before trunk before arm.
 *
 * Deliberately kept as a separate module while the movement is being worked
 * out. The skeleton maths below is shared with the clock in spirit and should
 * be merged into one module when this goes back into it.
 *
 * Units: everything is in stature H. Real-world constants converted assuming
 * H = 1.75 m, so gravity is 9.81 m/s^2 = 5.6 H/s^2, a walk is 1.4 m/s = 0.8 H/s,
 * a run 3.5 m/s = 2.0 H/s, and a standing jump clears about 0.4 m = 0.23 H.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  /* Winter / Drillis & Contini, fractions of stature */
  var P = {
    shoulderY: 0.818, hipY: 0.530, kneeY: 0.285, ankleY: 0.039,
    upperArm: 0.186, foreArm: 0.146, hand: 0.108,
    thigh: 0.245, shank: 0.246,
    shoulderHalf: 0.129, hipHalf: 0.096,
    headRx: 0.066, headRy: 0.071, neck: 0.052,
    mHAT: 0.678, mLeg: 0.161,
    crouchMax: 0.30, elbowMin: 0.107, kneeMin: 0.168
  };
  var TORSO = P.shoulderY - P.hipY, LEG = P.thigh + P.shank, ARM = P.upperArm + P.foreArm;

  var G = 5.6;             /* per H, per second squared */
  var WALK = 0.80, RUN = 2.05, JUMP_V = 1.62;
  var CAM = 4.0;

  var PAL = { shirt: '#5f77d4', shirtDark: '#4a60bd', trouser: '#39405e', trouserDark: '#2f3550',
    skin: '#d5a684', cap: '#42539f', tool: '#c6d451' };

  function v3(x, y, z) { return { x: x, y: y, z: z }; }
  function sub3(a, b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
  function add3(a, b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
  function scale3(a, k) { return v3(a.x * k, a.y * k, a.z * k); }
  function len3(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function norm3(a) { var l = len3(a) || 1e-6; return v3(a.x / l, a.y / l, a.z / l); }
  function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  function solveLimb(root, target, l1, l2, pole, dmin) {
    var d = sub3(target, root), dist = len3(d);
    var dmax = (l1 + l2) * 0.985;
    var lo = Math.max(dmin || 0, Math.abs(l1 - l2) * 1.02 + 1e-5);
    var cl = U.clamp(dist, lo, dmax);
    var u = norm3(d);
    var a = (l1 * l1 - l2 * l2 + cl * cl) / (2 * cl);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var p = sub3(pole, scale3(u, dot3(pole, u)));
    if (len3(p) < 1e-4) p = v3(0, 0, 1);
    p = norm3(p);
    return { joint: add3(root, add3(scale3(u, a), scale3(p, h))), end: add3(root, scale3(u, cl)) };
  }

  function sp(st, key, target, omega, zeta, dt) {
    var v = key + 'V';
    if (st[v] === undefined) st[v] = 0;
    st[v] += (omega * omega * (target - st[key]) - 2 * zeta * omega * st[v]) * dt;
    st[key] += st[v] * dt;
  }

  var COM_HIP = P.mHAT * 0.37 + 2 * P.mLeg * 0.55 + P.mHAT * 0.63;
  var COM_LEAN = P.mHAT * 0.63;
  var COM_FEET = 2 * P.mLeg * 0.45;

  function Body(H) {
    this.H = H;
    this.pal = PAL;
    this.n = [];
    for (var i = 0; i < 6; i++) this.n.push(new U.Noise1D(4242 + i * 977, 256));
    this.x = 0;              /* pelvis, world px */
    this.vx = 0;
    this.y = 0;              /* vertical offset of the whole body, 0 = on foot */
    this.vy = 0;
    this.z = 0;
    this.face = 1;           /* 1 = facing right-ish */
    this.s = {
      crouch: 0.05, leanX: 0, leanZ: 0.04, twist: 0, pelvisTwist: 0,
      headYaw: 0, headTilt: 0, girdle: 0, weight: 0, breath: 0, exert: 0,
      armL: { x: 0, y: 0, xV: 0, yV: 0 }, armR: { x: 0, y: 0, xV: 0, yV: 0 }
    };
    this.feet = [
      { side: -1, x: -0.07 * H, z: 0.02 * H, state: 'plant', t: 0, from: 0, to: 0, lift: 0, roll: 0 },
      { side: 1, x: 0.07 * H, z: -0.02 * H, state: 'plant', t: 0, from: 0, to: 0, lift: 0, roll: 0 }
    ];
    this.gaitPhase = 0;
    this.state = 'ground';
    this.stateT = 0;
    this.action = null;
    this.actionT = 0;
    this.held = null;
    this.reach = null;
    this.ctl = { moveTo: null, run: false, crouch: 0 };
    this.lag = null;
    this.handVel = { x: 0, y: 0 };
    this.prevHand = null;
    this.dt = 1 / 60;
    this.time = 0;
  }

  Body.prototype.jump = function () {
    if (this.state === 'ground') { this.state = 'jumpCrouch'; this.stateT = 0; }
  };
  Body.prototype.startThrow = function () {
    if (this.held && !this.action) { this.action = 'throw'; this.actionT = 0; }
  };
  Body.prototype.startPickup = function (obj) {
    if (!this.held && !this.action) { this.action = 'pickup'; this.actionT = 0; this.target = obj; }
  };

  /* ---- locomotion ---- */
  Body.prototype.locomote = function (dt) {
    var H = this.H, feet = this.feet, ctl = this.ctl;
    var top = ctl.run ? RUN * H : WALK * H;
    var want = 0;
    if (ctl.moveTo !== null) {
      var d = ctl.moveTo - this.x;
      if (Math.abs(d) > 0.08 * H) want = U.clamp(d / (0.5 * H), -1, 1) * top;
      else ctl.moveTo = null;
    }
    if (this.state !== 'ground') want = this.vx;          /* no traction in the air */
    var accel = (this.state === 'ground' ? 4.2 : 0.4) * H;
    this.vx += U.clamp(want - this.vx, -accel * dt, accel * dt);
    if (this.state === 'ground' && Math.abs(want) < 1e-3) this.vx *= Math.exp(-6 * dt);
    this.x += this.vx * dt;
    if (Math.abs(this.vx) > 0.05 * H) this.face = Math.sign(this.vx);

    var speed = Math.abs(this.vx);
    var running = speed > 1.25 * H;
    /* Cadence and stride both rise with speed; duty factor falls, and below
       about 0.6 it means a flight phase — which is the definition of running. */
    var cadence = U.lerp(1.75, 3.05, U.clamp(speed / (RUN * H), 0, 1));
    var duty = running ? 0.36 : 0.62;
    var stride = speed / cadence;

    if (this.state !== 'ground') {
      for (var i = 0; i < 2; i++) {
        var f = feet[i];
        f.state = 'air';
        f.x = U.damp(f.x, this.x + f.side * 0.055 * H + this.vx * 0.06, 9, dt);
        f.lift = U.damp(f.lift, 0.10 * H + (this.vy < 0 ? 0.05 * H : 0), 8, dt);
        f.roll = U.damp(f.roll, 0.5, 6, dt);
      }
      return;
    }

    if (speed > 0.12 * H) {
      this.gaitPhase = (this.gaitPhase + dt * cadence) % 1;
      for (var j = 0; j < 2; j++) {
        var ft = feet[j];
        /* each foot swings on its own half of the cycle */
        var local = (this.gaitPhase + (j === 0 ? 0 : 0.5)) % 1;
        var swingStart = duty, swingLen = 1 - duty;
        if (local >= swingStart) {
          var u = (local - swingStart) / swingLen;
          if (ft.state !== 'swing') {
            ft.state = 'swing';
            ft.from = ft.x;
            /* land under where the hips will be, plus half a stride ahead:
               the standard capture-point placement */
            ft.to = this.x + this.vx * (swingLen / cadence) * 0.5 + stride * 0.5 * Math.sign(this.vx || 1)
              + ft.side * 0.055 * H;
          }
          var m = U.smootherstep(0, 1, u);
          ft.x = U.lerp(ft.from, ft.to, m);
          ft.lift = Math.sin(u * Math.PI) * (running ? 0.085 : 0.05) * H;
          ft.roll = U.lerp(0.9, -0.8, m);
        } else {
          if (ft.state === 'swing') { ft.state = 'plant'; ft.x = ft.to; ft.lift = 0; }
          ft.roll = U.damp(ft.roll, local > duty * 0.7 ? 0.7 : 0, 8, dt);
        }
      }
    } else {
      /* standing: step only to stay over the feet (the clock's rule) */
      this.gaitPhase = 0;
      var busy = feet[0].state === 'swing' || feet[1].state === 'swing';
      var lo = Math.min(feet[0].x, feet[1].x), hi = Math.max(feet[0].x, feet[1].x);
      if (!busy) {
        for (var q = 0; q < 2; q++) {
          var ideal = this.x + feet[q].side * 0.065 * H;
          if (Math.abs(ideal - feet[q].x) > 0.14 * H) {
            feet[q].state = 'swing'; feet[q].t = 0; feet[q].from = feet[q].x;
            feet[q].to = feet[1 - q].x + feet[q].side * U.clamp((ideal - feet[1 - q].x) * feet[q].side, 0.075 * H, 0.20 * H);
            break;
          }
        }
      }
      for (var r = 0; r < 2; r++) {
        var fs = feet[r];
        if (fs.state === 'swing') {
          fs.t += dt / 0.34;
          var uu = U.clamp(fs.t, 0, 1), mm = U.smootherstep(0, 1, uu);
          fs.x = U.lerp(fs.from, fs.to, mm);
          fs.lift = Math.sin(uu * Math.PI) * 0.05 * H;
          fs.roll = U.lerp(0.9, -0.8, mm);
          if (uu >= 1) { fs.state = 'plant'; fs.t = 0; fs.x = fs.to; fs.lift = 0; }
        } else fs.roll = U.damp(fs.roll, 0, 6, dt);
      }
      void lo; void hi;
    }
  };

  /* ---- the vertical: crouch, launch, ballistic flight, absorption ---- */
  Body.prototype.vertical = function (dt) {
    var H = this.H;
    this.stateT += dt;
    var crouchT = this.ctl.crouch;
    if (this.state === 'jumpCrouch') {
      crouchT = 0.85;
      if (this.stateT > 0.17) { this.state = 'jumpPush'; this.stateT = 0; }
    } else if (this.state === 'jumpPush') {
      crouchT = -0.06;                      /* drive through onto the toes */
      if (this.stateT > 0.09) {
        this.state = 'air'; this.stateT = 0;
        this.vy = -JUMP_V * H;
        this.y = -0.001;
      }
    } else if (this.state === 'air') {
      this.vy += G * H * dt;
      this.y += this.vy * dt;
      crouchT = 0.18;
      if (this.y >= 0) {
        this.y = 0;
        this.state = 'land'; this.stateT = 0;
        this.landHard = U.clamp(this.vy / (JUMP_V * H), 0, 1.4);
        this.vy = 0;
      }
    } else if (this.state === 'land') {
      /* absorb: the knees take the landing and give it back */
      crouchT = this.landHard * 0.58 * Math.exp(-this.stateT * 9);
      if (this.stateT > 0.22) { this.state = 'ground'; this.stateT = 0; }
    }
    sp(this.s, 'crouch', U.clamp(crouchT, -0.1, 1), this.state === 'ground' ? 9 : 17, 0.9, dt);
  };

  /* ---- arms: reach, carry, and a throw that starts at the hips ----
   *
   * Hand targets are held in body-local coordinates and only the local
   * deviation is springy. Springing towards a world-space target instead makes
   * the arms lag by velocity x damping / stiffness — about a fifth of a metre
   * at a run, which looks exactly like being dragged along by the shoulders.
   */
  Body.prototype.arms = function (dt) {
    var H = this.H, s = this.s;
    var chestX = this.x, chestY = this.groundY - (P.shoulderY - s.crouch * P.crouchMax) * H + this.y;
    this.chest = { x: chestX, y: chestY };
    function local(pt) { return { x: pt.x - chestX, y: pt.y - chestY }; }

    var swing = Math.sin(this.gaitPhase * TAU) * U.clamp(Math.abs(this.vx) / (RUN * H), 0, 1) * 0.18 * H;
    var restL = { x: -0.14 * H - swing * 0.45, y: 0.30 * H - Math.abs(swing) * 0.12 };
    var restR = { x: 0.14 * H + swing * 0.45, y: 0.30 * H - Math.abs(swing) * 0.12 };
    restL.x += this.n[1].fbm(this.time * 0.13) * 0.030 * H;
    restL.y += this.n[2].fbm(this.time * 0.11) * 0.026 * H;
    restR.x += this.n[3].fbm(this.time * 0.12 + 4) * 0.030 * H;
    restR.y += this.n[4].fbm(this.time * 0.10 + 7) * 0.026 * H;

    var tL = restL, tR = restR, k = 26, c = 9;
    var throwHand = this.face >= 0 ? 'R' : 'L';
    var air = this.state !== 'ground';
    /* only the pickup bends him down; anything else must let him stand up */
    if (this.action !== 'pickup') this.ctl.crouch = 0;

    if (this.action === 'throw') {
      this.actionT += dt;
      var a = this.actionT, sgn = this.face, p;
      if (a < 0.24) {
        var u = U.smootherstep(0, 1, a / 0.24);
        p = { x: -sgn * u * 0.30 * H, y: -u * 0.10 * H };
        s.twist = U.damp(s.twist, -sgn * 0.45, 12, dt);
      } else if (a < 0.44) {
        var u2 = U.smootherstep(0, 1, (a - 0.24) / 0.20);
        p = { x: U.lerp(-sgn * 0.30 * H, sgn * 0.44 * H, u2),
          y: U.lerp(-0.10 * H, -0.34 * H, U.smootherstep(0, 1, Math.min(1, u2 * 1.4))) };
        s.twist = U.damp(s.twist, sgn * 0.5 * u2, 16, dt);
      } else {
        var u3 = U.smootherstep(0, 1, U.clamp((a - 0.44) / 0.34, 0, 1));
        p = { x: U.lerp(sgn * 0.44 * H, -sgn * 0.16 * H, u3),
          y: U.lerp(-0.34 * H, 0.16 * H, u3) };
        s.twist = U.damp(s.twist, -sgn * 0.15, 8, dt);
      }
      if (throwHand === 'R') tR = p; else tL = p;
      k = 190; c = 24;
      if (a >= 0.44 && this.held) this.release();
      if (a > 0.80) { this.action = null; this.actionT = 0; }
    } else if (this.action === 'pickup') {
      this.actionT += dt;
      var o = this.target;
      if (o) {
        if (Math.abs(o.x - this.x) > 0.34 * H) {
          this.ctl.moveTo = o.x - Math.sign(o.x - this.x) * 0.26 * H;
        }
        var grab = local(o);
        if (throwHand === 'R') tR = grab; else tL = grab;
        k = 110; c = 19;
        var hd = this.handPos(throwHand);
        this.ctl.crouch = U.clamp((o.y - (this.groundY - 0.55 * H)) / (0.5 * H), 0, 0.75);
        if (hd && Math.hypot(hd.x - o.x, hd.y - o.y) < 0.10 * H) {
          this.held = o; o.held = true; this.action = null; this.ctl.crouch = 0;
        }
        if (this.actionT > 5) { this.action = null; this.ctl.crouch = 0; }
      } else this.action = null;
    } else if (this.held) {
      var carry = { x: (throwHand === 'R' ? 0.17 : -0.17) * H, y: 0.22 * H };
      if (throwHand === 'R') tR = carry; else tL = carry;
    } else if (this.reach) {
      var r = local(this.reach);
      if (throwHand === 'R') tR = r; else tL = r;
      k = 70; c = 15;
    }

    /* A jump is an arm movement too: they swing back on the crouch, up through
       the push, and come down again to meet the landing. */
    if (air || this.state === 'jumpCrouch') {
      var up = this.state === 'jumpCrouch' ? -1 : (this.vy < 0 ? 1 : 0.35);
      var jL = { x: -0.20 * H - up * 0.04 * H, y: 0.30 * H - up * 0.46 * H };
      var jR = { x: 0.20 * H + up * 0.04 * H, y: 0.30 * H - up * 0.46 * H };
      if (!this.held && this.action !== 'throw') { tL = jL; tR = jR; k = 70; c = 14; }
    }

    var A = s.armL, B = s.armR;
    if (!A.set) { A.x = restL.x; A.y = restL.y; B.x = restR.x; B.y = restR.y; A.set = B.set = true; }
    A.xV += (tL.x - A.x) * k * dt; A.xV *= Math.exp(-c * dt); A.x += A.xV * dt;
    A.yV += (tL.y - A.y) * k * dt; A.yV *= Math.exp(-c * dt); A.y += A.yV * dt;
    B.xV += (tR.x - B.x) * k * dt; B.xV *= Math.exp(-c * dt); B.x += B.xV * dt;
    B.yV += (tR.y - B.y) * k * dt; B.yV *= Math.exp(-c * dt); B.y += B.yV * dt;

    this.throwHand = throwHand;
    var world = this.handPos(throwHand);
    if (this.prevHand) {
      this.handVel.x = (world.x - this.prevHand.x) / Math.max(dt, 1e-4);
      this.handVel.y = (world.y - this.prevHand.y) / Math.max(dt, 1e-4);
    }
    this.prevHand = { x: world.x, y: world.y };
    if (this.held) { this.held.x = world.x; this.held.y = world.y; }
  };

  Body.prototype.handPos = function (side) {
    var a = side === 'R' ? this.s.armR : this.s.armL;
    if (!a.set || !this.chest) return null;
    return { x: this.chest.x + a.x, y: this.chest.y + a.y };
  };

  Body.prototype.release = function () {
    var o = this.held;
    if (!o) return;
    o.held = false;
    /* the object leaves with the hand's own velocity, plus what the whole
       body was carrying forward */
    o.vx = this.handVel.x * 0.95;
    o.vy = this.handVel.y * 0.92;
    this.held = null;
  };

  Body.prototype.step = function (dt, groundY) {
    this.dt = dt;
    this.groundY = groundY;
    this.time += dt;
    this.locomote(dt);
    this.vertical(dt);
    var s = this.s, H = this.H;
    var speed = Math.abs(this.vx) / (RUN * H);
    sp(s, 'leanX', U.clamp(this.vx / (RUN * H), -1, 1) * 0.22 + (this.state === 'air' ? 0.05 : 0), 8, 0.75, dt);
    sp(s, 'leanZ', 0.04 + speed * 0.20 + s.crouch * 0.5, 7.5, 0.8, dt);
    if (this.action !== 'throw') sp(s, 'twist', 0, 6, 0.8, dt);
    s.pelvisTwist = U.damp(s.pelvisTwist, -s.twist * 0.4 + Math.sin(this.gaitPhase * TAU) * speed * 0.16, 8, dt);
    s.exert = U.damp(s.exert, speed, speed > s.exert ? 1.4 : 0.3, dt);
    s.breath += dt * (0.62 + s.exert * 1.1) * TAU;
    var swinging = this.feet[0].state === 'swing' ? 1 : (this.feet[1].state === 'swing' ? -1 : 0);
    /* Standing still is not a pose, it is a slow drift of weight from one leg
       to the other. Without this he reads as a toy soldier. */
    var idleShift = this.n[0].fbm(this.time * 0.09, 2) * 0.75;
    s.weight = U.damp(s.weight, swinging || (speed < 0.05 ? idleShift : 0), swinging ? 8 : 1.1, dt);
    this.arms(dt);

    var look = this.reach || (this.held ? null : null);
    var yawT = look ? U.clamp((look.x - this.x) / (0.5 * H), -1, 1) * 0.7 : U.clamp(this.vx / (RUN * H), -1, 1) * 0.5;
    yawT += this.n[5].fbm(this.time * 0.08, 2) * 0.28;
    sp(s, 'headYaw', yawT, 12, 0.85, dt);
    sp(s, 'headTilt', look ? U.clamp((look.y - (groundY - 0.8 * H)) / (0.5 * H), -0.4, 0.4) : 0, 10, 0.85, dt);
  };

  Body.prototype.pose = function (view) {
    var H = this.H, s = this.s, feet = this.feet, dt = this.dt;
    var F = this.groundY;
    var breath = Math.sin(s.breath) * (0.6 + s.exert * 0.9);

    var pelvisY = F - (P.hipY - s.crouch * P.crouchMax) * H + this.y + breath * 0.002 * H;
    if (this.state === 'ground' || this.state === 'land' || this.state === 'jumpCrouch') {
      var legMax = LEG * H * 0.985;
      for (var i = 0; i < 2; i++) {
        var ankY = F - (P.ankleY * H + feet[i].lift);
        var dx = (this.x + feet[i].side * P.hipHalf * H) - feet[i].x;
        var span = Math.sqrt(Math.max(0, legMax * legMax - dx * dx));
        pelvisY = Math.max(pelvisY, ankY - span);
      }
    }

    var seg = TORSO * H / 3, w = [0.46, 0.33, 0.21];
    var p0 = v3(this.x, pelvisY, this.z), pts = [p0], accX = 0, accZ = 0, pcur = p0;
    for (var q = 0; q < 3; q++) {
      accX += s.leanX * w[q]; accZ += s.leanZ * w[q];
      var dir = norm3(v3(Math.sin(accX), -Math.cos(accX) * Math.cos(accZ), Math.sin(accZ)));
      pcur = add3(pcur, scale3(dir, seg));
      pts.push(pcur);
    }
    var top = pts[3];
    var right = norm3(v3(Math.cos(s.leanX) * Math.cos(s.twist), Math.sin(s.leanX) * 0.5, Math.sin(s.twist)));
    var half = P.shoulderHalf * H;
    var shL = v3(top.x - right.x * half, top.y - right.y * half, top.z - right.z * half);
    var shR = v3(top.x + right.x * half, top.y + right.y * half, top.z + right.z * half);

    var obl = -s.weight * 0.018 * H;
    var pr = s.pelvisTwist, hh = P.hipHalf * H;
    var hipL = v3(p0.x - hh * Math.cos(pr), p0.y - obl, p0.z - hh * Math.sin(pr));
    var hipR = v3(p0.x + hh * Math.cos(pr), p0.y + obl, p0.z + hh * Math.sin(pr));
    var ankL = v3(feet[0].x, F - P.ankleY * H - feet[0].lift + Math.min(0, this.y), feet[0].z);
    var ankR = v3(feet[1].x, F - P.ankleY * H - feet[1].lift + Math.min(0, this.y), feet[1].z);

    var abd = 0.22 + s.crouch * 0.45;
    var kneeL = solveLimb(hipL, ankL, P.thigh * H, P.shank * H, norm3(v3(-abd, 0, 1)), P.kneeMin * H);
    var kneeR = solveLimb(hipR, ankR, P.thigh * H, P.shank * H, norm3(v3(abd, 0, 1)), P.kneeMin * H);

    var hw = this.chest || { x: this.x, y: F - P.shoulderY * H };
    var handL = v3(hw.x + s.armL.x, hw.y + s.armL.y, 0.09 * H);
    var handR = v3(hw.x + s.armR.x, hw.y + s.armR.y, 0.09 * H);
    var elbL = solveLimb(shL, handL, P.upperArm * H, P.foreArm * H, norm3(v3(-0.45, 0.6, -1)), P.elbowMin * H);
    var elbR = solveLimb(shR, handR, P.upperArm * H, P.foreArm * H, norm3(v3(0.45, 0.6, -1)), P.elbowMin * H);

    var neck = v3(top.x, top.y - P.neck * H * 0.4, top.z);
    var headAng = s.leanX * 0.3 + s.headTilt * 0.5;
    var head = v3(neck.x + Math.sin(headAng) * P.headRy * H * 1.5 + right.x * s.headYaw * P.headRx * H * 0.5,
      neck.y - Math.cos(headAng) * P.headRy * H * 1.5, neck.z);

    var f = H * CAM;
    function pj(p) { var k = f / (f - p.z); return { x: view.cx + (p.x - view.cx) * k, y: p.y, k: k }; }

    var out = {
      H: H, feetY: F,
      pelvis: pj(p0), spine: pts.map(pj), shL: pj(shL), shR: pj(shR),
      hipL: pj(hipL), hipR: pj(hipR), kneeL: pj(kneeL.joint), kneeR: pj(kneeR.joint),
      ankL: pj(ankL), ankR: pj(ankR), elbL: pj(elbL.joint), elbR: pj(elbR.joint),
      handB: pj(handL), handC: pj(handR), neck: pj(neck),
      head: { p: pj(head), ang: headAng, yaw: s.headYaw, rx: P.headRx * H, ry: P.headRy * H, k: pj(head).k },
      toolLeft: this.throwHand === 'L',
      rollL: feet[0].roll, rollR: feet[1].roll,
      com: { x: COM_HIP * this.x + COM_LEAN * (top.x - this.x) + COM_FEET * ((feet[0].x + feet[1].x) * 0.5),
        y: F - 0.553 * H + this.y },
      support: [Math.min(feet[0].x, feet[1].x), Math.max(feet[0].x, feet[1].x)],
      state: this.state, speed: this.vx
    };
    if (!this.lag) {
      this.lag = { kL: { x: out.kneeL.x, y: out.kneeL.y }, kR: { x: out.kneeR.x, y: out.kneeR.y },
        eL: { x: out.elbL.x, y: out.elbL.y }, eR: { x: out.elbR.x, y: out.elbR.y } };
    }
    var pairs = [['kL', 'kneeL'], ['kR', 'kneeR'], ['eL', 'elbL'], ['eR', 'elbR']];
    for (var j = 0; j < pairs.length; j++) {
      var lg = this.lag[pairs[j][0]], cur = out[pairs[j][1]];
      lg.x = U.damp(lg.x, cur.x, 22, dt);
      lg.y = U.damp(lg.y, cur.y, 22, dt);
    }
    out.drag = this.lag;
    return out;
  };

  C.Body = Body;
  C.BODY_P = P;
  C.BODY_CONST = { G: G, WALK: WALK, RUN: RUN, JUMP_V: JUMP_V };
})(typeof window !== 'undefined' ? window : globalThis);
