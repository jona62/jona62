/* The body. One copy.
 *
 * This is the single source of the skeleton, its proportions, its balance and
 * its locomotion. It was previously duplicated three ways — the clock's
 * painter, the 2D sandbox and the 3D sandbox — which is exactly the way
 * three subtly different bodies come about.
 *
 * It solves in a right-handed, y-up world with the ground at y = 0 and hands
 * out joint positions. It knows nothing about canvases, meshes or clocks;
 * `rig.project` turns a pose into screen space for the 2D renderers, and the
 * 3D renderer consumes the world pose directly.
 *
 * Proportions are Winter's anthropometric table (after Drillis & Contini), as
 * fractions of stature H: shoulder at 0.818 H, hip 0.530, knee 0.285, ankle
 * 0.039; upper arm 0.186, forearm 0.146, thigh 0.245, shank 0.246. The joint
 * heights and the segment lengths agree with one another, which is what keeps
 * the silhouette honest in any pose.
 *
 * Physics constants are real ones converted at H = 1.75 m: gravity 9.81 m/s²
 * is 5.6 H/s², a walk 1.4 m/s is 0.80 H/s, a run 3.5 m/s is 2.05 H/s, and a
 * standing jump clears about 0.4 m.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK = global.CLOCK || {};
  var U = C.util;
  var TAU = Math.PI * 2;

  var P = {
    shoulderY: 0.818, hipY: 0.530, kneeY: 0.285, ankleY: 0.039,
    upperArm: 0.186, foreArm: 0.146, hand: 0.108,
    thigh: 0.245, shank: 0.246, footLen: 0.152,
    /* shoulderHalf is the acromion (biacromial 0.259 H). hipHalf is the
       femoral head, NOT the pelvis: bi-iliac breadth is 0.191 H but the hip
       joints are only about 0.097 H apart, and hanging the legs off the
       pelvis edge splays them. */
    shoulderHalf: 0.129, hipHalf: 0.049, pelvisHalf: 0.096,
    headRx: 0.066, headRy: 0.071, headRz: 0.078, neck: 0.052,
    mHAT: 0.678, mLeg: 0.161,
    crouchMax: 0.30, leanMax: 0.62, sideMax: 0.34,
    elbowMin: 0.107, kneeMin: 0.168      /* elbow to ~145°, knee to ~140° */
  };
  var TORSO = P.shoulderY - P.hipY, LEG = P.thigh + P.shank, ARM = P.upperArm + P.foreArm;
  var G = 5.6, WALK = 0.80, RUN = 2.05, JUMP_V = 1.62, TURN = 7.0;
  var PRELOAD = 0.15, SWING = 0.34, LOCK = 0.12;

  function v(x, y, z) { return { x: x, y: y, z: z }; }
  function add(a, b) { return v(a.x + b.x, a.y + b.y, a.z + b.z); }
  function sub(a, b) { return v(a.x - b.x, a.y - b.y, a.z - b.z); }
  function mul(a, k) { return v(a.x * k, a.y * k, a.z * k); }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function norm(a) { var l = len(a) || 1e-6; return v(a.x / l, a.y / l, a.z / l); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function flat(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  /* Two-bone IK with a pole vector: the joint is placed in the plane spanned
     by root-to-target and the pole, which is what decides that knees go
     forward and elbows back rather than wherever the maths lands. */
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

  /* Second-order spring, slightly underdamped by default so the body
     overshoots and settles the way mass does rather than sliding to a stop. */
  function spring(st, key, target, omega, zeta, dt) {
    var k = key + 'V';
    if (st[k] === undefined) st[k] = 0;
    st[k] += (omega * omega * (target - st[key]) - 2 * zeta * omega * st[k]) * dt;
    st[key] += st[k] * dt;
  }
  function angDamp(cur, target, rate, dt) {
    var d = ((target - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return cur + U.clamp(d, -rate * dt, rate * dt);
  }

  /* Winter's segment masses, expanded to an affine form that inverts, so the
     question "where may the hips be for the centre of mass to stay over his
     feet?" has a closed answer — which is what standing up amounts to.
       com = 0.855 hip + 0.427 lean + 0.145 feetMid   (coefficients sum to 1) */
  var COM_HIP = P.mHAT * 0.37 + 2 * P.mLeg * 0.55 + P.mHAT * 0.63;
  var COM_LEAN = P.mHAT * 0.63;
  var COM_FEET = 2 * P.mLeg * 0.45;

  function Body(H, seed) {
    this.H = H;
    this.n = [];
    for (var i = 0; i < 8; i++) this.n.push(new U.Noise1D((seed || 1234) + i * 7919, 256));
    this.pos = v(0, 0, 0);          /* ground position of the pelvis */
    this.want = v(0, 0, 0);         /* where it would like to be */
    this.vel = v(0, 0, 0);
    this.yaw = 0;
    this.yOff = 0; this.vy = 0;
    this.state = 'ground'; this.stateT = 0;
    this.action = null; this.actionT = 0;
    this.held = null; this.target = null;
    this.reach = null;              /* {side, point, tight, effort} */
    this.time = 0; this.dt = 1 / 60;
    this.gaitPhase = 0; this.lock = 0;
    this.stance = 0.065;
    this.ctl = { moveTo: null, moveDir: null, home: null, run: false, crouch: 0, faceTo: null };
    this.s = {
      crouch: 0.05, leanF: 0.05, leanS: 0, twist: 0, pelvisTwist: 0,
      headYaw: 0, headPitch: 0, girdle: 0, weight: 0, weightCmd: 0,
      breath: 0, exert: 0,
      armL: { x: 0, y: 0, z: 0, xV: 0, yV: 0, zV: 0, set: false },
      armR: { x: 0, y: 0, z: 0, xV: 0, yV: 0, zV: 0, set: false }
    };
    this.feet = [
      { side: -1, x: -0.065 * H, z: 0, state: 'plant', t: 0, fx: 0, fz: 0, tx: 0, tz: 0, lift: 0, roll: 0, yaw: 0 },
      { side: 1, x: 0.065 * H, z: 0, state: 'plant', t: 0, fx: 0, fz: 0, tx: 0, tz: 0, lift: 0, roll: 0, yaw: 0 }
    ];
    this.handVel = v(0, 0, 0);
    this.prevHand = null;
    this.stepPhase = 0;
  }

  Body.prototype.fwd = function () { return v(Math.sin(this.yaw), 0, Math.cos(this.yaw)); };
  Body.prototype.right = function () { return v(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); };
  Body.prototype.jump = function () { if (this.state === 'ground') { this.state = 'jumpCrouch'; this.stateT = 0; } };
  Body.prototype.startThrow = function () { if (this.held && !this.action) { this.action = 'throw'; this.actionT = 0; } };
  Body.prototype.startPickup = function (o) { if (!this.held && !this.action) { this.action = 'pickup'; this.actionT = 0; this.target = o; } };

  /* ---- where he wants to be, and the stepping that follows from it ---- */
  Body.prototype.locomote = function (dt) {
    var H = this.H, feet = this.feet, ctl = this.ctl;
    var top = (ctl.run ? RUN : WALK) * H;
    /* A held direction (keyboard, stick) drives velocity straight; a tapped
       destination is chased until he arrives. */
    var steer = ctl.moveDir && (ctl.moveDir.x || ctl.moveDir.z) ? ctl.moveDir : null;
    if (steer) {
      ctl.moveTo = null;
      this.want = v(this.pos.x, 0, this.pos.z);
    } else if (ctl.moveTo) {
      var d = v(ctl.moveTo.x - this.pos.x, 0, ctl.moveTo.z - this.pos.z);
      if (len(d) > 0.12 * H) this.want = v(ctl.moveTo.x, 0, ctl.moveTo.z);
      else { ctl.moveTo = null; this.want = v(this.pos.x, 0, this.pos.z); }
    }
    else if (ctl.home) {
      /* no errand, but drift towards a preferred spot — people square up to
         what they are doing long before they have to */
      var lam = 1 - Math.exp(-0.8 * dt);
      this.want = v(U.lerp(this.want.x, ctl.home.x, lam), 0, U.lerp(this.want.z, ctl.home.z, lam));
    }
    var toWant = v(this.want.x - this.pos.x, 0, this.want.z - this.pos.z);
    var wl = len(toWant);
    var wantVel = steer ? mul(norm(v(steer.x, 0, steer.z)), top)
      : (wl > 0.02 * H ? mul(norm(toWant), Math.min(top, wl * 2.4)) : v(0, 0, 0));
    if (this.state !== 'ground') wantVel = v(this.vel.x, 0, this.vel.z);
    var acc = (this.state === 'ground' ? 4.2 : 0.35) * H;
    var dv = sub(wantVel, this.vel), dvl = len(dv);
    if (dvl > acc * dt) dv = mul(dv, acc * dt / dvl);
    this.vel = add(this.vel, dv);
    if (this.state === 'ground' && len(wantVel) < 1e-3) this.vel = mul(this.vel, Math.exp(-6 * dt));
    this.pos = add(this.pos, mul(this.vel, dt));

    var speed = len(this.vel);
    var faceT = this.ctl.faceTo !== null && this.ctl.faceTo !== undefined ? this.ctl.faceTo
      : (speed > 0.06 * H ? Math.atan2(this.vel.x, this.vel.z) : null);
    if (faceT !== null) this.yaw = angDamp(this.yaw, faceT, TURN, dt);

    var fwd = this.fwd(), rgt = this.right();
    if (this.state !== 'ground') {
      for (var i = 0; i < 2; i++) {
        var fa = feet[i];
        fa.state = 'air';
        var home = add(this.pos, add(mul(rgt, fa.side * this.stance * H), mul(fwd, -0.02 * H)));
        fa.x = U.damp(fa.x, home.x, 9, dt); fa.z = U.damp(fa.z, home.z, 9, dt);
        fa.lift = U.damp(fa.lift, 0.11 * H, 8, dt);
        fa.roll = U.damp(fa.roll, 0.5, 6, dt);
        fa.yaw = angDamp(fa.yaw, this.yaw, 6, dt);
      }
      this.stepPhase = 0;
      return;
    }

    var running = speed > 1.25 * H;
    if (speed > 0.12 * H) {
      /* Travelling: a rhythmic gait whose cadence and stride follow speed. The
         duty factor falls below a half into a flight phase, which is what
         running is. */
      var cadence = U.lerp(1.75, 3.05, U.clamp(speed / (RUN * H), 0, 1));
      var duty = running ? 0.36 : 0.62;
      var stride = speed / cadence;
      this.gaitPhase = (this.gaitPhase + dt * cadence) % 1;
      for (var j = 0; j < 2; j++) {
        var f = feet[j];
        var local = (this.gaitPhase + (j === 0 ? 0 : 0.5)) % 1;
        if (local >= duty) {
          var u = (local - duty) / (1 - duty);
          if (f.state !== 'swing') {
            f.state = 'swing'; f.fx = f.x; f.fz = f.z;
            /* capture point: land under where the hips will be, plus half a
               stride along the heading */
            var land = add(this.pos, add(mul(this.vel, (1 - duty) / cadence * 0.5),
              add(mul(fwd, stride * 0.5), mul(rgt, f.side * this.stance * H))));
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
      this.stepPhase = Math.sin(this.gaitPhase * TAU);
      this.s.weightCmd = 0;
    } else {
      /* Standing: step only when staying put stops working, with a weight
         transfer onto the other foot first — the adjustment everybody makes
         and nobody notices making. */
      this.gaitPhase = 0;
      this.lock = Math.max(0, this.lock - dt);
      var busy = feet[0].state !== 'plant' || feet[1].state !== 'plant';
      if (!busy && this.lock <= 0) {
        var which = null, wantP = null, best = 0.155 * H;
        for (var q = 0; q < 2; q++) {
          var ideal = add(this.want, mul(rgt, feet[q].side * this.stance * H));
          var err = Math.hypot(ideal.x - feet[q].x, ideal.z - feet[q].z);
          if (err > best) { best = err; which = q; wantP = ideal; }
        }
        if (which !== null) {
          var f2 = feet[which], other = feet[1 - which];
          /* land a natural stance from the planted foot, on the right side of
             it: feet that cross or drift apart read as a glitch */
          var rel = sub(v(wantP.x, 0, wantP.z), v(other.x, 0, other.z));
          var lat = U.clamp(dot(rel, rgt) * f2.side, 0.075 * H, 0.215 * H) * f2.side;
          var fore = U.clamp(dot(rel, fwd), -0.22 * H, 0.22 * H);
          var land2 = add(v(other.x, 0, other.z), add(mul(rgt, lat), mul(fwd, fore)));
          f2.state = 'preload'; f2.t = 0;
          f2.fx = f2.x; f2.fz = f2.z; f2.tx = land2.x; f2.tz = land2.z;
          this.s.weightCmd = -f2.side;
        }
      }
      for (var r = 0; r < 2; r++) {
        var fs = feet[r];
        if (fs.state === 'preload') {
          fs.t += dt;
          fs.roll = U.lerp(fs.roll, 0.6, Math.min(1, dt * 8));
          if (fs.t >= PRELOAD) { fs.state = 'swing'; fs.t = 0; }
        } else if (fs.state === 'swing') {
          fs.t += dt;
          var uu = U.clamp(fs.t / SWING, 0, 1), mm = U.smootherstep(0, 1, uu);
          fs.x = U.lerp(fs.fx, fs.tx, mm); fs.z = U.lerp(fs.fz, fs.tz, mm);
          fs.lift = Math.sin(uu * Math.PI) * 0.05 * H;
          fs.roll = U.lerp(0.9, -0.8, mm);
          if (uu >= 1) {
            fs.state = 'plant'; fs.t = 0; fs.x = fs.tx; fs.z = fs.tz; fs.lift = 0;
            this.s.weightCmd = 0; this.lock = LOCK;
          }
        } else fs.roll = U.damp(fs.roll, 0, 6, dt);
        fs.yaw = angDamp(fs.yaw, this.yaw, 5, dt);
      }
      this.stepPhase = feet[0].state === 'swing' ? -feet[0].t / SWING
        : (feet[1].state === 'swing' ? feet[1].t / SWING : 0);
    }
  };

  Body.prototype.vertical = function (dt) {
    var H = this.H;
    this.stateT += dt;
    var crouchT = this.ctl.crouch + (this.autoCrouch || 0);
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
    spring(this.s, 'crouch', U.clamp(crouchT + this.reachCrouch, -0.1, 1),
      this.state === 'ground' ? 9 : 17, 0.92, dt);
  };

  /* Hand targets live in body-local coordinates (right, up, forward), so
     translating or turning can never drag the arms behind the shoulders. */
  Body.prototype.arms = function (dt) {
    var H = this.H, s = this.s, self = this;
    var shoulderH = (P.shoulderY - s.crouch * P.crouchMax) * H + this.yOff;
    this.chest = v(this.pos.x, shoulderH, this.pos.z);
    var fwd = this.fwd(), rgt = this.right();
    function toLocal(p) {
      var d = sub(p, self.chest);
      return { x: dot(d, rgt), y: d.y, z: dot(d, fwd) };
    }
    this.toWorld = function (l) {
      return v(self.chest.x + rgt.x * l.x + fwd.x * l.z, self.chest.y + l.y,
        self.chest.z + rgt.z * l.x + fwd.z * l.z);
    };

    var speed = len(this.vel) / (RUN * H);
    var swing = Math.sin(this.gaitPhase * TAU) * U.clamp(speed, 0, 1) * 0.20 * H;
    var tL = { x: -0.15 * H, y: -0.30 * H, z: -swing };
    var tR = { x: 0.15 * H, y: -0.30 * H, z: swing };
    tL.x += this.n[1].fbm(this.time * 0.13) * 0.025 * H;
    tR.x += this.n[2].fbm(this.time * 0.12 + 4) * 0.025 * H;
    tL.y += this.n[3].fbm(this.time * 0.11) * 0.022 * H;
    tR.y += this.n[4].fbm(this.time * 0.10 + 7) * 0.022 * H;
    var k = 26, c = 9;
    /* The crouch the pickup needs is the body's own business; ctl.crouch is
       the controller's. Writing the first into the second means anything a
       consumer sets is silently wiped on the next frame. */
    if (this.action !== 'pickup') this.autoCrouch = 0;

    if (this.action === 'throw') {
      /* hips, then trunk, then the arm: a throw is a chain, not a hinge */
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
        if (flat(o.pos, this.pos) > 0.34 * H) {
          var dir = norm(v(o.pos.x - this.pos.x, 0, o.pos.z - this.pos.z));
          this.ctl.moveTo = { x: o.pos.x - dir.x * 0.26 * H, z: o.pos.z - dir.z * 0.26 * H };
        }
        tR = toLocal(o.pos); k = 110; c = 19;
        this.autoCrouch = U.clamp((0.55 * H - o.pos.y) / (0.5 * H), 0, 0.8);
        var hw = this.handWorld('R');
        if (hw && len(sub(hw, o.pos)) < 0.11 * H) {
          this.held = o; o.held = true; this.action = null; this.autoCrouch = 0;
        }
        if (this.actionT > 5) { this.action = null; this.autoCrouch = 0; }
      } else this.action = null;
    } else if (this.held) {
      tR = { x: 0.15 * H, y: -0.20 * H, z: 0.13 * H };
    } else if (this.reach) {
      var rl = toLocal(this.reach.point);
      if (this.reach.side === 'L') tL = rl; else tR = rl;
      k = U.lerp(46, 300, this.reach.tight || 0.5);
      c = U.lerp(10.5, 33, this.reach.tight || 0.5);
      if (this.reach.second) {
        var sl = toLocal(this.reach.second);
        if (this.reach.side === 'L') tR = sl; else tL = sl;
      }
    }

    if (this.state !== 'ground' && this.state !== 'land' && !this.held && this.action !== 'throw' && !this.reach) {
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

    var w = this.handWorld(this.reach ? this.reach.side : 'R');
    if (w && this.prevHand) this.handVel = mul(sub(w, this.prevHand), 1 / Math.max(dt, 1e-4));
    this.prevHand = w;
    if (this.held) this.held.pos = this.handWorld('R');
  };

  Body.prototype.handWorld = function (side) {
    var a = side === 'L' ? this.s.armL : this.s.armR;
    if (!a.set || !this.toWorld) return null;
    return this.toWorld(a);
  };

  Body.prototype.release = function () {
    var o = this.held;
    if (!o) return;
    o.held = false;
    o.vel = mul(this.handVel, 0.95);
    this.held = null;
  };

  /* Reaching: how much of the deficit the arm cannot cover has to be found by
     leaning, sitting down into it, or standing somewhere else. */
  Body.prototype.reachSolve = function (dt) {
    var H = this.H, s = this.s;
    this.reachCrouch = 0;
    if (!this.reach) { spring(s, 'leanS', 0, 7, 0.8, dt); return; }
    var effort = this.reach.effort === undefined ? 0.5 : this.reach.effort;
    var side = this.reach.side === 'L' ? -1 : 1;
    var fwd = this.fwd(), rgt = this.right();
    var shoulder = add(this.chest || v(this.pos.x, P.shoulderY * H, this.pos.z), mul(rgt, side * P.shoulderHalf * H));
    var d = sub(this.reach.point, shoulder);
    var deficit = Math.max(0, len(d) - ARM * H * U.lerp(0.90, 0.82, effort));
    var dir = norm(d);
    var torso = TORSO * H;
    var needR = dot(dir, rgt) * deficit, needF = dot(dir, fwd) * deficit, needY = dir.y * deficit;

    this.reachCrouch = U.clamp(-needY / (P.crouchMax * H), 0, 1);
    spring(s, 'leanS', U.clamp(Math.asin(U.clamp(needR / torso, -1, 1)), -P.sideMax, P.sideMax), 7.5, 0.72, dt);
    spring(s, 'twist', U.clamp(needR / (torso * 1.6), -0.5, 0.5) * (0.4 + 0.6 * effort), 7.5, 0.7, dt);
    spring(s, 'girdle', U.clamp((this.reach.point.y - shoulder.y) / (0.35 * H) + 0.5, 0, 1), 8, 0.8, dt);
    this.reachLeanF = U.clamp(Math.asin(U.clamp(needF / torso, -1, 1)), -0.1, P.leanMax);
    /* What the lean cannot cover becomes pressure to stand somewhere else.
       This tracks rather than integrates: accumulating the residual lets the
       wanted position run away from him, and he shuffles after it all day. */
    var residual = needR - torso * Math.sin(s.leanS);
    var tgt = add(v(this.pos.x, 0, this.pos.z), mul(rgt, residual));
    var lam = Math.min(1, dt * 1.6);
    this.want = v(U.lerp(this.want.x, tgt.x, lam), 0, U.lerp(this.want.z, tgt.z, lam));
  };

  Body.prototype.step = function (dt) {
    this.dt = dt; this.time += dt;
    var H = this.H, s = this.s;
    this.reachCrouch = this.reachCrouch || 0;
    this.locomote(dt);
    this.vertical(dt);

    var speed = len(this.vel) / (RUN * H);
    var leanT = 0.05 + speed * 0.26 + s.crouch * 0.5 + (this.reachLeanF || 0);
    spring(s, 'leanF', leanT, 7.5, 0.8, dt);
    if (this.action !== 'throw' && !this.reach) spring(s, 'twist', 0, 6, 0.8, dt);
    s.pelvisTwist = U.damp(s.pelvisTwist, -s.twist * 0.4 + this.stepPhase * speed * 0.18, 8, dt);
    s.exert = U.damp(s.exert, Math.max(speed, this.reach ? (this.reach.effort || 0) * 0.5 : 0),
      speed > s.exert ? 1.4 : 0.3, dt);
    s.breath += dt * (0.62 + s.exert * 1.1) * TAU;
    var swinging = this.feet[0].state !== 'plant' ? 1 : (this.feet[1].state !== 'plant' ? -1 : 0);
    var idle = this.n[0].fbm(this.time * 0.09, 2) * 0.75;
    var wTarget = s.weightCmd !== 0 ? s.weightCmd : (swinging || (speed < 0.03 ? idle : 0));
    s.weight = U.damp(s.weight, wTarget, swinging || s.weightCmd ? 8 : 1.1, dt);

    this.arms(dt);
    this.reachSolve(dt);

    /* balance: the pelvis may lean past the feet a little and no further */
    var feetMid = v((this.feet[0].x + this.feet[1].x) * 0.5, 0, (this.feet[0].z + this.feet[1].z) * 0.5);
    var rgt = this.right();
    var leanDX = Math.sin(s.leanS) * TORSO * H;
    var axis = function (p) { return dot(sub(p, feetMid), rgt); };
    var f0 = axis(v(this.feet[0].x, 0, this.feet[0].z)), f1 = axis(v(this.feet[1].x, 0, this.feet[1].z));
    var lo = Math.min(f0, f1) + 0.030 * H, hi = Math.max(f0, f1) - 0.030 * H;
    if (lo > hi) { var mid = (lo + hi) * 0.5; lo = hi = mid; }
    var cur = axis(this.pos);
    var com = COM_HIP * cur + COM_LEAN * leanDX;
    if (com < lo) cur += (lo - com) / COM_HIP;
    else if (com > hi) cur -= (com - hi) / COM_HIP;
    var corr = cur - axis(this.pos);
    if (corr) this.pos = add(this.pos, mul(rgt, corr));

    var look = this.reach ? this.reach.point : null;
    var lookYaw = 0, lookPitch = 0;
    if (look) {
      var lf = this.fwd();
      var dl = sub(look, this.chest || this.pos);
      lookYaw = U.clamp(dot(dl, rgt) / (0.45 * H), -1.1, 1.1) * 0.7;
      lookPitch = U.clamp(dl.y / (0.5 * H), -0.42, 0.42);
      void lf;
    } else {
      lookYaw = this.n[5].fbm(this.time * 0.08, 2) * 0.3;
      lookPitch = (this.ctl.crouch + (this.autoCrouch || 0)) * 0.4 + speed * 0.1;
    }
    spring(s, 'headYaw', lookYaw, 12, 0.85, dt);
    spring(s, 'headPitch', lookPitch, 10, 0.85, dt);
  };

  Body.prototype.pose = function () {
    var H = this.H, s = this.s, feet = this.feet;
    var breath = Math.sin(s.breath) * (0.6 + s.exert * 0.9);
    var fwd = this.fwd(), rgt = this.right();

    var hipH = (P.hipY - s.crouch * P.crouchMax) * H + this.yOff + breath * 0.002 * H;
    if (this.state === 'ground' || this.state === 'land' || this.state === 'jumpCrouch') {
      /* no planted leg may over-extend, which dips the hips over a wide
         stance for free — the inverted pendulum, without modelling it */
      var legMax = LEG * H * 0.985;
      for (var i = 0; i < 2; i++) {
        var ankY = P.ankleY * H + feet[i].lift;
        var hp = add(this.pos, mul(rgt, feet[i].side * P.hipHalf * H));
        var fl = Math.hypot(hp.x - feet[i].x, hp.z - feet[i].z);
        hipH = Math.min(hipH, ankY + Math.sqrt(Math.max(0, legMax * legMax - fl * fl)));
      }
    }
    var pelvis = v(this.pos.x, hipH, this.pos.z);

    var seg = TORSO * H / 3, w = [0.46, 0.33, 0.21];
    var pts = [pelvis], cur = pelvis, af = 0, as = 0;
    for (var q = 0; q < 3; q++) {
      af += s.leanF * w[q]; as += s.leanS * w[q];
      var dir = norm(v(fwd.x * Math.sin(af) + rgt.x * Math.sin(as),
        Math.cos(af) * Math.cos(as), fwd.z * Math.sin(af) + rgt.z * Math.sin(as)));
      cur = add(cur, mul(dir, seg));
      pts.push(cur);
    }
    var chest = pts[3];
    var tw = s.twist;
    var shDir = v(rgt.x * Math.cos(tw) + fwd.x * Math.sin(tw), 0, rgt.z * Math.cos(tw) + fwd.z * Math.sin(tw));
    var lift = s.girdle * 0.03 * H;
    var shL = add(add(chest, mul(shDir, -P.shoulderHalf * H)), v(0, lift, 0));
    var shR = add(add(chest, mul(shDir, P.shoulderHalf * H)), v(0, lift, 0));

    var pt = s.pelvisTwist;
    var hipDir = v(rgt.x * Math.cos(pt) + fwd.x * Math.sin(pt), 0, rgt.z * Math.cos(pt) + fwd.z * Math.sin(pt));
    var obl = -s.weight * 0.018 * H;
    var hipL = add(add(pelvis, mul(hipDir, -P.hipHalf * H)), v(0, obl, 0));
    var hipR = add(add(pelvis, mul(hipDir, P.hipHalf * H)), v(0, -obl, 0));

    var ankL = v(feet[0].x, P.ankleY * H + feet[0].lift + Math.max(0, this.yOff), feet[0].z);
    var ankR = v(feet[1].x, P.ankleY * H + feet[1].lift + Math.max(0, this.yOff), feet[1].z);

    var abd = 0.22 + s.crouch * 0.5;
    var kneeL = ik(hipL, ankL, P.thigh * H, P.shank * H, norm(add(fwd, mul(rgt, -abd))), P.kneeMin * H);
    var kneeR = ik(hipR, ankR, P.thigh * H, P.shank * H, norm(add(fwd, mul(rgt, abd))), P.kneeMin * H);

    var handL = this.handWorld('L') || add(shL, v(0, -0.3 * H, 0));
    var handR = this.handWorld('R') || add(shR, v(0, -0.3 * H, 0));
    var poleL = norm(add(mul(fwd, -1), add(v(0, -0.6, 0), mul(rgt, -0.45))));
    var poleR = norm(add(mul(fwd, -1), add(v(0, -0.6, 0), mul(rgt, 0.45))));
    var elbL = ik(shL, handL, P.upperArm * H, P.foreArm * H, poleL, P.elbowMin * H);
    var elbR = ik(shR, handR, P.upperArm * H, P.foreArm * H, poleR, P.elbowMin * H);

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
      state: this.state, speed: len(this.vel), crouch: s.crouch,
      headYawN: s.headYaw, leanS: s.leanS, stepPhase: this.stepPhase
    };
  };

  C.rig = {
    P: P, TORSO: TORSO, LEG: LEG, ARM: ARM,
    G: G, WALK: WALK, RUN: RUN, JUMP_V: JUMP_V,
    v: v, add: add, sub: sub, mul: mul, len: len, norm: norm, dot: dot,
    ik: ik, spring: spring, angDamp: angDamp, Body: Body,
    lerp: function (a, b, t) { return v(U.lerp(a.x, b.x, t), U.lerp(a.y, b.y, t), U.lerp(a.z, b.z, t)); },
    COM: { HIP: COM_HIP, LEAN: COM_LEAN, FEET: COM_FEET }
  };
})(typeof window !== 'undefined' ? window : globalThis);
