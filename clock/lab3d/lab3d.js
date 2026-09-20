/* The 3D sandbox: scene, orbit camera, touch, and a ball to throw.
 * World units are metres — he is 1.75 of them — so the physics constants read
 * as themselves and the grid is a real metre grid.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK, U = C.util, V = C.rig;
  var THREE = global.THREE;

  var H = 1.75;
  var renderer, scene, camera, skin, body, ball, ballMesh, ground, hud, canvasEl;
  var bones, boneGeo, bonePos, comDot, keys = {};
  var cam = { yaw: 0.55, pitch: 0.30, dist: 5.2, tx: 0, ty: 0.9, tz: 0 };
  var slow = false, skel = false, last = 0;
  var drag = { on: false, x: 0, y: 0, moved: 0, t0: 0, pinch: 0 };
  var trail = null, trailPos, trailN = 0;

  function makeBall() {
    return { pos: V.v(1.6, 0.11, 0.4), vel: V.v(0, 0, 0), r: 0.11, held: false };
  }

  function init() {
    canvasEl = document.getElementById('stage');
    hud = document.getElementById('hud');
    /* preserveDrawingBuffer so the canvas can be read back after presentation —
       without it any screenshot or drawImage of this canvas comes out blank */
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#e8ecf1');
    scene.fog = new THREE.Fog('#e8ecf1', 14, 34);

    camera = new THREE.PerspectiveCamera(42, 1, 0.05, 120);

    var hemi = new THREE.HemisphereLight('#dfe8f4', '#b9b3a6', 1.5);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight('#fff6e8', 2.1);
    sun.position.set(3.2, 6.4, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    var sc = sun.shadow.camera;
    sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.near = 0.5; sc.far = 22;
    sun.shadow.bias = -0.0015;
    scene.add(sun);
    scene.add(sun.target);
    global.__sun = sun;

    ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: '#dfe3e9', roughness: 0.96 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    var grid = new THREE.GridHelper(80, 80, 0x9aa5b5, 0xc3cad4);
    grid.material.opacity = 0.6;
    grid.material.transparent = true;
    grid.position.y = 0.002;
    scene.add(grid);

    body = new C.rig.Body(H, 7);
    body.feet[0].x = -0.065 * H; body.feet[1].x = 0.065 * H;
    global.__body = body;
    skin = new C.Skin3D(THREE, H, {
      shirt: '#5f77d4', trouser: '#39405e', skin: '#d5a684', cap: '#42539f'
    });
    scene.add(skin.group);

    bonePos = new Float32Array(3 * 2 * 16);
    boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute('position', new THREE.BufferAttribute(bonePos, 3));
    bones = new THREE.LineSegments(boneGeo,
      new THREE.LineBasicMaterial({ color: 0x0090ff, depthTest: false }));
    bones.frustumCulled = false;
    bones.visible = false;
    scene.add(bones);
    comDot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x1ea05a, depthTest: false }));
    comDot.visible = false;
    scene.add(comDot);

    ball = makeBall();
    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(ball.r, 20, 14),
      new THREE.MeshStandardMaterial({ color: '#d4573c', roughness: 0.6 }));
    ballMesh.castShadow = true;
    scene.add(ballMesh);

    trailPos = new Float32Array(3 * 120);
    var tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xc0563c, transparent: true, opacity: 0.55 }));
    trail.frustumCulled = false;
    scene.add(trail);

    resize();
    global.addEventListener('resize', resize);
    bindInput();
    last = global.performance.now();
    global.requestAnimationFrame(frame);
    /* dev handle: the view harness orbits the camera through this */
    global.__setCamYaw = function (y) { cam.yaw = y; };
    global.__setCam = function (o) {
      if (o.yaw !== undefined) cam.yaw = o.yaw;
      if (o.dist !== undefined) cam.dist = o.dist;
      if (o.pitch !== undefined) cam.pitch = o.pitch;
      if (o.ty !== undefined) { cam.ty = o.ty; cam.lockY = o.ty; }
    };
  }

  function resize() {
    var bar = document.getElementById('bar').offsetHeight;
    var w = global.innerWidth, h = global.innerHeight - bar;
    renderer.setSize(w, h, false);
    canvasEl.style.width = w + 'px';
    canvasEl.style.height = h + 'px';
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  /* --- input: drag orbits, tap moves him, tapping the ball picks it up --- */
  function bindInput() {
    var el = canvasEl;
    el.addEventListener('pointerdown', function (e) {
      drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0;
      drag.t0 = performance.now();
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag.on) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      cam.yaw -= dx * 0.008;
      cam.pitch = U.clamp(cam.pitch + dy * 0.006, -0.15, 1.25);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    el.addEventListener('pointerup', function (e) {
      if (drag.on && drag.moved < 10 && performance.now() - drag.t0 < 400) tap(e);
      drag.on = false;
    });
    el.addEventListener('pointercancel', function () { drag.on = false; });
    el.addEventListener('wheel', function (e) {
      cam.dist = U.clamp(cam.dist * (1 + e.deltaY * 0.0012), 1.8, 16);
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
        if (drag.pinch) cam.dist = U.clamp(cam.dist * (drag.pinch / d), 1.8, 16);
        drag.pinch = d;
        drag.on = false;
        e.preventDefault();
      }
    }, { passive: false });
    el.addEventListener('touchend', function () { drag.pinch = 0; });
  }

  function tap(e) {
    var r = canvasEl.getBoundingClientRect();
    var ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1);
    var ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    if (!ball.held) {
      var hit = ray.intersectObject(ballMesh);
      if (hit.length) { body.startPickup(ball); return; }
    }
    var g = ray.intersectObject(ground);
    if (g.length) {
      var p = g[0].point;
      body.ctl.moveTo = { x: p.x, z: p.z };
    }
  }

  function stepBall(dt) {
    if (ball.held) { trailN = 0; trail.geometry.setDrawRange(0, 0); return; }
    ball.vel.y -= C.rig.G * H * dt;
    ball.pos = V.add(ball.pos, V.mul(ball.vel, dt));
    if (ball.pos.y < ball.r) {
      ball.pos.y = ball.r;
      if (Math.abs(ball.vel.y) > 0.35) {
        ball.vel.y *= -0.45; ball.vel.x *= 0.88; ball.vel.z *= 0.88;
      } else {
        ball.vel.y = 0;
        ball.vel.x *= Math.exp(-2.0 * dt); ball.vel.z *= Math.exp(-2.0 * dt);
      }
    }
    if (V.len(ball.vel) > 0.15 && trailN < 120) {
      trailPos[trailN * 3] = ball.pos.x;
      trailPos[trailN * 3 + 1] = ball.pos.y;
      trailPos[trailN * 3 + 2] = ball.pos.z;
      trailN++;
      trail.geometry.attributes.position.needsUpdate = true;
      trail.geometry.setDrawRange(0, trailN);
    }
  }

  function frame(ts) {
    /* rAF's timestamp can predate the performance.now() taken just before the
       first request, so this delta can arrive negative. A negative dt makes
       every spring integrate backwards and blow up to NaN on frame one. */
    var dt = (ts - last) / 1000;
    if (!(dt > 0) || dt > 0.05) dt = 1 / 60;
    last = ts;
    if (slow) dt *= 0.3;

    body.step(dt);
    stepBall(dt);
    readKeys();
    var p = body.pose();
    skin.update(p);
    if (bones.visible) updateBones(p);
    ballMesh.position.set(ball.pos.x, ball.pos.y, ball.pos.z);

    cam.tx = U.damp(cam.tx, body.pos.x, 3.2, dt);
    cam.tz = U.damp(cam.tz, body.pos.z, 3.2, dt);
    cam.ty = cam.lockY !== undefined ? cam.lockY : U.damp(cam.ty, 0.9 + body.yOff * 0.5, 4, dt);
    var cy = Math.cos(cam.pitch);
    camera.position.set(
      cam.tx + Math.sin(cam.yaw) * cam.dist * cy,
      cam.ty + Math.sin(cam.pitch) * cam.dist,
      cam.tz + Math.cos(cam.yaw) * cam.dist * cy);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    global.__sun.position.set(cam.tx + 3.2, 6.4, cam.tz + 2.6);
    global.__sun.target.position.set(cam.tx, 0, cam.tz);
    global.__sun.target.updateMatrixWorld();

    renderer.render(scene, camera);

    hud.textContent = 'state ' + p.state.padEnd(11) +
      ' speed ' + p.speed.toFixed(2) + ' m/s   height ' + body.yOff.toFixed(2) + ' m   ' +
      (body.held ? 'carrying' : 'empty handed');
    global.requestAnimationFrame(frame);
  }

  var BONE_PAIRS = [['pelvis', 'spine1'], ['spine1', 'spine2'], ['spine2', 'chest'], ['shL', 'shR'],
    ['hipL', 'hipR'], ['shL', 'elbL'], ['elbL', 'handL'], ['shR', 'elbR'], ['elbR', 'handR'],
    ['hipL', 'kneeL'], ['kneeL', 'ankL'], ['hipR', 'kneeR'], ['kneeR', 'ankR'], ['chest', 'head']];

  function updateBones(p) {
    var get = function (k) {
      if (k === 'spine1') return p.spine[1];
      if (k === 'spine2') return p.spine[2];
      return p[k];
    };
    var n = 0;
    for (var i = 0; i < BONE_PAIRS.length; i++) {
      var a = get(BONE_PAIRS[i][0]), b = get(BONE_PAIRS[i][1]);
      bonePos[n++] = a.x; bonePos[n++] = a.y; bonePos[n++] = a.z;
      bonePos[n++] = b.x; bonePos[n++] = b.y; bonePos[n++] = b.z;
    }
    boneGeo.attributes.position.needsUpdate = true;
    boneGeo.setDrawRange(0, BONE_PAIRS.length * 2);
    comDot.position.set(p.com.x, p.com.y, p.com.z);
    var lo = Math.min(p.support[0].x, p.support[1].x) - 0.12;
    var hi = Math.max(p.support[0].x, p.support[1].x) + 0.12;
    comDot.material.color.setHex(p.com.x > lo && p.com.x < hi ? 0x1ea05a : 0xdc3c32);
  }

  /* Keyboard: movement is relative to the camera, so forward is always away
     from you however far you have orbited round. */
  function readKeys() {
    if (!body) return;
    var f = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
    var r = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    if (!f && !r) { body.ctl.moveDir = null; return; }
    var cf = { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) };
    var cr = { x: Math.cos(cam.yaw), z: -Math.sin(cam.yaw) };
    body.ctl.moveDir = { x: cf.x * f + cr.x * r, z: cf.z * f + cr.z * r };
    body.ctl.moveTo = null;
  }

  var MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '];
  function bindKeys() {
    var press = function (e, down) {
      var k = (e.key || '').toLowerCase();
      if (MOVE_KEYS.indexOf(k) >= 0) e.preventDefault();
      if (k === 'shift') {
        body.ctl.run = down;
        document.getElementById('run').classList.toggle('on', down);
        return;
      }
      keys[k] = down;
      if (!down) return;
      if (k === ' ') body.jump();
      else if (k === 'e') document.getElementById('grab').click();
      else if (k === 'f') body.startThrow();
      else if (k === 'x') document.getElementById('skel').click();
      else if (k === 'z') document.getElementById('slow').click();
      else if (k === 'r') document.getElementById('reset').click();
      else if (k === 'q') cam.yaw -= 0.3;
      else if (k === 'c') cam.yaw += 0.3;
    };
    global.addEventListener('keydown', function (e) { press(e, true); });
    global.addEventListener('keyup', function (e) { press(e, false); });
  }

  function button(id, fn) {
    var el = document.getElementById(id);
    el.addEventListener('click', function (e) { e.preventDefault(); el.blur(); fn(el); });
    return el;
  }

  function start() {
    if (!global.THREE) {
      document.getElementById('hud').textContent =
        'three.js did not load — this page needs a network connection';
      return;
    }
    THREE = global.THREE;
    init();
    bindKeys();
    button('run', function (el) { body.ctl.run = !body.ctl.run; el.classList.toggle('on', body.ctl.run); });
    button('jump', function () { body.jump(); });
    button('grab', function () {
      if (body.held) { body.release(); ball.held = false; ball.vel = V.v(0, 0, 0); }
      else body.startPickup(ball);
    });
    button('throw', function () { body.startThrow(); });
    button('slow', function (el) { slow = !slow; el.classList.toggle('on', slow); });
    button('skel', function (el) {
      skel = !skel;
      skin.setSkeleton(skel);
      bones.visible = skel; comDot.visible = skel;
      el.classList.toggle('on', skel);
    });
    button('reset', function () {
      ball = makeBall(); body.held = null; trailN = 0;
      trail.geometry.setDrawRange(0, 0);
      body.pos = V.v(0, 0, 0); body.vel = V.v(0, 0, 0); body.want = V.v(0, 0, 0);
      body.yOff = 0; body.vy = 0; body.state = 'ground'; body.yaw = 0;
      body.feet[0].x = -0.065 * H; body.feet[0].z = 0;
      body.feet[1].x = 0.065 * H; body.feet[1].z = 0;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
