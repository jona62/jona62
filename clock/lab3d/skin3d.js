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

  /* radius profiles: [t along the limb, half-width in H] */
  var ARM = [[0, 0.055], [0.12, 0.049], [0.34, 0.040], [0.50, 0.036], [0.62, 0.039], [0.84, 0.030], [1, 0.024]];
  var LEG = [[0, 0.060], [0.16, 0.066], [0.42, 0.052], [0.52, 0.047], [0.66, 0.055], [0.88, 0.034], [1, 0.028]];
  var HIPS = [[0, 0.055], [0.20, 0.096], [0.55, 0.103], [1, 0.094]];
  var SLEEVE = [[0, 0.060], [0.45, 0.053], [0.85, 0.048], [1, 0.044]];
  var TORSO = [[0, 0.082], [0.16, 0.086], [0.42, 0.098], [0.70, 0.112], [0.88, 0.113], [1, 0.094]];
  var FOOT = [[0, 0.030], [0.25, 0.042], [0.72, 0.040], [1, 0.024]];

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
  Loft.prototype.set = function (points, tbl, H, right, squash, scale) {
    var rings = this.rings, seg = this.seg, pos = this.pos;
    var sq = squash === undefined ? 0.92 : squash;
    var sc = scale === undefined ? 1 : scale;
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
      for (var s = 0; s < seg; s++) {
        var a = s / seg * Math.PI * 2;
        var ca = Math.cos(a) * rad, sa = Math.sin(a) * rad * sq;
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
    loft('torso', 8, 16, this.m.shirt, true, false);
    loft('armL', 10, 12, this.m.skin, true, true);
    loft('armR', 10, 12, this.m.skin, true, true);
    loft('sleeveL', 6, 12, this.m.shirt, false, true);
    loft('sleeveR', 6, 12, this.m.shirt, false, true);
    loft('legL', 11, 12, this.m.trouser, true, true);
    loft('legR', 11, 12, this.m.trouser, true, true);
    loft('footL', 5, 10, this.m.shoe, true, true);
    loft('footR', 5, 10, this.m.shoe, true, true);
    loft('neck', 4, 10, this.m.skin, false, false);

    /* the head is built once and carried about */
    var head = new THREE.SphereGeometry(P().headRy * H, 22, 16);
    var a = head.attributes.position;
    for (var i = 0; i < a.count; i++) {
      var x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      var t = U.clamp((y / (P().headRy * H) + 1) * 0.5, 0, 1);
      /* narrow the jaw, deepen the cranium, flatten the face plane slightly */
      var w = U.lerp(0.80, 1.02, U.smoothstep(0, 0.65, t));
      var dpt = U.lerp(0.94, 1.12, U.smoothstep(0.1, 0.9, t));
      a.setX(i, x * w * 0.96);
      a.setZ(i, z * dpt * (z > 0 ? 0.94 : 1.06));
      a.setY(i, y * 1.06 - (1 - t) * 0.012 * H);
    }
    head.computeVertexNormals();
    this.head = new THREE.Mesh(head, this.m.skin);
    this.head.castShadow = true;
    this.group.add(this.head);

    var capG = new THREE.SphereGeometry(P().headRy * H * 1.04, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.cap = new THREE.Mesh(capG, this.m.cap);
    this.cap.castShadow = true;
    this.cap.scale.set(1.04, 0.92, 1.08);
    this.group.add(this.cap);
    var peakG = new THREE.CylinderGeometry(P().headRy * H * 0.98, P().headRy * H * 0.98, 0.012 * H, 18, 1, false, -0.9, 1.8);
    this.peak = new THREE.Mesh(peakG, this.m.cap);
    this.peak.scale.set(1, 1, 1.5);
    this.peak.castShadow = true;
    this.group.add(this.peak);

    var earG = new THREE.SphereGeometry(0.016 * H, 8, 6);
    this.earL = new THREE.Mesh(earG, this.m.skin);
    this.earR = new THREE.Mesh(earG, this.m.skin);
    this.earL.scale.set(0.5, 1.2, 0.9); this.earR.scale.set(0.5, 1.2, 0.9);
    this.group.add(this.earL); this.group.add(this.earR);

    var handG = new THREE.SphereGeometry(0.030 * H, 10, 8);
    this.handL = new THREE.Mesh(handG, this.m.skin);
    this.handR = new THREE.Mesh(handG, this.m.skin);
    this.handL.scale.set(1, 0.78, 0.62); this.handR.scale.set(1, 0.78, 0.62);
    this.handL.castShadow = this.handR.castShadow = true;
    this.group.add(this.handL); this.group.add(this.handR);

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
    var below = V.add(p.pelvis, { x: 0, y: -0.10 * H, z: 0 });
    this.hips.set([below, V.lerp(below, p.pelvis, 0.6), p.pelvis, sp[1]], HIPS, H, right, 0.88);
    this.torso.set([V.lerp(p.pelvis, sp[1], 0.35), sp[1], sp[2], p.chest], TORSO, H, right, 0.74, 1);

    this.armL.set([V.lerp(p.shL, p.chest, 0.22), p.elbL, p.handL], ARM, H, right, 0.94);
    this.armR.set([V.lerp(p.shR, p.chest, 0.22), p.elbR, p.handR], ARM, H, right, 0.94);
    this.sleeveL.set([V.lerp(p.shL, p.chest, 0.18), V.lerp(p.shL, p.elbL, 0.35),
      V.lerp(p.shL, p.elbL, 0.66)], SLEEVE, H, right, 0.94);
    this.sleeveR.set([V.lerp(p.shR, p.chest, 0.18), V.lerp(p.shR, p.elbR, 0.35),
      V.lerp(p.shR, p.elbR, 0.66)], SLEEVE, H, right, 0.94);
    /* start each leg above its own hip joint, so the top ring is inside the
       pelvis rather than poking out of the front of it */
    this.legL.set([V.add(p.hipL, { x: 0, y: 0.045 * H, z: 0 }), p.kneeL, p.ankL], LEG, H, right, 0.96);
    this.legR.set([V.add(p.hipR, { x: 0, y: 0.045 * H, z: 0 }), p.kneeR, p.ankR], LEG, H, right, 0.96);

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

    var headBase = V.add(p.head, V.mul(p.headUp, -0.058 * H));
    this.neck.set([V.add(p.chest, { x: 0, y: -0.01 * H, z: 0 }), p.neck, headBase], [[0, 0.050], [0.5, 0.040], [1, 0.037]], H, right, 0.92);

    var hq = { x: Math.sin(p.yaw), y: 0, z: Math.cos(p.yaw) };
    this.orient(this.head, p.headUp, { x: Math.cos(p.yaw), y: 0, z: -Math.sin(p.yaw) }, p.head);
    this.orient(this.cap, p.headUp, { x: Math.cos(p.yaw), y: 0, z: -Math.sin(p.yaw) },
      V.add(p.head, V.mul(p.headUp, 0.004 * H)));
    this.orient(this.peak, p.headUp, { x: Math.cos(p.yaw), y: 0, z: -Math.sin(p.yaw) },
      V.add(V.add(p.head, V.mul(p.headUp, 0.030 * H)), V.mul(hq, 0.040 * H)));
    var ear = { x: Math.cos(p.yaw), y: 0, z: -Math.sin(p.yaw) };
    this.earL.position.set(p.head.x - ear.x * 0.062 * H, p.head.y - 0.004 * H, p.head.z - ear.z * 0.062 * H);
    this.earR.position.set(p.head.x + ear.x * 0.062 * H, p.head.y - 0.004 * H, p.head.z + ear.z * 0.062 * H);

    var handOrient = function (mesh, wrist, elbow) {
      var up = V.norm(V.sub(wrist, elbow));
      self.orient(mesh, up, right, V.add(wrist, V.mul(up, 0.016 * H)));
    };
    handOrient(this.handL, p.handL, p.elbL);
    handOrient(this.handR, p.handR, p.elbR);
    void fwd;
  };

  Skin.prototype.setSkeleton = function (on) {
    var keys = ['hips', 'torso', 'armL', 'armR', 'sleeveL', 'sleeveR', 'legL', 'legR', 'footL', 'footR', 'neck'];
    for (var i = 0; i < keys.length; i++) {
      var m = this[keys[i]].mesh.material;
      m.transparent = on; m.opacity = on ? 0.3 : 1;
    }
    [this.head, this.cap, this.peak, this.handL, this.handR, this.earL, this.earR].forEach(function (x) {
      x.material.transparent = on; x.material.opacity = on ? 0.3 : 1;
    });
  };

  C.Skin3D = Skin;
})(typeof window !== 'undefined' ? window : globalThis);
