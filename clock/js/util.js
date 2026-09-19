/* Small math + noise helpers shared by every module. */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function invLerp(a, b, v) { return (v - a) / ((b - a) || 1e-9); }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / ((e1 - e0) || 1e-9), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function smootherstep(e0, e1, x) {
    var t = clamp((x - e0) / ((e1 - e0) || 1e-9), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function easeInCubic(t) { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutBack(t) { var c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  /* Frame-rate independent exponential approach. */
  function damp(cur, target, lambda, dt) { return target + (cur - target) * Math.exp(-lambda * dt); }

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* FNV-1a over the joined arguments — stable seeds from (day, hour, minute, tag). */
  function hash() {
    var s = Array.prototype.join.call(arguments, '|');
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* Looping 1-D value noise. Nothing in a body ever moves linearly, and this is
     what keeps every joint off its rest position by a slightly wrong amount. */
  function Noise1D(seed, size) {
    size = size || 512;
    var rnd = mulberry32(seed);
    this.v = new Float32Array(size);
    for (var i = 0; i < size; i++) this.v[i] = rnd() * 2 - 1;
    this.mask = size - 1;
  }
  Noise1D.prototype.at = function (t) {
    var i = Math.floor(t), f = t - i;
    var a = this.v[i & this.mask], b = this.v[(i + 1) & this.mask];
    var u = f * f * f * (f * (f * 6 - 15) + 10);
    return a + (b - a) * u;
  };
  Noise1D.prototype.fbm = function (t, octaves) {
    octaves = octaves || 3;
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.at(t * freq + i * 37.13) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return sum / norm;
  };

  function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }

  /* Two-bone IK. Returns the joint (elbow / knee); `flip` picks which of the two
     mirror solutions to take. Lengths are clamped so the limb never snaps. */
  function solveIK(ax, ay, bx, by, l1, l2, flip) {
    var dx = bx - ax, dy = by - ay;
    var d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    var dmax = (l1 + l2) * 0.999, dmin = Math.abs(l1 - l2) * 1.001 + 1e-4;
    var dc = clamp(d, dmin, dmax);
    var ux = dx / d, uy = dy / d;
    var a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var px = -uy * flip, py = ux * flip;
    return { x: ax + ux * a + px * h, y: ay + uy * a + py * h, reach: d / (l1 + l2) };
  }

  /* Point on a quadratic bezier — used for spines, limbs and stroke spines. */
  function qbez(p0, p1, p2, t) {
    var mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
    };
  }

  function polar(cx, cy, angle, r) {
    return { x: cx + Math.sin(angle) * r, y: cy - Math.cos(angle) * r };
  }

  global.CLOCK = global.CLOCK || {};
  global.CLOCK.util = {
    TAU: TAU, clamp: clamp, lerp: lerp, invLerp: invLerp,
    smoothstep: smoothstep, smootherstep: smootherstep,
    easeInCubic: easeInCubic, easeOutCubic: easeOutCubic,
    easeInOutCubic: easeInOutCubic, easeOutBack: easeOutBack,
    damp: damp, mulberry32: mulberry32, hash: hash, Noise1D: Noise1D,
    dist: dist, solveIK: solveIK, qbez: qbez, polar: polar
  };
})(typeof window !== 'undefined' ? window : globalThis);
