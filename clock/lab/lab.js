/* The sandbox: a stage, a body, a ball, and enough instrumentation to see what
 * the physics is actually doing. Nothing here is part of the clock — this is
 * where the movement gets worked out before it goes back in.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util;
  var TAU = U.TAU;

  var canvas, ctx, body, W, H, DPR, groundY, camX = 0, last = 0;
  var stature, ball, debug = false, slow = false;
  var pointer = { down: false, x: 0, y: 0 };
  var trace = [];
  var hud;

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
    if (body) { body.H = stature; body.groundY = groundY; }
  }

  function toWorld(cx, cy) { return { x: cx + camX, y: cy }; }

  function pointerAt(e) {
    var r = canvas.getBoundingClientRect();
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    return toWorld(t.clientX - r.left, t.clientY - r.top);
  }

  function setTarget(e) {
    var p = pointerAt(e);
    pointer.x = p.x; pointer.y = p.y;
    body.reach = { x: p.x, y: p.y };
    /* out of arm's reach, so he goes to it */
    if (Math.abs(p.x - body.x) > 0.42 * stature) {
      body.ctl.moveTo = p.x - Math.sign(p.x - body.x) * 0.28 * stature;
    }
  }

  function makeBall() {
    return { x: body ? body.x + 1.2 * stature : 0, y: groundY - 0.055 * stature,
      r: 0.055, vx: 0, vy: 0, held: false };
  }

  function stepBall(dt) {
    var b = ball, H2 = stature;
    if (b.held) { trace.length = 0; return; }
    b.vy += C.BODY_CONST.G * H2 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    var floor = groundY - b.r * H2;
    if (b.y > floor) {
      b.y = floor;
      if (Math.abs(b.vy) > 0.2 * H2) { b.vy *= -0.42; b.vx *= 0.86; }
      else { b.vy = 0; b.vx *= Math.exp(-2.2 * dt); }
    }
    if (Math.abs(b.vx) > 0.02 * H2 || b.y < floor - 1) {
      trace.push({ x: b.x, y: b.y });
      if (trace.length > 90) trace.shift();
    }
  }

  function drawStage() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f7f8fa');
    g.addColorStop(0.7, '#eef0f3');
    g.addColorStop(1, '#e6e9ee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* floor grid, a metre apart — 1 m is 1/1.75 of his height */
    var metre = stature / 1.75;
    ctx.save();
    ctx.translate(-camX, 0);
    ctx.strokeStyle = 'rgba(90,100,120,0.16)';
    ctx.lineWidth = 1;
    var startM = Math.floor((camX - W) / metre) - 1;
    var endM = Math.ceil((camX + W * 2) / metre) + 1;
    ctx.beginPath();
    for (var m = startM; m <= endM; m++) {
      ctx.moveTo(m * metre, groundY);
      ctx.lineTo(m * metre, groundY + H * 0.14);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60,70,90,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(camX - W, groundY);
    ctx.lineTo(camX + W * 2, groundY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(70,80,100,0.45)';
    ctx.font = '11px ui-monospace,Menlo,monospace';
    for (var m2 = startM; m2 <= endM; m2++) {
      if (m2 % 2 === 0) ctx.fillText(m2 + ' m', m2 * metre + 3, groundY + 14);
    }
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.translate(-camX, 0);
    if (trace.length > 1) {
      ctx.strokeStyle = 'rgba(200,90,70,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(trace[0].x, trace[0].y);
      for (var i = 1; i < trace.length; i++) ctx.lineTo(trace[i].x, trace[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    var r = ball.r * stature;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#4a4f58';
    ctx.beginPath();
    ctx.ellipse(ball.x, groundY, r * 1.1, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    var g = ctx.createRadialGradient(ball.x - r * 0.35, ball.y - r * 0.4, r * 0.1, ball.x, ball.y, r);
    g.addColorStop(0, '#e9765c');
    g.addColorStop(1, '#b8422c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawDebug(p) {
    ctx.save();
    ctx.translate(-camX, 0);
    var bones = [['pelvis', 'spine1'], ['shL', 'elbL'], ['elbL', 'handB'], ['shR', 'elbR'], ['elbR', 'handC'],
      ['hipL', 'kneeL'], ['kneeL', 'ankL'], ['hipR', 'kneeR'], ['kneeR', 'ankR']];
    ctx.strokeStyle = 'rgba(0,140,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 1; i < p.spine.length; i++) {
      ctx.moveTo(p.spine[i - 1].x, p.spine[i - 1].y);
      ctx.lineTo(p.spine[i].x, p.spine[i].y);
    }
    for (var b = 0; b < bones.length; b++) {
      var a = p[bones[b][0]], c2 = p[bones[b][1]];
      if (!a || !c2) continue;
      ctx.moveTo(a.x, a.y); ctx.lineTo(c2.x, c2.y);
    }
    ctx.moveTo(p.shL.x, p.shL.y); ctx.lineTo(p.shR.x, p.shR.y);
    ctx.moveTo(p.hipL.x, p.hipL.y); ctx.lineTo(p.hipR.x, p.hipR.y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,140,255,0.95)';
    ['shL', 'shR', 'elbL', 'elbR', 'handB', 'handC', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR'].forEach(function (k) {
      ctx.beginPath(); ctx.arc(p[k].x, p[k].y, 3.2, 0, TAU); ctx.fill();
    });

    /* support polygon and centre of mass */
    ctx.strokeStyle = 'rgba(30,160,90,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.support[0] - 0.03 * p.H, groundY + 4);
    ctx.lineTo(p.support[1] + 0.03 * p.H, groundY + 4);
    ctx.stroke();
    var inside = p.com.x > p.support[0] - 0.05 * p.H && p.com.x < p.support[1] + 0.05 * p.H;
    ctx.strokeStyle = inside ? 'rgba(30,160,90,0.9)' : 'rgba(220,60,50,0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p.com.x, p.com.y);
    ctx.lineTo(p.com.x, groundY + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = inside ? 'rgba(30,160,90,0.95)' : 'rgba(220,60,50,0.95)';
    ctx.beginPath(); ctx.arc(p.com.x, p.com.y, 5, 0, TAU); ctx.fill();

    if (Math.abs(body.vx) > 1) {
      ctx.strokeStyle = 'rgba(210,120,20,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(body.x, p.com.y);
      ctx.lineTo(body.x + body.vx * 0.22, p.com.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function frame(ts) {
    /* rAF's timestamp can predate the performance.now() taken just before the
       first request, so this delta can arrive negative. A negative dt makes
       every spring integrate backwards and blow up to NaN on frame one. */
    var dt = (ts - last) / 1000;
    if (!(dt > 0) || dt > 0.05) dt = 1 / 60;
    last = ts;
    if (slow) dt *= 0.3;

    if (pointer.down) setTarget(pointer.evt);
    body.step(dt, groundY);
    stepBall(dt);

    /* keep him in frame without snapping */
    var wantCam = body.x - W * 0.5;
    camX = U.damp(camX, wantCam, 3.2, dt);

    var p = body.pose({ cx: body.x, cy: groundY });

    drawStage();
    ctx.save();
    ctx.translate(-camX, 0);
    if (ball.held) drawBallHeld();
    C.bodyRender.draw(ctx, ctx, p, body.pal, {});
    ctx.restore();
    if (!ball.held) drawBall();
    if (debug) drawDebug(p);

    if (pointer.down) {
      ctx.save();
      ctx.translate(-camX, 0);
      ctx.strokeStyle = 'rgba(40,90,200,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 14, 0, TAU);
      ctx.moveTo(pointer.x - 20, pointer.y); ctx.lineTo(pointer.x + 20, pointer.y);
      ctx.moveTo(pointer.x, pointer.y - 20); ctx.lineTo(pointer.x, pointer.y + 20);
      ctx.stroke();
      ctx.restore();
    }

    var ms = (Math.abs(body.vx) / stature * 1.75).toFixed(2);
    var airH = body.y < 0 ? (-body.y / stature * 1.75).toFixed(2) : '0.00';
    hud.textContent = 'state ' + body.state.padEnd(11) +
      ' speed ' + ms + ' m/s   height ' + airH + ' m   ' +
      (body.held ? 'carrying' : 'empty handed');
    global.requestAnimationFrame(frame);
  }

  function drawBallHeld() {
    var h = body.handPos(body.throwHand);
    if (!h) return;
    var r = ball.r * stature;
    var g = ctx.createRadialGradient(h.x - r * 0.35, h.y - r * 0.4, r * 0.1, h.x, h.y, r);
    g.addColorStop(0, '#e9765c');
    g.addColorStop(1, '#b8422c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, TAU);
    ctx.fill();
  }

  function button(id, fn) {
    var el = document.getElementById(id);
    var fire = function (e) { e.preventDefault(); fn(el); };
    el.addEventListener('click', fire);
    el.addEventListener('touchstart', fire, { passive: false });
    return el;
  }

  function start() {
    canvas = document.getElementById('stage');
    hud = document.getElementById('hud');
    resize();
    body = new C.Body(stature);
    global.__body = body;   /* dev handle for the headless harness */
    body.x = 0;
    body.groundY = groundY;
    body.feet[0].x = -0.07 * stature;
    body.feet[1].x = 0.07 * stature;
    ball = makeBall();

    global.addEventListener('resize', function () { resize(); });

    var down = function (e) { pointer.down = true; pointer.evt = e; setTarget(e); e.preventDefault(); };
    var move = function (e) { if (pointer.down) { pointer.evt = e; setTarget(e); e.preventDefault(); } };
    var up = function () { pointer.down = false; body.reach = null; };
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    global.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    global.addEventListener('touchend', up);

    button('run', function (el) {
      body.ctl.run = !body.ctl.run;
      el.classList.toggle('on', body.ctl.run);
    });
    button('jump', function () { body.jump(); });
    button('grab', function (el) {
      if (body.held) { body.release(); body.held = null; ball.held = false; ball.vx = body.vx * 0.5; ball.vy = 0; }
      else { body.startPickup(ball); }
      el.classList.toggle('on', !!body.held);
    });
    button('throw', function () { body.startThrow(); });
    button('reset', function () {
      ball = makeBall(); body.held = null; trace.length = 0;
      body.x = 0; body.vx = 0; body.y = 0; body.vy = 0; body.state = 'ground';
      body.feet[0].x = -0.07 * stature; body.feet[1].x = 0.07 * stature;
    });
    button('skel', function (el) { debug = !debug; el.classList.toggle('on', debug); });
    button('slow', function (el) { slow = !slow; el.classList.toggle('on', slow); });

    last = global.performance.now();
    global.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
