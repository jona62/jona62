/* The 2D sandbox: the same body as the clock and the 3D lab, drawn flat and
 * sharp so the silhouette can be judged. Nothing here is part of the clock.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util, R = C.rig;
  var TAU = U.TAU;

  var canvas, ctx, body, W, H, DPR, groundY, camX = 0, last = 0;
  var stature, ball, debug = false, slow = false, lag = {}, keys = {};
  var pointer = { down: false, x: 0, y: 0, evt: null };
  var trace = [], hud;

  function resize() {
    W = global.innerWidth;
    H = global.innerHeight - document.getElementById('bar').offsetHeight;
    DPR = Math.min(2, global.devicePixelRatio || 1);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx = canvas.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    stature = U.clamp(Math.min(H * 0.58, W * 0.42), 150, 520);
    groundY = H * 0.86;
    if (body) body.H = stature;
  }

  function view() {
    return { cx: W * 0.5, px: W * 0.5, py: groundY, ox: camX, groundY: groundY, f: stature * 4 };
  }
  function toWorld(sx, sy) {
    return { x: sx - W * 0.5 + camX, y: groundY - sy, z: 0 };
  }

  function makeBall() {
    return { pos: R.v(body ? body.pos.x + 1.2 * stature : 0, 0.055 * stature, 0),
      vel: R.v(0, 0, 0), r: 0.055, held: false };
  }

  function setTarget(e) {
    var r = canvas.getBoundingClientRect();
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    var p = toWorld(t.clientX - r.left, t.clientY - r.top);
    pointer.x = p.x; pointer.y = p.y;
    body.reach = { side: 'R', point: R.v(p.x, p.y, 0.10 * stature), tight: 0.7, effort: 0.5 };
    if (Math.abs(p.x - body.pos.x) > 0.42 * stature) {
      body.ctl.moveTo = { x: p.x - Math.sign(p.x - body.pos.x) * 0.28 * stature, z: 0 };
    }
  }

  function stepBall(dt) {
    var b = ball, S = stature;
    if (b.held) { trace.length = 0; return; }
    b.vel.y -= R.G * S * dt;
    b.pos = R.add(b.pos, R.mul(b.vel, dt));
    var floor = b.r * S;
    if (b.pos.y < floor) {
      b.pos.y = floor;
      if (Math.abs(b.vel.y) > 0.2 * S) { b.vel.y *= -0.42; b.vel.x *= 0.86; }
      else { b.vel.y = 0; b.vel.x *= Math.exp(-2.2 * dt); }
    }
    if (Math.abs(b.vel.x) > 0.02 * S || b.pos.y > floor + 1) {
      trace.push({ x: b.pos.x, y: b.pos.y });
      if (trace.length > 90) trace.shift();
    }
  }

  function drawStage() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f7f8fa'); g.addColorStop(0.7, '#eef0f3'); g.addColorStop(1, '#e6e9ee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var metre = stature / 1.75;
    ctx.save();
    ctx.translate(W * 0.5 - camX, 0);
    ctx.strokeStyle = 'rgba(90,100,120,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var m = Math.floor((camX - W) / metre) - 1; m <= Math.ceil((camX + W) / metre) + 1; m++) {
      ctx.moveTo(m * metre, groundY); ctx.lineTo(m * metre, groundY + H * 0.14);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60,70,90,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(camX - W, groundY); ctx.lineTo(camX + W * 2, groundY);
    ctx.stroke();
    ctx.restore();
  }

  function worldToScreen(p) {
    return { x: W * 0.5 + (p.x - camX), y: groundY - p.y };
  }

  function drawBall() {
    var r = ball.r * stature, c = worldToScreen(ball.pos);
    ctx.save();
    if (trace.length > 1) {
      ctx.strokeStyle = 'rgba(200,90,70,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      var s0 = worldToScreen(trace[0]);
      ctx.moveTo(s0.x, s0.y);
      for (var i = 1; i < trace.length; i++) {
        var si = worldToScreen(trace[i]);
        ctx.lineTo(si.x, si.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#4a4f58';
    ctx.beginPath();
    ctx.ellipse(c.x, groundY, r * 1.1, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    var g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.4, r * 0.1, c.x, c.y, r);
    g.addColorStop(0, '#e9765c'); g.addColorStop(1, '#b8422c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawDebug(w, p) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,140,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 1; i < p.spine.length; i++) {
      ctx.moveTo(p.spine[i - 1].x, p.spine[i - 1].y);
      ctx.lineTo(p.spine[i].x, p.spine[i].y);
    }
    [['shL', 'elbL'], ['elbL', 'handB'], ['shR', 'elbR'], ['elbR', 'handC'],
      ['hipL', 'kneeL'], ['kneeL', 'ankL'], ['hipR', 'kneeR'], ['kneeR', 'ankR'],
      ['shL', 'shR'], ['hipL', 'hipR']].forEach(function (b) {
      ctx.moveTo(p[b[0]].x, p[b[0]].y); ctx.lineTo(p[b[1]].x, p[b[1]].y);
    });
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,140,255,0.95)';
    ['shL', 'shR', 'elbL', 'elbR', 'handB', 'handC', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR']
      .forEach(function (k) { ctx.beginPath(); ctx.arc(p[k].x, p[k].y, 3.2, 0, TAU); ctx.fill(); });

    var s0 = worldToScreen(w.support[0]), s1 = worldToScreen(w.support[1]);
    ctx.strokeStyle = 'rgba(30,160,90,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(Math.min(s0.x, s1.x) - 0.03 * w.H, groundY + 4);
    ctx.lineTo(Math.max(s0.x, s1.x) + 0.03 * w.H, groundY + 4);
    ctx.stroke();
    var com = worldToScreen(w.com);
    var inside = w.com.x > Math.min(w.support[0].x, w.support[1].x) - 0.05 * w.H &&
      w.com.x < Math.max(w.support[0].x, w.support[1].x) + 0.05 * w.H;
    ctx.strokeStyle = inside ? 'rgba(30,160,90,0.9)' : 'rgba(220,60,50,0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(com.x, com.y); ctx.lineTo(com.x, groundY + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = inside ? 'rgba(30,160,90,0.95)' : 'rgba(220,60,50,0.95)';
    ctx.beginPath();
    ctx.arc(com.x, com.y, 5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function readKeys() {
    var r = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    body.ctl.moveDir = r ? { x: r, z: 0 } : null;
    if (r) body.ctl.moveTo = null;
  }

  function frame(ts) {
    /* rAF's timestamp can predate the performance.now() taken just before the
       first request, and a negative delta makes every spring blow up. */
    var dt = (ts - last) / 1000;
    if (!(dt > 0) || dt > 0.05) dt = 1 / 60;
    last = ts;
    if (slow) dt *= 0.3;

    if (pointer.down && pointer.evt) setTarget(pointer.evt);
    readKeys();
    body.step(dt);
    stepBall(dt);
    camX = U.damp(camX, body.pos.x, 3.2, dt);

    var w = body.pose();
    w.toolLeft = false;
    var p = C.draw2d.project(w, view(), lag, dt);

    drawStage();
    C.draw2d.draw(ctx, ctx, p, C.PALETTES[0], {});
    if (!ball.held) drawBall(); else drawHeld();
    if (debug) drawDebug(w, p);

    if (pointer.down) {
      var c = worldToScreen({ x: pointer.x, y: pointer.y });
      ctx.save();
      ctx.strokeStyle = 'rgba(40,90,200,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 14, 0, TAU);
      ctx.moveTo(c.x - 20, c.y); ctx.lineTo(c.x + 20, c.y);
      ctx.moveTo(c.x, c.y - 20); ctx.lineTo(c.x, c.y + 20);
      ctx.stroke();
      ctx.restore();
    }

    hud.textContent = 'state ' + w.state.padEnd(11) +
      ' speed ' + (w.speed / stature * 1.75).toFixed(2) + ' m/s   height ' +
      (body.yOff / stature * 1.75).toFixed(2) + ' m   ' + (body.held ? 'carrying' : 'empty handed');
    global.requestAnimationFrame(frame);
  }

  function drawHeld() {
    var h = body.handWorld('R');
    if (!h) return;
    var c = worldToScreen(h), r = ball.r * stature;
    var g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.4, r * 0.1, c.x, c.y, r);
    g.addColorStop(0, '#e9765c'); g.addColorStop(1, '#b8422c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, TAU);
    ctx.fill();
  }

  function button(id, fn) {
    var el = document.getElementById(id);
    var fire = function (e) { e.preventDefault(); el.blur(); fn(el); };
    el.addEventListener('click', fire);
    el.addEventListener('touchstart', fire, { passive: false });
    return el;
  }

  function start() {
    canvas = document.getElementById('stage');
    hud = document.getElementById('hud');
    resize();
    body = new C.rig.Body(stature, 21);
    body.ctl.faceTo = 0;
    body.feet[0].x = -0.065 * stature;
    body.feet[1].x = 0.065 * stature;
    global.__body = body;
    ball = makeBall();

    global.addEventListener('resize', resize);
    var down = function (e) { pointer.down = true; pointer.evt = e; setTarget(e); e.preventDefault(); };
    var move = function (e) { if (pointer.down) { pointer.evt = e; setTarget(e); e.preventDefault(); } };
    var up = function () { pointer.down = false; pointer.evt = null; body.reach = null; };
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    global.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    global.addEventListener('touchend', up);

    var press = function (e, dn) {
      var k = (e.key || '').toLowerCase();
      if (['a', 'd', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
      if (k === 'shift') { body.ctl.run = dn; document.getElementById('run').classList.toggle('on', dn); return; }
      keys[k] = dn;
      if (!dn) return;
      if (k === ' ') body.jump();
      else if (k === 'e') document.getElementById('grab').click();
      else if (k === 'f') body.startThrow();
      else if (k === 'x') document.getElementById('skel').click();
      else if (k === 'z') document.getElementById('slow').click();
      else if (k === 'r') document.getElementById('reset').click();
    };
    global.addEventListener('keydown', function (e) { press(e, true); });
    global.addEventListener('keyup', function (e) { press(e, false); });

    button('run', function (el) { body.ctl.run = !body.ctl.run; el.classList.toggle('on', body.ctl.run); });
    button('jump', function () { body.jump(); });
    button('grab', function () {
      if (body.held) { body.release(); ball.held = false; ball.vel = R.v(0, 0, 0); }
      else body.startPickup(ball);
    });
    button('throw', function () { body.startThrow(); });
    button('slow', function (el) { slow = !slow; el.classList.toggle('on', slow); });
    button('skel', function (el) { debug = !debug; el.classList.toggle('on', debug); });
    button('reset', function () {
      ball = makeBall(); body.held = null; trace.length = 0;
      body.pos = R.v(0, 0, 0); body.vel = R.v(0, 0, 0); body.want = R.v(0, 0, 0);
      body.yOff = 0; body.vy = 0; body.state = 'ground';
      body.feet[0].x = -0.065 * stature; body.feet[1].x = 0.065 * stature;
    });

    last = global.performance.now();
    global.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
