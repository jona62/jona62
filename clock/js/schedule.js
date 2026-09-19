/* The choreography clock.
 *
 * Everything the painter does is derived from the wall clock, so the app is
 * stateless with respect to time: reload at 12:43:57 and the brush is already
 * mid-stroke, exactly where it should be.
 *
 * One minute, from the painter's side of the glass:
 *
 *   00.0 - ~40   the stroke for this minute is dry and standing. The brush
 *                hovers just off the glass, tracking the seconds around the
 *                rim: the painter's own body is the second hand.
 *   ~40 - ~48    cloth hand comes up and wipes the standing minute hand away,
 *                tip first, back towards the pivot. A ghost stays behind.
 *   ~48 - ~51    the brush goes down to the ink, loads, comes back up to the
 *                pivot for the next minute's angle.
 *   ~51 - 60.000 the stroke itself, pivot to tip, timed so the last of the
 *                paint lands exactly as the minute turns over.
 *
 * The hour hand is repainted on the minute before each quarter (14, 29, 44,
 * 59), early enough to be finished long before that minute's own stroke. Four
 * repaints an hour rather than one keeps the hour hand honest to within a
 * couple of degrees while still reading as an occasional, bigger ceremony.
 *
 * Each minute's timings are jittered by a seed derived from the date and the
 * minute, so no two minutes have the same rhythm, but any given minute of any
 * given day always plays back identically.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  var HOUR_MINUTES = [14, 29, 44, 59];

  /* Radii as fractions of the dial radius R. */
  var GEO = {
    hub: 0.038,
    minuteInner: 0.045, minuteOuter: 0.740,
    hourInner: 0.042, hourOuter: 0.480,
    secondTrackTop: 0.80, secondTrackDrop: 0.14,
    inkX: 0.30, inkY: 0.66       /* the pot, on the floor beside him */
  };

  function minuteAngle(m) { return ((m % 60) + 60) % 60 / 60 * TAU; }
  function hourAngle(h, m) { return (((h % 12) + 12) % 12 + m / 60) / 12 * TAU; }

  /* Hands do not travel in straight lines. A point-to-point human reach is a
     gently bowed path run with a bell-shaped speed profile — the minimum-jerk
     solution, which is the quintic 10t^3-15t^4+6t^5 (U.smootherstep). Passing
     an already-eased u in here and bowing the path is all it takes; the two
     thirds power law relating speed to curvature falls out of the same model. */
  function arcPt(a, b, u, bow) {
    var mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
    var dx = b.x - a.x, dy = b.y - a.y;
    var cx = mx - dy * bow, cy = my + dx * bow;
    var mt = 1 - u;
    return {
      x: mt * mt * a.x + 2 * mt * u * cx + u * u * b.x,
      y: mt * mt * a.y + 2 * mt * u * cy + u * u * b.y
    };
  }

  function timings(date) {
    var dayKey = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    var rng = U.mulberry32(U.hash(dayKey, date.getHours(), date.getMinutes(), 'beat'));
    var j = function (a) { return (rng() * 2 - 1) * a; };
    var w = 40.1 + j(1.1);
    var d = 51.3 + j(0.55);
    var hw = 4.4 + j(0.9);
    var hd = 16.4 + j(0.9);
    return {
      wipeA: w, wipeB: w + 7.9 + j(0.5),
      drawA: d, drawB: 60,
      hWipeA: hw, hWipeB: hw + 8.6 + j(0.5),
      hDrawA: hd, hDrawB: hd + 10.8 + j(0.6),
      rng: rng
    };
  }

  /* Where the working hand is, in dial-local polar coordinates. */
  function readActive(T, sec, st, L) {
    var cx = L.cx, cy = L.cy, R = L.R;
    /* Where the poised brush hovers while it is just marking time. It rides
       near the rim at the top and pulls in towards the middle at the bottom,
       because that is the shape of what a person standing in there can
       comfortably reach. The angle still reads the seconds. */
    var second = function () {
      var a = (sec / 60) * TAU;
      var reach = GEO.secondTrackTop - GEO.secondTrackDrop * (1 - Math.cos(a)) * 0.5;
      var r = R * (reach + 0.03 * Math.sin(sec * 0.9) + 0.018 * Math.sin(sec * 0.31 + 1.7));
      return U.polar(cx, cy, a, r);
    };
    var ink = { x: cx + R * GEO.inkX, y: cy + R * GEO.inkY };

    var minuteTip = function (frac, angle) {
      return U.polar(cx, cy, angle, R * U.lerp(GEO.minuteInner, GEO.minuteOuter, frac));
    };
    var hourTip = function (frac, angle) {
      return U.polar(cx, cy, angle, R * U.lerp(GEO.hourInner, GEO.hourOuter, frac));
    };

    /* Hour ceremony first — it owns the early part of those four minutes. */
    if (st.hourWork) {
      if (sec >= T.hWipeA - 1.3 && sec < T.hWipeB + 0.9) {
        var hp = U.clamp(U.invLerp(T.hWipeA, T.hWipeB, sec), 0, 1);
        var scrub = Math.sin(hp * 27) * 0.028;
        var p = hourTip(1 - U.easeInOutCubic(hp), st.hour.angle + scrub);
        var into = U.smootherstep(T.hWipeA - 1.3, T.hWipeA, sec);
        var outOf = U.smootherstep(T.hWipeB, T.hWipeB + 0.9, sec);
        return {
          pt: arcPt(arcPt(second(), p, into, 0.11), ink, outOf, -0.13),
          side: 'cloth', tight: 0.86 * into * (1 - outOf * 0.7), effort: 0.78, phase: 'hour-wipe'
        };
      }
      if (sec >= T.hWipeB + 0.9 && sec < T.hDrawA) {
        var app = U.smootherstep(T.hDrawA - 1.5, T.hDrawA, sec);
        var dip = { x: ink.x + Math.sin(sec * 7.1) * R * 0.02, y: ink.y + Math.abs(Math.sin(sec * 3.4)) * R * 0.03 };
        return {
          pt: arcPt(dip, hourTip(0, st.hour.nextAngle), app, 0.14),
          side: 'brush', tight: 0.3 + 0.6 * app, effort: 0.45, phase: 'hour-load'
        };
      }
      if (sec >= T.hDrawA && sec < T.hDrawB) {
        var hq = U.easeInOutCubic(U.clamp(U.invLerp(T.hDrawA, T.hDrawB, sec), 0, 1));
        return { pt: hourTip(hq, st.hour.nextAngle), side: 'brush', tight: 1, effort: 1, phase: 'hour-draw' };
      }
      if (sec >= T.hDrawB && sec < T.hDrawB + 1.6) {
        var off = U.smootherstep(T.hDrawB, T.hDrawB + 1.6, sec);
        return {
          pt: arcPt(hourTip(1, st.hour.nextAngle), second(), off, -0.10),
          side: 'brush', tight: 1 - off * 0.85, effort: 0.6 * (1 - off), phase: 'hour-lift'
        };
      }
    }

    if (sec >= T.wipeA - 1.3 && sec < T.wipeB + 1.0) {
      var mp = U.clamp(U.invLerp(T.wipeA, T.wipeB, sec), 0, 1);
      var wob = Math.sin(mp * 31) * 0.022 + Math.sin(mp * 12.3) * 0.012;
      var wp = minuteTip(1 - U.easeInOutCubic(mp), st.minute.angle + wob);
      var i1 = U.smootherstep(T.wipeA - 1.3, T.wipeA, sec);
      var o1 = U.smootherstep(T.wipeB, T.wipeB + 1.0, sec);
      return {
        pt: arcPt(arcPt(second(), wp, i1, 0.12), ink, o1, -0.13),
        side: 'cloth', tight: 0.88 * i1 * (1 - o1 * 0.7), effort: 0.8, phase: 'wipe'
      };
    }
    if (sec >= T.wipeB + 1.0 && sec < T.drawA) {
      var a2 = U.smootherstep(T.drawA - 1.6, T.drawA, sec);
      var dip2 = { x: ink.x + Math.sin(sec * 6.3) * R * 0.022, y: ink.y + Math.abs(Math.sin(sec * 3.1)) * R * 0.035 };
      return {
        pt: arcPt(dip2, minuteTip(0, st.minute.nextAngle), a2, 0.15),
        side: 'brush', tight: 0.3 + 0.65 * a2, effort: 0.5, phase: 'load'
      };
    }
    if (sec >= T.drawA) {
      var q = U.easeInOutCubic(U.clamp(U.invLerp(T.drawA, T.drawB, sec), 0, 1));
      return { pt: minuteTip(q, st.minute.nextAngle), side: 'brush', tight: 1, effort: 1, phase: 'draw' };
    }

    /* Just after the turn of the minute: peel away from the finished tip and
       fall back in with the seconds. */
    if (sec < 3.2) {
      var lift = U.smootherstep(0, 3.2, sec);
      return {
        pt: arcPt(minuteTip(1, st.minute.angle), second(), lift, -0.12),
        side: 'brush', tight: 1 - lift * 0.86, effort: 0.55 * (1 - lift) + 0.2, phase: 'lift'
      };
    }
    return { pt: second(), side: 'brush', tight: 0.14, effort: 0.22, phase: 'idle' };
  }

  function read(date, L) {
    var h = date.getHours(), m = date.getMinutes();
    var sec = date.getSeconds() + date.getMilliseconds() / 1000;
    var T = timings(date);
    var hourWork = HOUR_MINUTES.indexOf(m) !== -1;

    var st = {
      h: h, m: m, sec: sec, t: date.getTime(), hourWork: hourWork,
      minute: {
        angle: minuteAngle(m),
        nextAngle: minuteAngle(m + 1),
        prevAngle: minuteAngle(m - 1),
        live: 1, fresh: 0, wet: Math.exp(-sec / 17)
      },
      hour: {
        angle: hourAngle(h, Math.floor(m / 15) * 15),
        nextAngle: hourAngle(h, Math.floor(m / 15) * 15 + 15),
        live: 1, fresh: 0, wet: 0
      },
      T: T
    };

    /* How much of each hand is currently on the glass. */
    if (sec >= T.wipeA) {
      st.minute.live = 1 - U.easeInOutCubic(U.clamp(U.invLerp(T.wipeA, T.wipeB, sec), 0, 1));
    }
    if (sec >= T.drawA) {
      st.minute.fresh = U.easeInOutCubic(U.clamp(U.invLerp(T.drawA, T.drawB, sec), 0, 1));
    }
    if (hourWork) {
      if (sec >= T.hWipeA) {
        st.hour.live = 1 - U.easeInOutCubic(U.clamp(U.invLerp(T.hWipeA, T.hWipeB, sec), 0, 1));
      }
      if (sec >= T.hDrawA) {
        st.hour.fresh = U.easeInOutCubic(U.clamp(U.invLerp(T.hDrawA, T.hDrawB, sec), 0, 1));
        st.hour.wet = Math.exp(-Math.max(0, sec - T.hDrawB) / 22);
      }
    } else {
      /* Dries over the first couple of minutes after a quarter. */
      st.hour.wet = Math.exp(-((m % 15) * 60 + sec) / 90) * 0.7;
    }

    st.active = readActive(T, sec, st, L);
    st.phase = st.active.phase;
    return st;
  }

  C.schedule = {
    read: read, GEO: GEO, HOUR_MINUTES: HOUR_MINUTES,
    minuteAngle: minuteAngle, hourAngle: hourAngle
  };
})(typeof window !== 'undefined' ? window : globalThis);
