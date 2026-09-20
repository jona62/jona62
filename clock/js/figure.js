/* The painter, as a controller.
 *
 * The body itself lives in rig.js — one copy, shared with both sandboxes. All
 * this file does is decide what the painter is trying to do with his hands and
 * hand it to the rig: where the head of the tool must be, how tightly he is
 * holding himself to it, and where he would rather be standing. Everything
 * below that — balance, stepping, the spine, the IK — belongs to the rig, and
 * the drawing belongs to draw2d.js.
 *
 * The one thing that is genuinely this file's business is the tool: a head
 * pinned to the exact scheduled point on the panel, a shaft running back to a
 * hold near his chest, and a hand that re-grips in discrete moves along it.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util, R3 = C.rig;
  var V = { v: R3.v, add: R3.add, sub: R3.sub, mul: R3.mul, len: R3.len, norm: R3.norm };

  /* How far the panel stands off him, in heights. At 0.15 the glass was
     inside his own reach envelope: every hold landed in front of the pane and
     the elbow stayed folded to the ribs. A painter works at about a third of
     his height from the wall, which is also what lets the arm straighten. */
  var GLASS_Z = 0.32;
  var POLE_BRUSH = 0.80, POLE_CLOTH = 0.60;
  var REGRIP = 0.20;

  var PALETTES = [
    { shirt: '#5f77d4', shirtDark: '#4a60bd', trouser: '#39405e', trouserDark: '#2f3550', skin: '#d5a684', cap: '#42539f', tool: '#c6d451' },
    { shirt: '#4f8ad0', shirtDark: '#3d73b6', trouser: '#334063', trouserDark: '#2a3453', skin: '#b9825f', cap: '#2f4e86', tool: '#dcc94e' },
    { shirt: '#5a86c8', shirtDark: '#4570b0', trouser: '#36406b', trouserDark: '#2c355a', skin: '#dcae88', cap: '#3a5ea0', tool: '#dcc94e' },
    { shirt: '#e08a46', shirtDark: '#c4713a', trouser: '#45506b', trouserDark: '#39435c', skin: '#dcae88', cap: '#c96f34', tool: '#7fb6d8' },
    { shirt: '#63a878', shirtDark: '#4d8c62', trouser: '#3d4657', trouserDark: '#333b4a', skin: '#a9784f', cap: '#3f7a56', tool: '#e0d264' },
    { shirt: '#8b8fa6', shirtDark: '#71768d', trouser: '#464c60', trouserDark: '#3a4052', skin: '#dbb191', cap: '#6a708a', tool: '#d9d25c' }
  ];

  function Figure(seed) {
    this.seed = seed;
    this.rng = U.mulberry32(seed);
    this.palette = PALETTES[Math.floor(this.rng() * PALETTES.length)];
    this.body = null;
    this.lag = {};
    this.grip = 0; this.gripFrom = 0; this.gripTo = 0; this.gripT = 1;
    this.regrip = 0;
    this.homeX = null;
    this.intentKey = '';
  }

  /* The panel is a plane in front of him, so a point on it is a point in the
     world at a fixed depth. */
  Figure.prototype.view = function (L) {
    return { cx: L.cx, px: L.cx, py: L.cy, ox: 0, groundY: L.fig.feetY, f: L.fig.H * 4 };
  };
  Figure.prototype.unproject = function (L, sx, sy, z) {
    var vw = this.view(L);
    var k = vw.f / (vw.f - z);
    var ux = vw.px + (sx - vw.px) / k;
    var uy = vw.py + (sy - vw.py) / k;
    return V.v(ux - vw.cx, vw.groundY - uy, z);
  };

  Figure.prototype.ensure = function (L) {
    if (!this.body) {
      this.body = new R3.Body(L.fig.H, this.seed);
      this.body.pos = V.v(L.fig.baseX - L.cx, 0, 0);
      this.body.want = V.v(this.body.pos.x, 0, 0);
      this.body.feet[0].x = this.body.pos.x - 0.065 * L.fig.H;
      this.body.feet[1].x = this.body.pos.x + 0.065 * L.fig.H;
      /* He addresses the glass, but nobody stands square to their work: the
         shoulders sit a few degrees off, which is also what gives the figure
         any depth at all when the camera is dead in front of him. */
      this.body.ctl.faceTo = (this.rng() < 0.5 ? -1 : 1) * (0.13 + this.rng() * 0.09);
    } else if (Math.abs(this.body.H - L.fig.H) > 0.5) {
      this.body.H = L.fig.H;
    }
  };

  Figure.prototype.update = function (dt, S, L, t, SA) {
    this.ensure(L);
    var b = this.body, H = L.fig.H;
    var brushSide = S.active.side === 'brush';
    var side = brushSide ? 'L' : 'R';
    var tight = S.active.tight;
    var effort = Math.max(S.active.effort, SA ? SA.active.effort * 0.9 : 0);

    var tip = this.unproject(L, S.active.pt.x, S.active.pt.y, GLASS_Z * H);
    /* Posture for where the work is going, not where it is. Across a change of
       hands there is nothing sensible to anticipate, so fall back to now. */
    var aheadPt = (SA && SA.active.side === S.active.side) ? SA.active.pt : S.active.pt;
    var ahead = this.unproject(L, aheadPt.x, aheadPt.y, GLASS_Z * H);

    /* the shaft runs from the work back to a hold near his chest */
    var chest = b.chest || V.v(b.pos.x, R3.P.shoulderY * H, b.pos.z);
    /* The hold sits clear of the ribs and off the midline. At 0.05 H forward
       it was inside the chest, so in three dimensions the forearm vanished
       into the torso and the pole appeared to grow out of his shirt. */
    var anchor = V.v(chest.x + (brushSide ? -0.10 : 0.10) * H, chest.y - 0.17 * H, chest.z + 0.12 * H);
    var shaft = V.sub(anchor, tip);
    var sl = V.len(shaft) || 1;
    var poleLen = (brushSide ? POLE_BRUSH : POLE_CLOTH) * L.R;
    var gripWant = U.clamp(sl, L.R * 0.10, poleLen);
    if (!this.grip) { this.grip = this.gripTo = gripWant; }
    /* a hand holds, lets go, and takes a new hold — it does not slide */
    if (this.gripT >= 1 && Math.abs(gripWant - this.gripTo) > L.R * 0.13) {
      this.gripFrom = this.grip; this.gripTo = gripWant; this.gripT = 0;
    }
    if (this.gripT < 1) {
      this.gripT = Math.min(1, this.gripT + dt / REGRIP);
      this.grip = U.lerp(this.gripFrom, this.gripTo, U.smootherstep(0, 1, this.gripT));
    }
    this.regrip = this.gripT < 1 ? Math.sin(this.gripT * Math.PI) : 0;

    var dir = V.norm(shaft);
    var wrist = V.add(tip, V.mul(dir, this.grip));
    var aheadWrist = V.add(ahead, V.mul(dir, this.grip));
    this.tool = { tip: tip, base: wrist, side: S.active.side, len: this.grip };

    /* Nobody swings a long handle one-handed when it matters. The second
       hand takes the shaft between the first and the head — past the first
       hand there is no shaft left to hold, and putting it there threw the
       arm out past the panel and across his own face. */
    var second = effort > 0.66
      ? V.add(tip, V.mul(dir, Math.max(this.grip * 0.30, this.grip - 0.22 * L.R)))
      : null;
    b.reach = { side: side, point: wrist, aheadPoint: aheadWrist, tight: tight, effort: effort, second: second };
    b.reach.point = wrist;

    /* he squares up to the work, but commits to a spot rather than shuffling */
    var preferRaw = U.clamp(ahead.x * 0.40, -L.R * 0.30, L.R * 0.30);
    if (this.homeX === null || Math.abs(preferRaw - this.homeX) > 0.26 * H) this.homeX = preferRaw;
    b.ctl.home = { x: this.homeX, z: 0 };

    /* posture aims at the future hand; the arm serves the present one */
    var keep = b.reach.point;
    b.reach.point = aheadWrist;
    b.step(dt);
    b.reach.point = keep;
    this.dt = dt;
  };

  /* The world pose, for the 3D renderer. Same solve, no projection. */
  Figure.prototype.worldPose = function () {
    var w = this.body.pose();
    w.toolLeft = this.tool && this.tool.side === 'brush';
    return w;
  };

  Figure.prototype.pose = function (L, t) {
    var w = this.body.pose();
    w.toolLeft = this.tool && this.tool.side === 'brush';
    var p = C.draw2d.project(w, this.view(L), this.lag, this.dt);
    p.regrip = this.regrip;
    var self = this;
    var pj = function (q) {
      var pw = C.draw2d.project({
        H: w.H, pelvis: q, spine: [q, q, q, q], chest: q, shL: q, shR: q, hipL: q, hipR: q,
        kneeL: q, kneeR: q, ankL: q, ankR: q, elbL: q, elbR: q, handL: q, handR: q,
        neck: q, head: q, headUp: { x: 0, y: 1, z: 0 }, rollL: 0, rollR: 0
      }, self.view(L), null, 0);
      return pw.pelvis;
    };
    if (this.tool) p.tool = { tip: pj(this.tool.tip), base: pj(this.tool.base), side: this.tool.side };
    void t;
    return p;
  };

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
    var act = C.draw2d.draw(far, near, p, this.palette, {});
    this.drawTool(near, p, L, act);
  };

  /* The tool stays flat and sharp whichever way the body is drawn: it is a
     stick and a brush head, and it has to agree with the paint on the panel. */
  Figure.prototype.drawTool = function (near, p, L, act) {
    var H = p.H, pal = this.palette;
    if (!p.tool) return;
    var tp = p.tool.tip, bp = p.tool.base;
    var dx = bp.x - tp.x, dy = bp.y - tp.y;
    var dl = Math.hypot(dx, dy) || 1e-6;
    var ux = dx / dl, uy = dy / dl;
    near.save();
    near.lineCap = 'round';
    near.strokeStyle = '#6d5b45';
    near.lineWidth = 0.020 * H;
    near.beginPath();
    near.moveTo(tp.x, tp.y);
    near.lineTo(bp.x + ux * 0.09 * H, bp.y + uy * 0.09 * H);
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
      near.ellipse(0, 0, 0.075 * H, 0.055 * H, 0, 0, U.TAU);
      near.fill();
    }
    near.restore();

    /* The shaft is drawn over the painter, so without this the hand is behind
       it and he appears to be standing next to a pole rather than holding one.
       The flat renderer hands back the hand it drew; the 3D one cannot, so
       fall back to the projected joint. */
    var hd = (act && act.hd) || (p.toolLeft ? p.handB : p.handC);
    if (hd) {
      var off = p.regrip * 0.022 * H;
      near.save();
      near.translate(hd.x - uy * off, hd.y + ux * off);
      near.rotate(Math.atan2(uy, ux));
      near.fillStyle = pal.skin;
      near.beginPath();
      /* a fist round a shaft is longer along it than across it */
      near.ellipse(0, 0, 0.038 * H * (hd.k || 1), 0.029 * H * (hd.k || 1), 0, 0, U.TAU);
      near.fill();
      near.restore();
    }
    void L;
  };

  C.Figure = Figure;
  C.PALETTES = PALETTES;
})(typeof window !== 'undefined' ? window : globalThis);
