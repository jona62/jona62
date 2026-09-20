/* A body, not an assembly.
 *
 * Cylinders meeting at spheres is what made the last version read as a robot:
 * every joint was a visible seam between two hard-edged primitives, and every
 * limb had one thickness from end to end. Here each limb is a single lofted
 * surface — rings of vertices swept along a smooth curve through the joints,
 * with an elliptical section whose radius follows an anatomical profile — so
 * the elbow is a bend in a continuous arm rather than a ball between two
 * tubes. The torso is one loft from hips to trapezius, so shoulders slope into
 * the neck instead of being bolted on.
 *
 * Ring frames are carried from the body's own right vector rather than from a
 * shortest-arc rotation, which stops the section spinning about the limb as it
 * swings — the usual cause of a subtle, hard-to-place wrongness.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;

  /* Radius profiles: [t along the limb, half-width as a fraction of stature].
   *
   * These are radii, not widths, and they come from girths rather than being
   * eyeballed: an upper arm is about a 32 cm circumference, so a 10 cm
   * diameter, so 0.029 H of radius. Guessing these produces a body that is
   * roughly 1.7x too thick everywhere, which reads as inflated no matter how
   * good the proportions between the joints are.
   *
   * Every limb starts at a pinhole and opens to full width a tenth of the way
   * along, so the root ring is a disc small enough to vanish inside the trunk
   * while the limb reaches its real thickness before it emerges.
   */
  var ARM = [[0, 0.014], [0.09, 0.032], [0.20, 0.030], [0.34, 0.027], [0.50, 0.024], [0.62, 0.027], [0.84, 0.020], [1, 0.016]];
  var SLEEVE = [[0, 0.022], [0.12, 0.039], [0.50, 0.036], [0.85, 0.033], [1, 0.031]];
  var LEG = [[0, 0.018], [0.10, 0.054], [0.24, 0.050], [0.46, 0.040], [0.56, 0.035], [0.68, 0.040], [0.88, 0.026], [1, 0.021]];
  var HIPS = [[0, 0.040], [0.22, 0.086], [0.58, 0.096], [1, 0.088]];
  /* The torso carries the shoulder line: stop it at the chest and the shoulder
     joint, 0.129 H out, floats clear of the ribcage with nothing under the
     sleeve — which is what puts a man in shoulder pads. */
  var TORSO = [[0, 0.076], [0.13, 0.081], [0.36, 0.089], [0.58, 0.095], [0.78, 0.100], [0.90, 0.097], [1, 0.070]];
  var NECK = [[0, 0.046], [0.5, 0.036], [1, 0.033]];
  var FOOT = [[0, 0.022], [0.25, 0.033], [0.72, 0.031], [1, 0.018]];

  /* A head is not a sphere: the jaw is narrow, the cheekbones are the widest
     point, the cranium is deeper than it is wide, and the cross-section sits
     forward of the axis at the chin and behind it at the crown. Width and
     depth need separate profiles, and the rings need an offset. */
  var HEAD_W = [[0, 0.030], [0.16, 0.046], [0.38, 0.059], [0.60, 0.064], [0.82, 0.056], [1, 0.026]];
  var HEAD_D = [[0, 0.030], [0.16, 0.044], [0.38, 0.055], [0.60, 0.060], [0.82, 0.052], [1, 0.024]];
  var HEAD_S = [[0, 0.013], [0.30, 0.006], [0.60, -0.002], [1, -0.008]];
  /* a hand is a flattened paddle: thin across the palm, broad through it */
  var HAND_W = [[0, 0.011], [0.30, 0.015], [0.70, 0.014], [1, 0.009]];
  var HAND_D = [[0, 0.022], [0.35, 0.031], [0.75, 0.029], [1, 0.018]];

  function profile(tbl, t) {
    for (var i = 1; i < tbl.length; i++) {
      if (t <= tbl[i][0]) {
        var u = (t - tbl[i - 1][0]) / ((tbl[i][0] - tbl[i - 1][0]) || 1);
        return U.lerp(tbl[i - 1][1], tbl[i][1], U.smoothstep(0, 1, u));
      }
    }
    return tbl[tbl.length - 1][1];
  }

  /* Catmull-Rom through the joints, so a limb curves through its bend. */
  function spline(pts, t) {
    var n = pts.length - 1;
    var i = Math.min(n - 1, Math.floor(t * n));
    var f = t * n - i;
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    var f2 = f * f, f3 = f2 * f;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3),
      z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3)
    };
  }

  function Loft(THREE, rings, seg, material, capTop, capBot) {
    this.THREE = THREE;
    this.rings = rings; this.seg = seg;
    var count = rings * seg + 2;
    this.pos = new Float32Array(count * 3);
    var idx = [];
    for (var r = 0; r < rings - 1; r++) {
      for (var s = 0; s < seg; s++) {
        var a = r * seg + s, b = r * seg + (s + 1) % seg;
        var c = (r + 1) * seg + s, d = (r + 1) * seg + (s + 1) % seg;
        idx.push(a, c, b, b, c, d);
      }
    }
    var capA = rings * seg, capB = capA + 1;
    /* Caps are fans around a centre vertex. Wound both ways and drawn double
       sided: a loft whose end you can see into reads as a paper cut-out, and
       getting the winding wrong is silent — the triangles simply vanish. */
    if (capBot) {
      for (var s2 = 0; s2 < seg; s2++) idx.push(capA, s2, (s2 + 1) % seg);
    }
    if (capTop) {
      var base = (rings - 1) * seg;
      for (var s3 = 0; s3 < seg; s3++) idx.push(capB, base + (s3 + 1) % seg, base + s3);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  /* points: 2-4 joint positions. right: the body's right vector. squash: how
     much flatter the section is front-to-back than side-to-side. */
  Loft.prototype.set = function (points, tbl, H, right, squash, scale, opts) {
    var rings = this.rings, seg = this.seg, pos = this.pos;
    var sq = squash === undefined ? 0.92 : squash;
    var sc = scale === undefined ? 1 : scale;
    var depthTbl = opts && opts.depth, shiftTbl = opts && opts.shift;
    var prev = null, k = 0;
    for (var r = 0; r < rings; r++) {
      var t = r / (rings - 1);
      var c = spline(points, t);
      var ahead = spline(points, Math.min(1, t + 0.02));
      var back = spline(points, Math.max(0, t - 0.02));
      var tx = ahead.x - back.x, ty = ahead.y - back.y, tz = ahead.z - back.z;
      var tl = Math.hypot(tx, ty, tz) || 1e-6;
      tx /= tl; ty /= tl; tz /= tl;
      var rx = right.x, ry = right.y, rz = right.z;
      var d = rx * tx + ry * ty + rz * tz;
      rx -= tx * d; ry -= ty * d; rz -= tz * d;
      var rl = Math.hypot(rx, ry, rz);
      if (rl < 1e-5) { rx = 1; ry = 0; rz = 0; rl = 1; }
      rx /= rl; ry /= rl; rz /= rl;
      var fx = ry * tz - rz * ty, fy = rz * tx - rx * tz, fz = rx * ty - ry * tx;
      var rad = profile(tbl, t) * H * sc;
      var dep = depthTbl ? profile(depthTbl, t) * H * sc : rad * sq;
      if (shiftTbl) {
        var sh = profile(shiftTbl, t) * H * sc;
        c = { x: c.x + fx * sh, y: c.y + fy * sh, z: c.z + fz * sh };
      }
      for (var s = 0; s < seg; s++) {
        var a = s / seg * Math.PI * 2;
        var ca = Math.cos(a) * rad, sa = Math.sin(a) * dep;
        pos[k++] = c.x + rx * ca + fx * sa;
        pos[k++] = c.y + ry * ca + fy * sa;
        pos[k++] = c.z + rz * ca + fz * sa;
      }
      prev = c;
    }
    var first = spline(points, 0), lastp = spline(points, 1);
    pos[k++] = first.x; pos[k++] = first.y; pos[k++] = first.z;
    pos[k++] = lastp.x; pos[k++] = lastp.y; pos[k++] = lastp.z;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    void prev;
  };

  function Skin(THREE, H, pal) {
    this.THREE = THREE; this.H = H;
    this.group = new THREE.Group();
    var self = this;
    var mat = function (c, r) {
      return new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.82 : r,
        metalness: 0.02, side: THREE.DoubleSide });
    };
    this.m = { shirt: mat(pal.shirt), trouser: mat(pal.trouser), skin: mat(pal.skin, 0.72),
      cap: mat(pal.cap), shoe: mat('#24272e', 0.65) };

    function loft(name, rings, seg, material, capTop, capBot) {
      var l = new Loft(THREE, rings, seg, material, capTop, capBot);
      self.group.add(l.mesh);
      self[name] = l;
      return l;
    }
    loft('hips', 5, 14, this.m.trouser, false, true);
    loft('torso', 14, 18, this.m.shirt, true, false);
    loft('armL', 10, 12, this.m.skin, true, true);
    loft('armR', 10, 12, this.m.skin, true, true);
    loft('sleeveL', 6, 12, this.m.shirt, false, true);
    loft('sleeveR', 6, 12, this.m.shirt, false, true);
    loft('legL', 11, 12, this.m.trouser, true, true);
    loft('legR', 11, 12, this.m.trouser, true, true);
    loft('footL', 5, 10, this.m.shoe, true, true);
    loft('footR', 5, 10, this.m.shoe, true, true);
    loft('neck', 4, 10, this.m.skin, false, false);

    loft('headL', 12, 18, this.m.skin, true, true);
    loft('handLL', 6, 12, this.m.skin, true, true);
    loft('handRL', 6, 12, this.m.skin, true, true);

    var capG = new THREE.SphereGeometry(0.079 * H, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.60);
    this.cap = new THREE.Mesh(capG, this.m.cap);
    this.cap.castShadow = true;
    this.cap.scale.set(1.0, 0.92, 1.05);
    this.group.add(this.cap);
    var peakG = new THREE.CylinderGeometry(0.068 * H, 0.068 * H, 0.010 * H, 20, 1, false, -0.85, 1.7);
    this.peak = new THREE.Mesh(peakG, this.m.cap);
    this.peak.scale.set(1, 1, 1.02);
    this.peak.castShadow = true;
    this.group.add(this.peak);

    /* Joint masses at the shoulder and hip. A limb rooted at a fixed point
       inside the trunk tears away from it the moment the limb swings up,
       because the root stops being inside. These sit on the joint itself, in
       the colour of whatever covers it, and are swallowed by the torso and the
       limb from either side — a deltoid and a hip, doing the job an actual
       deltoid and hip do. */
    var jointBall = function (name, r, material, sx, sy, sz) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(r * H, 14, 10), material);
      m.castShadow = true;
      m.scale.set(sx, sy, sz);
      self.group.add(m);
      self[name] = m;
    };
    jointBall('deltL', 0.047, this.m.shirt, 1.02, 1.06, 0.92);
    jointBall('deltR', 0.047, this.m.shirt, 1.02, 1.06, 0.92);
    jointBall('hipBL', 0.044, this.m.trouser, 1, 1, 0.9);
    jointBall('hipBR', 0.044, this.m.trouser, 1, 1, 0.9);

    var earG = new THREE.SphereGeometry(0.014 * H, 8, 6);
    this.earL = new THREE.Mesh(earG, this.m.skin);
    this.earR = new THREE.Mesh(earG, this.m.skin);
    this.earL.scale.set(0.5, 1.2, 0.9); this.earR.scale.set(0.5, 1.2, 0.9);
    this.group.add(this.earL); this.group.add(this.earR);

    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
  }
  function P() { return C.rig.P; }

  Skin.prototype.orient = function (mesh, up, right, pos) {
    var T = this.THREE;
    var u = this._a.set(up.x, up.y, up.z).normalize();
    var r = this._b.set(right.x, right.y, right.z);
    r.addScaledVector(u, -r.dot(u));
    if (r.lengthSq() < 1e-8) r.set(1, 0, 0);
    r.normalize();
    var f = this._c.crossVectors(r, u).normalize();
    this._m.makeBasis(r, u, f);
    mesh.quaternion.setFromRotationMatrix(this._m);
    mesh.position.set(pos.x, pos.y, pos.z);
    void T;
  };

  Skin.prototype.update = function (p) {
    var H = this.H, V = C.rig;
    var yaw = p.bodyYaw;
    var right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    var fwd = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
    var sp = p.spine;

    /* hips taper into the crotch rather than ending in a flat skirt, and the
       shirt tucks inside them */
    var below = V.add(p.pelvis, { x: 0, y: -0.072 * H, z: 0 });
    this.hips.set([below, V.lerp(below, p.pelvis, 0.6), p.pelvis, sp[1]], HIPS, H, right, 0.88);
    /* The spine ends at the acromion line, so the trunk must carry a yoke of
       its own above it: stop the loft at the chest and the shoulder joint,
       0.129 H out, hangs off nothing and the sleeve reads as a pad. */
    this.torso.set([V.lerp(p.pelvis, sp[1], 0.35), sp[1], sp[2],
      V.lerp(p.pelvis, p.chest, 0.94), p.chest,
      V.add(p.chest, { x: 0, y: 0.028 * H, z: 0 })], TORSO, H, right, 0.74, 1);

    /* The humeral head is medial to the point of the shoulder, so hang the arm
       from inboard of the acromion — otherwise the sleeve and the deltoid stack
       outside it and he ends up in shoulder pads. */
    var rootL = V.lerp(p.shL, p.chest, 0.13), rootR = V.lerp(p.shR, p.chest, 0.13);
    this.armL.set([rootL, p.elbL, p.handL], ARM, H, right, 0.94);
    this.armR.set([rootR, p.elbR, p.handR], ARM, H, right, 0.94);
    /* tucked in and down from the acromion, so the sleeve is what you see */
    var dl = V.add(V.lerp(p.shL, p.chest, 0.12), { x: 0, y: -0.016 * H, z: 0 });
    var dr = V.add(V.lerp(p.shR, p.chest, 0.12), { x: 0, y: -0.016 * H, z: 0 });
    this.deltL.position.set(dl.x, dl.y, dl.z);
    this.deltR.position.set(dr.x, dr.y, dr.z);
    this.sleeveL.set([rootL, V.lerp(p.shL, p.elbL, 0.35), V.lerp(p.shL, p.elbL, 0.70)], SLEEVE, H, right, 0.94);
    this.sleeveR.set([rootR, V.lerp(p.shR, p.elbR, 0.35), V.lerp(p.shR, p.elbR, 0.70)], SLEEVE, H, right, 0.94);
    /* Limb roots sit *inside* the trunk — up and inboard of the joint — so the
       first ring is swallowed by the pelvis or the ribcage. Rooting a limb on
       the joint itself leaves a visible socket the moment the limb swings. */
    this.legL.set([V.add(p.hipL, { x: 0, y: 0.022 * H, z: 0 }), p.kneeL, p.ankL], LEG, H, right, 0.96);
    this.legR.set([V.add(p.hipR, { x: 0, y: 0.022 * H, z: 0 }), p.kneeR, p.ankR], LEG, H, right, 0.96);
    var hl = V.add(p.hipL, { x: 0, y: 0.014 * H, z: 0 });
    var hr = V.add(p.hipR, { x: 0, y: 0.014 * H, z: 0 });
    this.hipBL.position.set(hl.x, hl.y, hl.z);
    this.hipBR.position.set(hr.x, hr.y, hr.z);

    var self = this;
    var foot = function (l, ank, yawF, roll) {
      var d = { x: Math.sin(yawF), y: 0, z: Math.cos(yawF) };
      var heel = { x: ank.x - d.x * 0.045 * H, y: 0.024 * H + Math.max(0, ank.y - P().ankleY * H), z: ank.z - d.z * 0.045 * H };
      var toe = { x: ank.x + d.x * 0.105 * H, y: heel.y - roll * 0.012 * H, z: ank.z + d.z * 0.105 * H };
      var mid = { x: (heel.x + toe.x) * 0.5, y: heel.y + 0.004 * H, z: (heel.z + toe.z) * 0.5 };
      l.set([heel, mid, toe], FOOT, H, right, 0.78);
      void self;
    };
    foot(this.footL, p.ankL, p.footYawL, p.rollL);
    foot(this.footR, p.ankR, p.footYawR, p.rollR);

    var headBase = V.add(p.head, V.mul(p.headUp, -0.070 * H));
    this.neck.set([V.add(p.chest, { x: 0, y: -0.01 * H, z: 0 }), p.neck, headBase],
      NECK, H, right, 0.92);

    /* the head is a loft too, so it grows out of the neck rather than being a
       ball balanced on it, and turns with its own yaw */
    var hRight = { x: Math.cos(p.yaw), y: 0, z: -Math.sin(p.yaw) };
    var hq = { x: Math.sin(p.yaw), y: 0, z: Math.cos(p.yaw) };
    var chin = V.add(p.head, V.mul(p.headUp, -0.064 * H));
    var crown = V.add(p.head, V.mul(p.headUp, 0.072 * H));
    this.headL.set([chin, V.lerp(chin, crown, 0.5), crown], HEAD_W, H, hRight, 1,
      1, { depth: HEAD_D, shift: HEAD_S });

    this.orient(this.cap, p.headUp, hRight, V.add(p.head, V.mul(p.headUp, 0.024 * H)));
    this.orient(this.peak, p.headUp, hRight,
      V.add(V.add(p.head, V.mul(p.headUp, 0.038 * H)), V.mul(hq, 0.048 * H)));
    this.earL.position.set(p.head.x - hRight.x * 0.060 * H, p.head.y + 0.002 * H, p.head.z - hRight.z * 0.060 * H);
    this.earR.position.set(p.head.x + hRight.x * 0.060 * H, p.head.y + 0.002 * H, p.head.z + hRight.z * 0.060 * H);

    /* hands: flattened paddles along the forearm, tucked back into the wrist */
    var hand = function (l, wristP, elbowP) {
      var d = V.norm(V.sub(wristP, elbowP));
      var back = V.add(wristP, V.mul(d, -0.018 * H));
      var tip = V.add(wristP, V.mul(d, 0.082 * H));
      l.set([back, V.lerp(back, tip, 0.5), tip], HAND_W, H, right, 1, 1, { depth: HAND_D });
      void self;
    };
    hand(this.handLL, p.handL, p.elbL);
    hand(this.handRL, p.handR, p.elbR);
    void fwd;
  };

  Skin.prototype.setSkeleton = function (on) {
    var keys = ['hips', 'torso', 'armL', 'armR', 'sleeveL', 'sleeveR', 'legL', 'legR',
      'footL', 'footR', 'neck', 'headL', 'handLL', 'handRL'];
    for (var i = 0; i < keys.length; i++) {
      var m = this[keys[i]].mesh.material;
      m.transparent = on; m.opacity = on ? 0.3 : 1;
    }
    [this.cap, this.peak, this.earL, this.earR, this.deltL, this.deltR,
      this.hipBL, this.hipBR].forEach(function (x) {
      x.material.transparent = on; x.material.opacity = on ? 0.3 : 1;
    });
  };

  C.Skin3D = Skin;
})(typeof window !== 'undefined' ? window : globalThis);
