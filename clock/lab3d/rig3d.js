/* Geometry hung on the skeleton.
 *
 * The solve hands over joint positions, not rotations, so every bone is a
 * tapered cylinder stretched between two points. Orientation is built from an
 * explicit basis rather than a shortest-arc quaternion: the bone's own axis is
 * up, and the cross-section is aligned to the body's right, which is what lets
 * a limb have an elliptical section (a torso is not a tube) and keeps it from
 * spinning about its own length as it swings.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK;

  function Rig(THREE, H, pal) {
    this.THREE = THREE;
    this.H = H;
    this.group = new THREE.Group();
    this.parts = {};
    var self = this;

    var mat = function (color, rough) {
      return new THREE.MeshStandardMaterial({ color: color, roughness: rough === undefined ? 0.85 : rough, metalness: 0.02 });
    };
    this.m = {
      shirt: mat(pal.shirt), shirtDark: mat(pal.shirtDark), trouser: mat(pal.trouser),
      skin: mat(pal.skin, 0.75), cap: mat(pal.cap), shoe: mat('#24272e', 0.7)
    };

    function bone(name, rTop, rBot, material, seg) {
      var g = new THREE.CylinderGeometry(rTop * H, rBot * H, 1, seg || 14, 1, false);
      var m = new THREE.Mesh(g, material);
      m.castShadow = true;
      self.group.add(m);
      self.parts[name] = m;
      return m;
    }
    function ball(name, r, material) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(r * H, 16, 12), material);
      m.castShadow = true;
      self.group.add(m);
      self.parts[name] = m;
      return m;
    }
    function box(name, w, h, d, material) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w * H, h * H, d * H), material);
      m.castShadow = true;
      self.group.add(m);
      self.parts[name] = m;
      return m;
    }

    /* trunk: three stacked sections so bending shows as a back, not a hinge */
    bone('pelvis', 0.092, 0.105, this.m.trouser);
    bone('abdomen', 0.100, 0.092, this.m.shirt);
    bone('chest', 0.110, 0.100, this.m.shirt);
    ball('shL', 0.052, this.m.shirt);
    ball('shR', 0.052, this.m.shirt);
    ball('hipBallL', 0.055, this.m.trouser);
    ball('hipBallR', 0.055, this.m.trouser);

    bone('upperL', 0.044, 0.038, this.m.shirt);
    bone('upperR', 0.044, 0.038, this.m.shirt);
    bone('foreL', 0.038, 0.026, this.m.skin);
    bone('foreR', 0.038, 0.026, this.m.skin);
    ball('elbL', 0.038, this.m.shirt);
    ball('elbR', 0.038, this.m.shirt);
    ball('handL', 0.032, this.m.skin);
    ball('handR', 0.032, this.m.skin);

    bone('thighL', 0.062, 0.046, this.m.trouser);
    bone('thighR', 0.062, 0.046, this.m.trouser);
    bone('shankL', 0.046, 0.030, this.m.trouser);
    bone('shankR', 0.046, 0.030, this.m.trouser);
    ball('kneeL', 0.046, this.m.trouser);
    ball('kneeR', 0.046, this.m.trouser);
    box('footL', 0.070, 0.038, 0.150, this.m.shoe);
    box('footR', 0.070, 0.038, 0.150, this.m.shoe);

    bone('neck', 0.036, 0.040, this.m.skin);
    ball('head', 0.066, this.m.skin);
    this.parts.head.scale.set(1, 1.08, 1.14);
    ball('cap', 0.070, this.m.cap);
    box('peak', 0.104, 0.016, 0.070, this.m.cap);

    /* debug skeleton */
    this.skel = new THREE.Group();
    this.skel.visible = false;
    this.group.add(this.skel);
    this.skelGeo = new THREE.BufferGeometry();
    this.skelPos = new Float32Array(3 * 2 * 20);
    this.skelGeo.setAttribute('position', new THREE.BufferAttribute(this.skelPos, 3));
    this.skel.add(new THREE.LineSegments(this.skelGeo,
      new THREE.LineBasicMaterial({ color: 0x00a0ff, depthTest: false })));
    this.jointDots = new THREE.Group();
    this.skel.add(this.jointDots);
    var dotGeo = new THREE.SphereGeometry(0.012 * H, 8, 6);
    var dotMat = new THREE.MeshBasicMaterial({ color: 0x0090ff, depthTest: false });
    this.dots = [];
    for (var i = 0; i < 14; i++) {
      var d = new THREE.Mesh(dotGeo, dotMat);
      this.jointDots.add(d);
      this.dots.push(d);
    }
    this._up = new THREE.Vector3();
    this._rg = new THREE.Vector3();
    this._fw = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
  }

  /* Stretch a bone between two points, with its cross-section aligned to
     `rightRef` and optionally squashed to an ellipse. */
  Rig.prototype.place = function (name, a, b, rightRef, sx, sz) {
    var T = this.THREE, m = this.parts[name];
    if (!m) return;
    var up = this._up.set(b.x - a.x, b.y - a.y, b.z - a.z);
    var L = up.length() || 1e-5;
    up.multiplyScalar(1 / L);
    var rg = this._rg.set(rightRef.x, rightRef.y, rightRef.z);
    rg.addScaledVector(up, -rg.dot(up));
    if (rg.lengthSq() < 1e-8) rg.set(1, 0, 0).addScaledVector(up, -up.x);
    rg.normalize();
    var fw = this._fw.crossVectors(rg, up).normalize();
    this._m4.makeBasis(rg, up, fw);
    m.quaternion.setFromRotationMatrix(this._m4);
    m.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
    m.scale.set(sx === undefined ? 1 : sx, L, sz === undefined ? 1 : sz);
    void T;
  };

  Rig.prototype.at = function (name, p, sx, sy, sz) {
    var m = this.parts[name];
    if (!m) return;
    m.position.set(p.x, p.y, p.z);
    if (sx !== undefined) m.scale.set(sx, sy, sz);
  };

  Rig.prototype.update = function (p) {
    var H = this.H, V = C.v3;
    var yaw = p.bodyYaw;
    var right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    var fwd = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };

    var waist = p.spine[1], mid = p.spine[2];
    this.place('pelvis', V.add(p.pelvis, { x: 0, y: -0.035 * H, z: 0 }), waist, right, 1, 0.78);
    this.place('abdomen', waist, mid, right, 1, 0.74);
    this.place('chest', mid, V.add(p.chest, { x: 0, y: 0.012 * H, z: 0 }), right, 1, 0.76);

    this.at('shL', p.shL); this.at('shR', p.shR);
    this.at('hipBallL', p.hipL); this.at('hipBallR', p.hipR);

    this.place('upperL', p.shL, p.elbL, right);
    this.place('upperR', p.shR, p.elbR, right);
    this.place('foreL', p.elbL, p.handL, right);
    this.place('foreR', p.elbR, p.handR, right);
    this.at('elbL', p.elbL); this.at('elbR', p.elbR);
    this.at('handL', p.handL, 1, 0.8, 0.72);
    this.at('handR', p.handR, 1, 0.8, 0.72);

    this.place('thighL', p.hipL, p.kneeL, right);
    this.place('thighR', p.hipR, p.kneeR, right);
    this.place('shankL', p.kneeL, p.ankL, right);
    this.place('shankR', p.kneeR, p.ankR, right);
    this.at('kneeL', p.kneeL); this.at('kneeR', p.kneeR);

    /* the shoe hangs off the ankle: sole on the ground, a little forward of
       the joint, rolling heel-to-toe through the step */
    var foot = function (mesh, ank, yawF, roll) {
      mesh.position.set(ank.x, ank.y - 0.020 * H, ank.z);
      mesh.rotation.set(-roll * 0.32, yawF, 0, 'YXZ');
      mesh.position.x += Math.sin(yawF) * 0.020 * H;
      mesh.position.z += Math.cos(yawF) * 0.020 * H;
    };
    foot(this.parts.footL, p.ankL, p.footYawL, p.rollL);
    foot(this.parts.footR, p.ankR, p.footYawR, p.rollR);

    var headBase = V.add(p.head, V.mul(p.headUp, -0.055 * H));
    this.place('neck', p.neck, headBase, right);
    this.at('head', p.head);
    this.parts.head.rotation.set(0, p.yaw, 0);
    var capP = V.add(p.head, V.mul(p.headUp, 0.022 * H));
    this.at('cap', capP, 1, 0.62, 1.06);
    this.parts.cap.rotation.set(0, p.yaw, 0);
    var peakP = V.add(V.add(p.head, V.mul(p.headUp, 0.006 * H)), {
      x: Math.sin(p.yaw) * 0.072 * H, y: 0, z: Math.cos(p.yaw) * 0.072 * H
    });
    this.at('peak', peakP);
    this.parts.peak.rotation.set(0, p.yaw, 0);

    if (this.skel.visible) {
      var pairs = [[p.pelvis, p.spine[1]], [p.spine[1], p.spine[2]], [p.spine[2], p.chest],
        [p.shL, p.shR], [p.hipL, p.hipR],
        [p.shL, p.elbL], [p.elbL, p.handL], [p.shR, p.elbR], [p.elbR, p.handR],
        [p.hipL, p.kneeL], [p.kneeL, p.ankL], [p.hipR, p.kneeR], [p.kneeR, p.ankR],
        [p.chest, p.head]];
      var arr = this.skelPos, n = 0;
      for (var i = 0; i < pairs.length; i++) {
        arr[n++] = pairs[i][0].x; arr[n++] = pairs[i][0].y; arr[n++] = pairs[i][0].z;
        arr[n++] = pairs[i][1].x; arr[n++] = pairs[i][1].y; arr[n++] = pairs[i][1].z;
      }
      while (n < arr.length) arr[n++] = 0;
      this.skelGeo.attributes.position.needsUpdate = true;
      this.skelGeo.setDrawRange(0, pairs.length * 2);
      var js = [p.shL, p.shR, p.elbL, p.elbR, p.handL, p.handR, p.hipL, p.hipR,
        p.kneeL, p.kneeR, p.ankL, p.ankR, p.chest, p.head];
      for (var k = 0; k < this.dots.length; k++) {
        this.dots[k].position.set(js[k].x, js[k].y, js[k].z);
      }
    }
    void fwd;
  };

  Rig.prototype.setSkeleton = function (on) {
    this.skel.visible = on;
    for (var k in this.parts) {
      if (this.parts[k].material) this.parts[k].material.opacity = on ? 0.32 : 1;
      if (this.parts[k].material) this.parts[k].material.transparent = on;
    }
  };

  C.Rig3D = Rig;
})(typeof window !== 'undefined' ? window : globalThis);
