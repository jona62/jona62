/* The rig, in three dimensions.
 *
 * Same anthropometry as the clock (Winter, after Drillis & Contini) and the
 * same solve, but the world is now y-up with a ground plane at y = 0, and he
 * walks on it rather than along a line: position and velocity are (x, z), he
 * has a heading he turns towards, and feet are placed either side of that
 * heading rather than either side of the screen.
 *
 * The skeleton is solved in world space each frame and handed out as joint
 * positions; rig3d.js hangs geometry on them. Nothing here knows about
 * rendering, and nothing in the renderer knows about biomechanics.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = Math.PI * 2;

  var P = {
    shoulderY: 0.818, hipY: 0.530, kneeY: 0.285, ankleY: 0.039,
    upperArm: 0.186, foreArm: 0.146,
    thigh: 0.245, shank: 0.246, footLen: 0.152,
    shoulderHalf: 0.129, hipHalf: 0.096,
    headRx: 0.066, headRy: 0.071, headRz: 0.076, neck: 0.052,
    mHAT: 0.678, mLeg: 0.161,
    crouchMax: 0.30, elbowMin: 0.107, kneeMin: 0.168
  };
  var TORSO = P.shoulderY - P.hipY, LEG = P.thigh + P.shank, ARM = P.upperArm + P.foreArm;
  var G = 5.6, WALK = 0.80, RUN = 2.05, JUMP_V = 1.62, TURN = 7.0;

  function v(x, y, z) { return { x: x, y: y, z: z }; }
  function add(a, b) { return v(a.x + b.x, a.y + b.y, a.z + b.z); }
  function sub(a, b) { return v(a.x - b.x, a.y - b.y, a.z - b.z); }
  function mul(a, k) { return v(a.x * k, a.y * k, a.z * k); }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function norm(a) { var l = len(a) || 1e-6; return v(a.x / l, a.y / l, a.z / l); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  /* Two-bone IK with a pole vector, in world space. */
  function ik(root, target, l1, l2, pole, dmin) {
    var d = sub(target, root), dist = len(d);
    var lo = Math.max(dmin || 0, Math.abs(l1 - l2) * 1.02 + 1e-5);
    var cl = U.clamp(dist, lo, (l1 + l2) * 0.985);
    var u = norm(d);
    var a = (l1 * l1 - l2 * l2 + cl * cl) / (2 * cl);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var p = sub(pole, mul(u, dot(pole, u)));
    if (len(p) < 1e-4) p = v(0, -1, 0);
    p = norm(p);
    return { joint: add(root, add(mul(u, a), mul(p, h))), end: add(root, mul(u, cl)) };
  }

  function sp(st, key, target, omega, zeta, dt) {
    var k = key + 'V';
    if (st[k] === undefined) st[k] = 0;
    st[k] += (omega * omega * (target - st[key]) - 2 * zeta * omega * st[k]) * dt;
    st[key] += st[k] * dt;
  }
  function angDamp(cur, target, rate, dt) {
    var d = ((target - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
    var step = U.clamp(d, -rate * dt, rate * dt);
    return cur + step;
  }

  function Body(H) {
    this.H = H;
    this.n = [];
    for (var i = 0; i < 7; i++) this.n.push(new U.Noise1D(9001 + i * 613, 256));
    this.pos = v(0, 0, 0);          /* on the ground, y unused */
    this.vel = v(0, 0, 0);
    this.yaw = 0;                    /* heading, radians; 0 looks down -z */
    this.yOff = 0; this.vy = 0;      /* vertical excursion of the whole body */
    this.state = 'ground'; this.stateT = 0;
    this.action = null; this.actionT = 0;
    this.held = null; this.target = null;
    this.time = 0; this.dt = 1 / 60;
    this.gaitPhase = 0;
    this.ctl = { moveTo: null, run: false, crouch: 0 };
    this.s = {
      crouch: 0.05, leanF: 0.05, leanS: 0, twist: 0, pelvisTwist: 0,
      headYaw: 0, headPitch: 0, weight: 0, breath: 0, exert: 0,
      armL: { x: 0, y: 0, z: 0, xV: 0, yV: 0, zV: 0, set: false },
      armR: { x: 0, y: 0, z: 0, xV: 0, yV: 0, zV: 0, set: false }
    };
    this.feet = [
      { side: -1, x: -0.07 * H, z: 0, state: 'plant', t: 0, fx: 0, fz: 0, tx: 0, tz: 0, lift: 0, roll: 0, yaw: 0 },
      { side: 1, x: 0.07 * H, z: 0, state: 'plant', t: 0, fx: 0, fz: 0, tx: 0, tz: 0, lift: 0, roll: 0, yaw: 0 }
    ];
    this.handVel = v(0, 0, 0);
    this.prevHand = null;
  }

  Body.prototype.fwd = function () { return v(Math.sin(this.yaw), 0, Math.cos(this.yaw)); };
  Body.prototype.right = function () { return v(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); };

  Body.prototype.jump = function () { if (this.state === 'ground') { this.state = 'jumpCrouch'; this.stateT = 0; } };
  Body.prototype.startThrow = function () { if (this.held && !this.action) { this.action = 'throw'; this.actionT = 0; } };
  Body.prototype.startPickup = function (o) { if (!this.held && !this.action) { this.action = 'pickup'; this.actionT = 0; this.target = o; } };

  Body.prototype.locomote = function (dt) {
    var H = this.H, ctl = this.ctl, feet = this.feet;
    var top = (ctl.run ? RUN : WALK) * H;
    var want = v(0, 0, 0);
    if (ctl.moveTo) {
      var d = v(ctl.moveTo.x - this.pos.x, 0, ctl.moveTo.z - this.pos.z);
      var dl = len(d);
      if (dl > 0.12 * H) want = mul(norm(d), Math.min(top, dl * 2.2));
      else ctl.moveTo = null;
    }
    if (this.state !== 'ground') want = v(this.vel.x, 0, this.vel.z);
    var acc = (this.state === 'ground' ? 4.2 : 0.35) * H;
    var dv = sub(want, this.vel);
    var dvl = len(dv);
    if (dvl > acc * dt) dv = mul(dv, acc * dt / dvl);
    this.vel = add(this.vel, dv);
    if (this.state === 'ground' && len(want) < 1e-3) this.vel = mul(this.vel, Math.exp(-6 * dt));
    this.pos = add(this.pos, mul(this.vel, dt));

    var speed = len(this.vel);
    if (speed > 0.06 * H) this.yaw = angDamp(this.yaw, Math.atan2(this.vel.x, this.vel.z), TURN, dt);

    var running = speed > 1.25 * H;
    var cadence = U.lerp(1.75, 3.05, U.clamp(speed / (RUN * H), 0, 1));
    var duty = running ? 0.36 : 0.62;
    var stride = speed / cadence;
    var fwd = this.fwd(), rgt = this.right();

    if (this.state !== 'ground') {
      for (var i = 0; i < 2; i++) {
        var fa = feet[i];
        fa.state = 'air';
        var home = add(this.pos, add(mul(rgt, fa.side * 0.055 * H), mul(fwd, -0.02 * H)));
        fa.x = U.damp(fa.x, home.x, 9, dt); fa.z = U.damp(fa.z, home.z, 9, dt);
        fa.lift = U.damp(fa.lift, 0.11 * H, 8, dt);
        fa.roll = U.damp(fa.roll, 0.5, 6, dt);
        fa.yaw = angDamp(fa.yaw, this.yaw, 6, dt);
      }
      return;
    }

    if (speed > 0.12 * H) {
      this.gaitPhase = (this.gaitPhase + dt * cadence) % 1;
      for (var j = 0; j < 2; j++) {
        var f = feet[j];
        var local = (this.gaitPhase + (j === 0 ? 0 : 0.5)) % 1;
        if (local >= duty) {
          var u = (local - duty) / (1 - duty);
          if (f.state !== 'swing') {
            f.state = 'swing'; f.fx = f.x; f.fz = f.z;
            /* capture point: land under the hips half a stride ahead */
            var land = add(this.pos, add(mul(this.vel, (1 - duty) / cadence * 0.5),
              add(mul(fwd, stride * 0.5), mul(rgt, f.side * 0.055 * H))));
            f.tx = land.x; f.tz = land.z;
          }
          var m = U.smootherstep(0, 1, u);
          f.x = U.lerp(f.fx, f.tx, m); f.z = U.lerp(f.fz, f.tz, m);
          f.lift = Math.sin(u * Math.PI) * (running ? 0.085 : 0.05) * H;
          f.roll = U.lerp(0.9, -0.8, m);
        } else {
          if (f.state === 'swing') { f.state = 'plant'; f.x = f.tx; f.z = f.tz; f.lift = 0; }
          f.roll = U.damp(f.roll, local > duty * 0.7 ? 0.7 : 0, 8, dt);
        }
        f.yaw = angDamp(f.yaw, this.yaw, 7, dt);
      }
    } else {
      this.gaitPhase = 0;
      var busy = feet[0].state === 'swing' || feet[1].state === 'swing';
      if (!busy) {
        for (var q = 0; q < 2; q++) {
          var ide = add(this.pos, mul(rgt, feet[q].side * 0.065 * H));
          if (Math.hypot(ide.x - feet[q].x, ide.z - feet[q].z) > 0.14 * H) {
            feet[q].state = 'swing'; feet[q].t = 0;
            feet[q].fx = feet[q].x; feet[q].fz = feet[q].z;
            feet[q].tx = ide.x; feet[q].tz = ide.z;
            break;
          }
        }
      }
      for (var r = 0; r < 2; r++) {
        var fs = feet[r];
        if (fs.state === 'swing') {
          fs.t += dt / 0.34;
          var uu = U.clamp(fs.t, 0, 1), mm = U.smootherstep(0, 1, uu);
          fs.x = U.lerp(fs.fx, fs.tx, mm); fs.z = U.lerp(fs.fz, fs.tz, mm);
          fs.lift = Math.sin(uu * Math.PI) * 0.05 * H;
          fs.roll = U.lerp(0.9, -0.8, mm);
          if (uu >= 1) { fs.state = 'plant'; fs.t = 0; fs.x = fs.tx; fs.z = fs.tz; fs.lift = 0; }
        } else fs.roll = U.damp(fs.roll, 0, 6, dt);
        fs.yaw = angDamp(fs.yaw, this.yaw, 5, dt);
      }
    }
  };

  Body.prototype.vertical = function (dt) {
    var H = this.H;
    this.stateT += dt;
    var crouchT = this.ctl.crouch;
    if (this.state === 'jumpCrouch') {
      crouchT = 0.85;
      if (this.stateT > 0.17) { this.state = 'jumpPush'; this.stateT = 0; }
    } else if (this.state === 'jumpPush') {
      crouchT = -0.06;
      if (this.stateT > 0.09) { this.state = 'air'; this.stateT = 0; this.vy = JUMP_V * H; this.yOff = 0.001; }
    } else if (this.state === 'air') {
      this.vy -= G * H * dt;
      this.yOff += this.vy * dt;
      crouchT = 0.18;
      if (this.yOff <= 0) {
        this.yOff = 0; this.state = 'land'; this.stateT = 0;
        this.landHard = U.clamp(-this.vy / (JUMP_V * H), 0, 1.4);
        this.vy = 0;
      }
    } else if (this.state === 'land') {
      crouchT = this.landHard * 0.58 * Math.exp(-this.stateT * 9);
      if (this.stateT > 0.22) { this.state = 'ground'; this.stateT = 0; }
    }
    sp(this.s, 'crouch', U.clamp(crouchT, -0.1, 1), this.state === 'ground' ? 9 : 17, 0.9, dt);
  };

  /* Hand targets live in body-local coordinates (right, up, forward) so that
     translating or turning never drags the arms behind. */
  Body.prototype.arms = function (dt) {
    var H = this.H, s = this.s;
    var shoulderH = (P.shoulderY - s.crouch * P.crouchMax) * H + this.yOff;
    this.chest = v(this.pos.x, shoulderH, this.pos.z);
    var fwd = this.fwd(), rgt = this.right();
    var self = this;
    function toLocal(p) {
      var d = sub(p, self.chest);
      return { x: dot(d, rgt), y: d.y, z: dot(d, fwd) };
    }
    function toWorld(l) {
      return v(self.chest.x + rgt.x * l.x + fwd.x * l.z,
        self.chest.y + l.y,
        self.chest.z + rgt.z * l.x + fwd.z * l.z);
    }
    this.toWorld = toWorld;

    var speed = len(this.vel) / (RUN * H);
    var swing = Math.sin(this.gaitPhase * TAU) * U.clamp(speed, 0, 1) * 0.20 * H;
    var tL = { x: -0.15 * H, y: -0.30 * H, z: -swing };
    var tR = { x: 0.15 * H, y: -0.30 * H, z: swing };
    tL.x += this.n[1].fbm(this.time * 0.13) * 0.025 * H;
    tR.x += this.n[2].fbm(this.time * 0.12 + 4) * 0.025 * H;
    tL.y += this.n[3].fbm(this.time * 0.11) * 0.022 * H;
    tR.y += this.n[4].fbm(this.time * 0.10 + 7) * 0.022 * H;
    var k = 26, c = 9;
    var hand = 'R';
    if (this.action !== 'pickup') this.ctl.crouch = 0;

    if (this.action === 'throw') {
      this.actionT += dt;
      var a = this.actionT, p;
      if (a < 0.24) {
        var u = U.smootherstep(0, 1, a / 0.24);
        p = { x: 0.16 * H, y: 0.02 * H, z: -0.34 * H * u };
        s.twist = U.damp(s.twist, -0.5, 12, dt);
      } else if (a < 0.44) {
        var u2 = U.smootherstep(0, 1, (a - 0.24) / 0.20);
        p = { x: U.lerp(0.16, 0.05, u2) * H,
          y: U.lerp(0.02, 0.30, U.smootherstep(0, 1, Math.min(1, u2 * 1.4))) * H,
          z: U.lerp(-0.34, 0.42, u2) * H };
        s.twist = U.damp(s.twist, 0.55 * u2, 16, dt);
      } else {
        var u3 = U.smootherstep(0, 1, U.clamp((a - 0.44) / 0.34, 0, 1));
        p = { x: U.lerp(0.05, -0.16, u3) * H, y: U.lerp(0.30, -0.18, u3) * H, z: U.lerp(0.42, 0.06, u3) * H };
        s.twist = U.damp(s.twist, -0.12, 8, dt);
      }
      tR = p; k = 190; c = 24;
      if (a >= 0.44 && this.held) this.release();
      if (a > 0.80) { this.action = null; this.actionT = 0; }
    } else if (this.action === 'pickup') {
      this.actionT += dt;
      var o = this.target;
      if (o) {
        var away = Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
        if (away > 0.34 * H) {
          var dir = norm(v(o.pos.x - this.pos.x, 0, o.pos.z - this.pos.z));
          this.ctl.moveTo = { x: o.pos.x - dir.x * 0.26 * H, z: o.pos.z - dir.z * 0.26 * H };
        }
        tR = toLocal(o.pos); k = 110; c = 19;
        this.ctl.crouch = U.clamp((0.55 * H - o.pos.y) / (0.5 * H), 0, 0.8);
        var hw = this.handWorld('R');
        if (hw && len(sub(hw, o.pos)) < 0.11 * H) {
          this.held = o; o.held = true; this.action = null; this.ctl.crouch = 0;
        }
        if (this.actionT > 5) { this.action = null; this.ctl.crouch = 0; }
      } else this.action = null;
    } else if (this.held) {
      tR = { x: 0.15 * H, y: -0.20 * H, z: 0.13 * H };
    }

    if (this.state !== 'ground' && this.state !== 'land' && !this.held && this.action !== 'throw') {
      var up = this.state === 'jumpCrouch' ? -1 : (this.vy > 0 ? 1 : 0.35);
      tL = { x: -0.20 * H, y: -0.30 * H + up * 0.46 * H, z: -0.04 * H };
      tR = { x: 0.20 * H, y: -0.30 * H + up * 0.46 * H, z: -0.04 * H };
      k = 70; c = 14;
    }

    var A = s.armL, B = s.armR;
    if (!A.set) { A.x = tL.x; A.y = tL.y; A.z = tL.z; B.x = tR.x; B.y = tR.y; B.z = tR.z; A.set = B.set = true; }
    ['x', 'y', 'z'].forEach(function (ax) {
      A[ax + 'V'] += (tL[ax] - A[ax]) * k * dt; A[ax + 'V'] *= Math.exp(-c * dt); A[ax] += A[ax + 'V'] * dt;
      B[ax + 'V'] += (tR[ax] - B[ax]) * k * dt; B[ax + 'V'] *= Math.exp(-c * dt); B[ax] += B[ax + 'V'] * dt;
    });

    this.throwHand = hand;
    var w = this.handWorld('R');
    if (this.prevHand) this.handVel = mul(sub(w, this.prevHand), 1 / Math.max(dt, 1e-4));
    this.prevHand = w;
    if (this.held) this.held.pos = w;
  };

  Body.prototype.handWorld = function (side) {
    var a = side === 'R' ? this.s.armR : this.s.armL;
    if (!a.set || !this.toWorld) return null;
    return this.toWorld(a);
  };

  Body.prototype.release = function () {
    var o = this.held;
    if (!o) return;
    o.held = false;
    o.vel = v(this.handVel.x * 0.95, this.handVel.y * 0.95, this.handVel.z * 0.95);
    this.held = null;
  };

  Body.prototype.step = function (dt) {
    this.dt = dt; this.time += dt;
    var H = this.H, s = this.s;
    this.locomote(dt);
    this.vertical(dt);
    var speed = len(this.vel) / (RUN * H);
    sp(s, 'leanF', 0.05 + speed * 0.26 + s.crouch * 0.5, 7.5, 0.8, dt);
    sp(s, 'leanS', 0, 7, 0.8, dt);
    if (this.action !== 'throw') sp(s, 'twist', 0, 6, 0.8, dt);
    s.pelvisTwist = U.damp(s.pelvisTwist, -s.twist * 0.4 + Math.sin(this.gaitPhase * TAU) * speed * 0.18, 8, dt);
    s.exert = U.damp(s.exert, speed, speed > s.exert ? 1.4 : 0.3, dt);
    s.breath += dt * (0.62 + s.exert * 1.1) * TAU;
    var swinging = this.feet[0].state === 'swing' ? 1 : (this.feet[1].state === 'swing' ? -1 : 0);
    var idle = this.n[0].fbm(this.time * 0.09, 2) * 0.75;
    s.weight = U.damp(s.weight, swinging || (speed < 0.03 ? idle : 0), swinging ? 8 : 1.1, dt);
    this.arms(dt);
    var look = this.held || !this.target ? null : this.target;
    sp(s, 'headYaw', look ? 0 : this.n[5].fbm(this.time * 0.08, 2) * 0.3, 10, 0.85, dt);
    sp(s, 'headPitch', this.ctl.crouch * 0.45 + speed * 0.1, 9, 0.85, dt);
  };

  Body.prototype.pose = function () {
    var H = this.H, s = this.s, feet = this.feet;
    var breath = Math.sin(s.breath) * (0.6 + s.exert * 0.9);
    var fwd = this.fwd(), rgt = this.right();

    var hipH = (P.hipY - s.crouch * P.crouchMax) * H + this.yOff + breath * 0.002 * H;
    if (this.state === 'ground' || this.state === 'land' || this.state === 'jumpCrouch') {
      var legMax = LEG * H * 0.985;
      for (var i = 0; i < 2; i++) {
        var ankY = P.ankleY * H + feet[i].lift;
        var hp = add(this.pos, mul(rgt, feet[i].side * P.hipHalf * H));
        var flat = Math.hypot(hp.x - feet[i].x, hp.z - feet[i].z);
        var span = Math.sqrt(Math.max(0, legMax * legMax - flat * flat));
        hipH = Math.min(hipH, ankY + span);
      }
    }
    var pelvis = v(this.pos.x, hipH, this.pos.z);

    /* spine: three segments, leaning forward along the heading and sideways */
    var seg = TORSO * H / 3, w = [0.46, 0.33, 0.21];
    var pts = [pelvis], cur = pelvis, af = 0, as = 0;
    for (var q = 0; q < 3; q++) {
      af += s.leanF * w[q]; as += s.leanS * w[q];
      var dir = norm(v(fwd.x * Math.sin(af) + rgt.x * Math.sin(as),
        Math.cos(af) * Math.cos(as),
        fwd.z * Math.sin(af) + rgt.z * Math.sin(as)));
      cur = add(cur, mul(dir, seg));
      pts.push(cur);
    }
    var chest = pts[3];
    var tw = s.twist;
    var shDir = v(rgt.x * Math.cos(tw) + fwd.x * Math.sin(tw), 0, rgt.z * Math.cos(tw) + fwd.z * Math.sin(tw));
    var shL = add(chest, mul(shDir, -P.shoulderHalf * H));
    var shR = add(chest, mul(shDir, P.shoulderHalf * H));

    var pt = s.pelvisTwist;
    var hipDir = v(rgt.x * Math.cos(pt) + fwd.x * Math.sin(pt), 0, rgt.z * Math.cos(pt) + fwd.z * Math.sin(pt));
    var obl = -s.weight * 0.018 * H;
    var hipL = add(add(pelvis, mul(hipDir, -P.hipHalf * H)), v(0, obl, 0));
    var hipR = add(add(pelvis, mul(hipDir, P.hipHalf * H)), v(0, -obl, 0));

    var ankL = v(feet[0].x, P.ankleY * H + feet[0].lift + Math.max(0, this.yOff), feet[0].z);
    var ankR = v(feet[1].x, P.ankleY * H + feet[1].lift + Math.max(0, this.yOff), feet[1].z);

    var abd = 0.22 + s.crouch * 0.5;
    var kneePoleL = norm(add(fwd, mul(rgt, -abd)));
    var kneePoleR = norm(add(fwd, mul(rgt, abd)));
    var kneeL = ik(hipL, ankL, P.thigh * H, P.shank * H, kneePoleL, P.kneeMin * H);
    var kneeR = ik(hipR, ankR, P.thigh * H, P.shank * H, kneePoleR, P.kneeMin * H);

    var handL = this.handWorld('L') || add(shL, v(0, -0.3 * H, 0));
    var handR = this.handWorld('R') || add(shR, v(0, -0.3 * H, 0));
    var elbowPoleL = norm(add(mul(fwd, -1), add(v(0, -0.6, 0), mul(rgt, -0.45))));
    var elbowPoleR = norm(add(mul(fwd, -1), add(v(0, -0.6, 0), mul(rgt, 0.45))));
    var elbL = ik(shL, handL, P.upperArm * H, P.foreArm * H, elbowPoleL, P.elbowMin * H);
    var elbR = ik(shR, handR, P.upperArm * H, P.foreArm * H, elbowPoleR, P.elbowMin * H);

    var neck = add(chest, v(0, P.neck * H * 0.4, 0));
    var headUp = norm(add(v(0, 1, 0), mul(fwd, s.leanF * 0.3 + s.headPitch * 0.4)));
    var head = add(neck, mul(headUp, P.headRy * H * 1.45));

    return {
      H: H, pelvis: pelvis, spine: pts, chest: chest,
      shL: shL, shR: shR, hipL: hipL, hipR: hipR,
      kneeL: kneeL.joint, kneeR: kneeR.joint, ankL: ankL, ankR: ankR,
      elbL: elbL.joint, elbR: elbR.joint, handL: handL, handR: handR,
      neck: neck, head: head, headUp: headUp,
      yaw: this.yaw + s.headYaw * 0.5, bodyYaw: this.yaw,
      footYawL: feet[0].yaw, footYawR: feet[1].yaw,
      rollL: feet[0].roll, rollR: feet[1].roll,
      com: v(this.pos.x, 0.553 * H + this.yOff, this.pos.z),
      support: [v(feet[0].x, 0, feet[0].z), v(feet[1].x, 0, feet[1].z)],
      state: this.state, speed: len(this.vel)
    };
  };

  C.Body3D = Body;
  C.BODY3D_P = P;
  C.BODY3D_CONST = { G: G, WALK: WALK, RUN: RUN, JUMP_V: JUMP_V };
  C.v3 = { v: v, add: add, sub: sub, mul: mul, len: len, norm: norm, dot: dot };
})(typeof window !== 'undefined' ? window : globalThis);
