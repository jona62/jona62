# Body Lab 3D

The rig in three dimensions. Same anthropometry and the same solve as the clock
and the 2D lab, but the world is y-up with a ground plane, he walks on it
rather than along a line, and the geometry is real: meshes, lights, shadows,
and a camera you can walk around him with.

Open `lab3d/index.html`.

| gesture | what it does |
| --- | --- |
| drag | orbit the camera |
| pinch / wheel | dolly in and out |
| tap the ground | send him there |
| tap the ball | go and pick it up |

Keyboard: **WASD** or the arrow keys walk (relative to the camera, so forward
is always away from you), **shift** runs, **space** jumps, **E** picks up or
drops, **F** throws, **Q**/**C** turn the camera, **X** skeleton, **Z**
slow-motion, **R** reset.

Buttons: Run, Jump, Pick up, Throw, Slow-mo, Skeleton, Reset. Slow-mo plus
Skeleton is the useful combination — it fades the meshes and draws the bones,
joints and the line the centre of mass follows.

## What changed from the 2D lab

**Locomotion is planar.** Position and velocity are (x, z), he has a heading he
turns towards at a limited rate, and feet are placed either side of *that*
rather than either side of the screen. Foot placement still uses the capture
point: land under where the hips will be, plus half a stride along the heading.

**The skeleton solves in world space, y-up**, and hands out joint positions.
`skin3d.js` hangs geometry on them and knows nothing about biomechanics. The
body is `../js/rig.js` — the same module the clock and the 2D lab use.

**Limbs are lofted surfaces, not assemblies.** Cylinders meeting at spheres is
what made the first version read as a robot: every joint was a seam between two
hard primitives and every limb had one thickness end to end. Each limb is now a
single surface — rings of vertices swept along a Catmull-Rom curve through the
joints, with an elliptical section whose radius follows an anatomical profile —
so the elbow is a bend in a continuous arm. The torso is one loft from hips to
trapezius, so the shoulders slope into the neck instead of being bolted on.

Ring frames are carried from the body's own right vector rather than from a
shortest-arc rotation, which stops the section spinning about the limb as it
swings — the usual cause of a subtle, hard-to-place wrongness. Caps are wound
both ways and drawn double-sided: a loft whose end you can see into reads as a
paper cut-out, and getting cap winding wrong fails silently.

Shadows do a lot of work here that no amount of rigging can: the moment the
shadow separates from the feet, the jump reads as a jump.

## three.js

r160 (`vendor/three.min.js`, UMD) is vendored rather than loaded from a CDN, so
the lab runs offline and from `file://` like everything else here. r160 is the
last release to ship a UMD build; later ones are ES modules only, which cannot
be loaded with a plain script tag.

The renderer sets `preserveDrawingBuffer` so the canvas survives being read
back — without it every screenshot of a WebGL canvas comes out blank.

## Known gaps

- Nothing collides except the ground: he walks through the ball rather than
  kicking it, and nothing can push him over.
- The camera orbits but never collides or auto-frames.
- Hands and the head are still placed primitives rather than lofted, so they
  are the least convincing parts close up.

## Development

```
node ../tools/lab3dshot.js "click:jump,grid:6:150"
node ../tools/lab3dshot.js "click:grab,wait:3000,click:throw,grid:6:130"
```
