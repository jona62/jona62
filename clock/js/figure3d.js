/* The painter, rendered as a body rather than a silhouette.
 *
 * The clock's figure used to be flat shapes on a 2D canvas. This renders the
 * same rig — the same js/rig.js pose, the same lofted skin as the sandbox —
 * into an offscreen WebGL canvas, which the clock then blurs and composites
 * exactly as it did the flat one. Everything else about the clock is unchanged:
 * the panel, the dial, the painted hands and the housing are still 2D canvas.
 *
 * The camera is set up to reproduce `draw2d.project` exactly, so a point on the
 * panel still lands where the schedule says it does. That mapping is a pinhole
 * at distance f on the z axis with unit scale at z = 0, so:
 *
 *   fov    = 2 atan(h / 2f)      gives one pixel per world unit at z = 0
 *   camera = (0, groundY - cy, f) looking down -z
 *
 * with the principal point at the viewport centre, which is where the clock
 * puts it. Get this wrong by a hair and the brush stops meeting its own stroke.
 */
(function (global) {
  'use strict';
  var C = global.CLOCK;

  function Figure3D(THREE, palette) {
    this.THREE = THREE;
    this.palette = palette;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearAlpha(0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);

    /* The panel is lit from behind him, so he is a colour-bled shape rather
       than a modelled figure: mostly flat light, a little rim from behind to
       keep some form, and nothing that would read as a studio key. */
    this.scene.add(new THREE.AmbientLight(0xffffff, 2.0));
    var back = new THREE.DirectionalLight(0xffffff, 1.5);
    back.position.set(-0.3, 0.9, -1);
    this.scene.add(back);
    var fill = new THREE.DirectionalLight(0xdfe8f4, 0.7);
    fill.position.set(0.6, 0.4, 1);
    this.scene.add(fill);

    this.skin = null;
    this.H = 0;
  }

  Figure3D.prototype.resize = function (L, scale) {
    var THREE = this.THREE;
    var w = Math.max(2, Math.round(L.w * scale));
    var h = Math.max(2, Math.round(L.h * scale));
    this.renderer.setSize(w, h, false);
    var f = L.fig.H * 4;
    this.camera.fov = 2 * Math.atan(L.h / (2 * f)) * 180 / Math.PI;
    this.camera.aspect = L.w / L.h;
    var cy = L.fig.feetY - L.cy;
    this.camera.position.set(0, cy, f);
    this.camera.lookAt(0, cy, 0);
    this.camera.updateProjectionMatrix();
    if (!this.skin || Math.abs(this.H - L.fig.H) > 0.5) {
      if (this.skin) this.scene.remove(this.skin.group);
      this.skin = new C.Skin3D(THREE, L.fig.H, this.palette);
      this.scene.add(this.skin.group);
      this.H = L.fig.H;
    }
  };

  Figure3D.prototype.render = function (worldPose) {
    this.skin.update(worldPose);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  };

  C.Figure3D = Figure3D;
})(typeof window !== 'undefined' ? window : globalThis);
