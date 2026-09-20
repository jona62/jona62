/* Drawing a body rather than a diagram, in two dimensions.
 *
 * Shared by the clock and the 2D sandbox. `project` turns the rig's world pose
 * (y-up, metres-ish) into the screen pose this renderer consumes; everything
 * below then works in pixels.
 *
 * The old figure was round-capped strokes and ellipses: a stick man with thick
 * lines. Limbs there had one width from end to end and met at a bulge, which is
 * what reads as cartoonish. Here every segment is a filled outline with a width
 * profile down its length — thigh thick at the hip and narrow at the knee, calf
 * bellied at the top third, forearm tapering hard into the wrist — and the
 * outline runs continuously through the joint so there is no seam.
 *
 * The torso is three masses (pelvis, waist, ribcage) rather than one slab, with
 * deltoids sitting on the shoulders, and the head is a cranium plus a jaw.
 * Depth ordering comes from the perspective scale each joint carries: whichever
 * limb projects larger is nearer, and is drawn last.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  function lerpPt(a, b, t) { return { x: U.lerp(a.x, b.x, t), y: U.lerp(a.y, b.y, t), k: U.lerp(a.k || 1, b.k || 1, t) }; }

  /* Sample a two-segment limb into a smooth polyline, rounding the corner at
     the joint so knee and elbow read as a bend and not a hinge pin. */
  function limbSpine(a, b, c, round) {
    var pts = [], i, t;
    var n1 = 7, n2 = 8;
    var b1 = lerpPt(a, b, 1 - round), b2 = lerpPt(b, c, round);
    for (i = 0; i <= n1; i++) {
      t = i / n1;
      pts.push(lerpPt(a, b1, t));
    }
    for (i = 1; i <= 6; i++) {          /* quadratic through the joint */
      t = i / 6;
      var mt = 1 - t;
      pts.push({
        x: mt * mt * b1.x + 2 * mt * t * b.x + t * t * b2.x,
        y: mt * mt * b1.y + 2 * mt * t * b.y + t * t * b2.y,
        k: b.k || 1
      });
    }
    for (i = 1; i <= n2; i++) {
      t = i / n2;
      pts.push(lerpPt(b2, c, t));
    }
    return pts;
  }

  /* profile: array of [u, width] control points, u along the whole limb */
  function widthAt(profile, u) {
    for (var i = 1; i < profile.length; i++) {
      if (u <= profile[i][0]) {
        var t = (u - profile[i - 1][0]) / ((profile[i][0] - profile[i - 1][0]) || 1);
        return U.lerp(profile[i - 1][1], profile[i][1], U.smoothstep(0, 1, t));
      }
    }
    return profile[profile.length - 1][1];
  }

  function fillLimb(ctx, pts, profile, H, color, bias) {
    var i, n = pts.length;
    var left = [], right = [];
    for (i = 0; i < n; i++) {
      var p = pts[i];
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.hypot(dx, dy) || 1e-6;
      var nx = -dy / d, ny = dx / d;
      var w = widthAt(profile, i / (n - 1)) * H * (p.k || 1) * 0.5;
      var off = (bias || 0) * w;
      left.push({ x: p.x + nx * (w + off), y: p.y + ny * (w + off) });
      right.push({ x: p.x - nx * (w - off), y: p.y - ny * (w - off) });
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    /* round both ends, or the shoulder gets a square epaulette and the wrist a
       chopped-off stump */
    var w0 = widthAt(profile, 0) * H * (pts[0].k || 1) * 0.5;
    var wN = widthAt(profile, 1) * H * (pts[n - 1].k || 1) * 0.5;
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, w0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(pts[n - 1].x, pts[n - 1].y, wN, 0, TAU); ctx.fill();
    return { left: left, right: right };
  }

  /* A soft darker edge down one side gives the limb a round section without
     costing a gradient per frame. */
  function shade(ctx, edge, H, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(20,22,30,0.5)';
    ctx.lineWidth = 0.012 * H;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(edge[0].x, edge[0].y);
    for (var i = 1; i < edge.length; i++) ctx.lineTo(edge[i].x, edge[i].y);
    ctx.stroke();
    ctx.restore();
  }

  /* Widths across the limb, as fractions of stature. Roughly circumference/pi
     at each landmark: thigh thickest at the hip, knee narrow, calf bellied in
     the upper third, forearm tapering hard into the wrist. The shoulder end of
     the arm carries the deltoid, so the sleeve starts wide rather than having a
     pad stuck on top of it. */
  var LEG_PROFILE = [[0, 0.118], [0.18, 0.107], [0.45, 0.080], [0.52, 0.074], [0.62, 0.088], [0.82, 0.058], [1, 0.042]];
  var ARM_PROFILE = [[0, 0.104], [0.14, 0.092], [0.5, 0.072], [0.62, 0.075], [0.85, 0.054], [1, 0.044]];

  function drawLeg(ctx, hip, knee, ank, H, pal, roll, drag, near) {
    var k2 = drag ? { x: U.lerp(knee.x, drag.x, 0.35), y: U.lerp(knee.y, drag.y, 0.35), k: knee.k } : knee;
    var pts = limbSpine(hip, k2, ank, 0.30);
    var e = fillLimb(ctx, pts, LEG_PROFILE, H, pal.trouser, -0.05);
    shade(ctx, e.right, H, near ? 0.16 : 0.10);
    /* trouser hem breaks over the shoe */
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = 'rgba(15,18,26,1)';
    ctx.lineWidth = 0.010 * H;
    ctx.beginPath();
    var hemA = pts[pts.length - 3], hemB = pts[pts.length - 1];
    ctx.moveTo(U.lerp(hemA.x, hemB.x, 0.5), U.lerp(hemA.y, hemB.y, 0.5));
    ctx.lineTo(hemB.x, hemB.y);
    ctx.stroke();
    ctx.restore();
    drawFoot(ctx, ank, H, roll, pal);
  }

  function drawFoot(ctx, ank, H, roll, pal) {
    var k = ank.k || 1;
    ctx.save();
    ctx.translate(ank.x, ank.y);
    ctx.rotate(-(roll || 0) * 0.32);
    ctx.fillStyle = '#2b2e34';
    ctx.beginPath();
    /* heel, instep, toe — not an ellipse */
    ctx.moveTo(-0.030 * H * k, 0.004 * H * k);
    ctx.quadraticCurveTo(-0.040 * H * k, 0.030 * H * k, -0.016 * H * k, 0.034 * H * k);
    ctx.lineTo(0.040 * H * k, 0.034 * H * k);
    ctx.quadraticCurveTo(0.062 * H * k, 0.030 * H * k, 0.050 * H * k, 0.012 * H * k);
    ctx.quadraticCurveTo(0.020 * H * k, 0.002 * H * k, -0.030 * H * k, 0.004 * H * k);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(-0.020 * H * k, 0.030 * H * k, 0.066 * H * k, 0.006 * H * k);
    ctx.restore();
    void pal;
  }

  function drawArm(ctx, sh, elb, hand, H, pal, drag, sleeve, centreX) {
    var e2 = drag ? { x: U.lerp(elb.x, drag.x, 0.4), y: U.lerp(elb.y, drag.y, 0.4), k: elb.k } : elb;
    /* The arm hangs from inside and just below the point of the shoulder. Root
       it on the acromion itself and the deltoid pushes the silhouette out too
       far at the top. */
    var inboard = centreX === undefined ? 0 : Math.sign(centreX - sh.x) * 0.024 * H;
    var root = { x: sh.x + inboard, y: sh.y + 0.016 * H, k: sh.k };
    var pts = limbSpine(root, e2, hand, 0.30);
    var e = fillLimb(ctx, pts, ARM_PROFILE, H, pal.skin, 0);
    /* sleeve over the upper two thirds */
    if (sleeve !== false) {
      var cut = Math.round(pts.length * 0.56);
      var sp = pts.slice(0, cut);
      var pr = ARM_PROFILE.map(function (q) { return [q[0] / 0.56, q[1] * 1.10]; });
      var es = fillLimb(ctx, sp, pr, H, pal.shirt, 0);
      shade(ctx, es.right, H, 0.14);
    }
    shade(ctx, e.right, H, 0.10);
    drawHand(ctx, hand, pts[pts.length - 4], H, pal);
  }

  function drawHand(ctx, hand, prev, H, pal) {
    var k = hand.k || 1;
    var ang = Math.atan2(hand.y - prev.y, hand.x - prev.x);
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(ang);
    ctx.fillStyle = pal.skin;
    ctx.beginPath();
    ctx.ellipse(0.008 * H * k, 0, 0.030 * H * k, 0.022 * H * k, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();          /* thumb side */
    ctx.ellipse(0.004 * H * k, -0.016 * H * k, 0.016 * H * k, 0.009 * H * k, -0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawTorso(ctx, p, H, pal) {
    var sp = p.spine;
    var waist = sp[1], mid = sp[2];
    var hw = Math.abs(p.hipR.x - p.hipL.x) * 0.5 + 0.030 * H;
    var k = p.pelvis.k || 1;

    /* pelvis block */
    ctx.fillStyle = pal.trouserDark || pal.trouser;
    ctx.beginPath();
    ctx.moveTo(p.hipL.x - hw * 0.35, p.hipL.y - 0.02 * H);
    ctx.quadraticCurveTo(p.pelvis.x, p.pelvis.y + 0.055 * H * k, p.hipR.x + hw * 0.35, p.hipR.y - 0.02 * H);
    ctx.lineTo(U.lerp(p.hipR.x, waist.x, 0.32) + 0.052 * H, U.lerp(p.hipR.y, waist.y, 0.55));
    ctx.quadraticCurveTo(U.lerp(p.pelvis.x, waist.x, 0.5), U.lerp(p.pelvis.y, waist.y, 0.5) - 0.006 * H,
      U.lerp(p.hipL.x, waist.x, 0.32) - 0.052 * H, U.lerp(p.hipL.y, waist.y, 0.55));
    ctx.closePath();
    ctx.fill();

    /* ribcage: widest just under the armpits, tapering into the waist */
    var g = ctx.createLinearGradient(sp[3].x, sp[3].y, sp[0].x, sp[0].y);
    g.addColorStop(0, pal.shirt);
    g.addColorStop(1, pal.shirtDark);
    ctx.fillStyle = g;
    var chest = sp[3];
    var dx = (p.shR.x - p.shL.x) * 0.5, dy = (p.shR.y - p.shL.y) * 0.5;
    var nx = -dy, ny = dx;
    void nx; void ny;
var hemL = { x: U.lerp(p.hipL.x, waist.x, 0.10) - 0.020 * H, y: U.lerp(waist.y, p.hipL.y, 0.62) };
    var hemR = { x: U.lerp(p.hipR.x, waist.x, 0.10) + 0.020 * H, y: U.lerp(waist.y, p.hipR.y, 0.62) };
    ctx.beginPath();
    ctx.moveTo(hemL.x, hemL.y);
    ctx.quadraticCurveTo(mid.x - 0.092 * H, mid.y, p.shL.x - 0.006 * H, p.shL.y + 0.014 * H);
    ctx.quadraticCurveTo(chest.x - 0.05 * H, chest.y - 0.026 * H, chest.x, chest.y - 0.028 * H);
    ctx.quadraticCurveTo(chest.x + 0.05 * H, chest.y - 0.026 * H, p.shR.x + 0.006 * H, p.shR.y + 0.014 * H);
    ctx.quadraticCurveTo(mid.x + 0.092 * H, mid.y, hemR.x, hemR.y);
    ctx.quadraticCurveTo(waist.x, hemR.y + 0.024 * H, hemL.x, hemL.y);
    ctx.closePath();
    ctx.fill();

    /* belt */
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#2a2d36';
    ctx.lineWidth = 0.020 * H;
    ctx.beginPath();
    ctx.moveTo(U.lerp(p.hipL.x, waist.x, 0.16) - 0.012 * H, U.lerp(p.hipL.y, waist.y, 0.42));
    ctx.quadraticCurveTo(waist.x, U.lerp(p.pelvis.y, waist.y, 0.42) + 0.006 * H,
      U.lerp(p.hipR.x, waist.x, 0.16) + 0.012 * H, U.lerp(p.hipR.y, waist.y, 0.42));
    ctx.stroke();
    ctx.restore();

    /* shirt hem */
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = 'rgba(12,14,20,1)';
    ctx.lineWidth = 0.008 * H;
    ctx.beginPath();
    ctx.moveTo(hemL.x, hemL.y);
    ctx.quadraticCurveTo(waist.x, hemL.y + 0.024 * H, hemR.x, hemR.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawHead(ctx, p, H, pal) {
    var h = p.head, k = h.k || 1;
    /* neck: a column, not a line */
    ctx.fillStyle = pal.skin;
    ctx.save();
    ctx.beginPath();
    var nTop = { x: h.p.x - Math.sin(h.ang) * h.ry * 0.5, y: h.p.y + Math.cos(h.ang) * h.ry * 0.5 };
    var nw = 0.044 * H * k;
    var ndx = nTop.x - p.neck.x, ndy = nTop.y - p.neck.y;
    var nd = Math.hypot(ndx, ndy) || 1;
    var px = -ndy / nd * nw, py = ndx / nd * nw;
    ctx.moveTo(p.neck.x + px, p.neck.y + py);
    ctx.lineTo(nTop.x + px * 0.85, nTop.y + py * 0.85);
    ctx.lineTo(nTop.x - px * 0.85, nTop.y - py * 0.85);
    ctx.lineTo(p.neck.x - px, p.neck.y - py);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(h.p.x, h.p.y);
    ctx.rotate(h.ang);
    ctx.scale(k, k);
    var yaw = h.yaw;
    /* cranium */
    ctx.fillStyle = pal.skin;
    ctx.beginPath();
    ctx.ellipse(yaw * h.rx * 0.12, -h.ry * 0.14, h.rx * 0.98, h.ry * 0.86, 0, 0, TAU);
    ctx.fill();
    /* jaw, narrower and offset by the turn of the head */
    ctx.beginPath();
    ctx.moveTo(-h.rx * 0.86 + yaw * h.rx * 0.2, -h.ry * 0.05);
    ctx.quadraticCurveTo(-h.rx * 0.70 + yaw * h.rx * 0.3, h.ry * 0.92,
      yaw * h.rx * 0.36, h.ry * 0.95);
    ctx.quadraticCurveTo(h.rx * 0.74 + yaw * h.rx * 0.3, h.ry * 0.88,
      h.rx * 0.88 + yaw * h.rx * 0.2, -h.ry * 0.05);
    ctx.closePath();
    ctx.fill();
    /* ear on the away side */
    ctx.beginPath();
    ctx.ellipse(-Math.sign(yaw || 1) * h.rx * 0.92, h.ry * 0.06, h.rx * 0.16, h.ry * 0.22, 0, 0, TAU);
    ctx.fill();
    /* cap */
    ctx.fillStyle = pal.cap;          /* sits on the crown, not over the face */
    ctx.beginPath();
    ctx.ellipse(yaw * h.rx * 0.14, -h.ry * 0.60, h.rx * 1.04, h.ry * 0.50, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(yaw * h.rx * 1.00, -h.ry * 0.48, h.rx * 0.66, h.ry * 0.17, yaw * 0.22, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = 'rgba(10,12,18,1)';
    ctx.beginPath();
    ctx.ellipse(yaw * h.rx * 0.14, -h.ry * 0.36, h.rx * 0.98, h.ry * 0.10, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* far/near may be the same context (the lab draws everything sharp). */
  function draw(far, near, p, pal, opts) {
    opts = opts || {};
    var H = p.H;
    var lNear = (p.ankL.k || 1) >= (p.ankR.k || 1);
    var armNear = p.toolLeft ? 'L' : 'R';

    if (opts.shadow !== false) {
      far.save();
      far.globalAlpha = 0.28;
      far.fillStyle = '#5c6068';
      far.beginPath();
      far.ellipse((p.ankL.x + p.ankR.x) * 0.5, p.feetY - 0.004 * H,
        Math.abs(p.ankR.x - p.ankL.x) * 0.5 + 0.11 * H, 0.024 * H, 0, 0, TAU);
      far.fill();
      far.restore();
    }

    var far_ = { hip: lNear ? p.hipR : p.hipL, knee: lNear ? p.kneeR : p.kneeL, ank: lNear ? p.ankR : p.ankL,
      drag: lNear ? p.drag.kR : p.drag.kL, roll: lNear ? p.rollR : p.rollL };
    var near_ = { hip: lNear ? p.hipL : p.hipR, knee: lNear ? p.kneeL : p.kneeR, ank: lNear ? p.ankL : p.ankR,
      drag: lNear ? p.drag.kL : p.drag.kR, roll: lNear ? p.rollL : p.rollR };

    far.save();
    far.globalAlpha = 0.86;
    drawLeg(far, far_.hip, far_.knee, far_.ank, H, pal, far_.roll, far_.drag, false);
    far.restore();

    /* the idle arm passes behind the trunk */
    var idle = armNear === 'L'
      ? { sh: p.shR, el: p.elbR, hd: p.handC, drag: p.drag.eR }
      : { sh: p.shL, el: p.elbL, hd: p.handB, drag: p.drag.eL };
    far.save();
    far.globalAlpha = 0.92;
    drawArm(far, idle.sh, idle.el, idle.hd, H, pal, idle.drag, true, p.spine[3].x);
    far.restore();

    drawTorso(far, p, H, pal);
    drawLeg(far, near_.hip, near_.knee, near_.ank, H, pal, near_.roll, near_.drag, true);
    drawHead(far, p, H, pal);

    var act = armNear === 'L'
      ? { sh: p.shL, el: p.elbL, hd: p.handB, drag: p.drag.eL }
      : { sh: p.shR, el: p.elbR, hd: p.handC, drag: p.drag.eR };
    drawArm(near, act.sh, act.el, act.hd, H, pal, act.drag, true, p.spine[3].x);
    return act;
  }

  /* World pose -> screen pose. `view` gives the screen point the world origin
     sits at, the ground line, the principal point for the weak perspective,
     and the camera distance. Cloth lag is kept per-renderer, since it is a
     drawing effect rather than anything the body knows about. */
  function project(w, view, lagStore, dt) {
    var f = view.f || (w.H * 4);
    var px = view.px, py = view.py;
    function pj(p) {
      var ux = view.cx + (p.x - (view.ox || 0));
      var uy = view.groundY - p.y;
      var k = f / (f - p.z);
      return { x: px + (ux - px) * k, y: py + (uy - py) * k, k: k };
    }
    var head = pj(w.head);
    var up = pj({ x: w.head.x + w.headUp.x, y: w.head.y + w.headUp.y, z: w.head.z + w.headUp.z });
    var out = {
      H: w.H, feetY: view.groundY,
      pelvis: pj(w.pelvis), spine: w.spine.map(pj), chest: pj(w.chest),
      shL: pj(w.shL), shR: pj(w.shR), hipL: pj(w.hipL), hipR: pj(w.hipR),
      kneeL: pj(w.kneeL), kneeR: pj(w.kneeR), ankL: pj(w.ankL), ankR: pj(w.ankR),
      elbL: pj(w.elbL), elbR: pj(w.elbR), handB: pj(w.handL), handC: pj(w.handR),
      neck: pj(w.neck),
      head: { p: head, ang: Math.atan2(head.x - up.x, up.y - head.y),
        yaw: w.headYawN || 0, rx: C.rig.P.headRx * w.H, ry: C.rig.P.headRy * w.H, k: head.k },
      toolLeft: !!w.toolLeft, rollL: w.rollL, rollR: w.rollR,
      state: w.state, crouch: w.crouch, regrip: w.regrip || 0
    };
    if (lagStore) {
      if (!lagStore.kL) {
        lagStore.kL = { x: out.kneeL.x, y: out.kneeL.y }; lagStore.kR = { x: out.kneeR.x, y: out.kneeR.y };
        lagStore.eL = { x: out.elbL.x, y: out.elbL.y }; lagStore.eR = { x: out.elbR.x, y: out.elbR.y };
      }
      [['kL', 'kneeL'], ['kR', 'kneeR'], ['eL', 'elbL'], ['eR', 'elbR']].forEach(function (pr) {
        var lg = lagStore[pr[0]], c2 = out[pr[1]];
        lg.x = U.damp(lg.x, c2.x, 22, dt || 1 / 60);
        lg.y = U.damp(lg.y, c2.y, 22, dt || 1 / 60);
      });
      out.drag = lagStore;
    } else {
      out.drag = { kL: out.kneeL, kR: out.kneeR, eL: out.elbL, eR: out.elbR };
    }
    return out;
  }

  C.draw2d = { draw: draw, project: project, drawArm: drawArm, drawLeg: drawLeg, drawHead: drawHead, drawHand: drawHand };
  C.bodyRender = C.draw2d;
})(typeof window !== 'undefined' ? window : globalThis);
