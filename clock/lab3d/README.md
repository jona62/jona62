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

Buttons: Run, Jump, Pick up, Throw, Slow-mo, Skeleton, Reset. Slow-mo plus
Skeleton is the useful combination — it fades the meshes and draws the bones,
joints and the line the centre of mass follows.

## What changed from the 2D lab

**Locomotion is planar.** Position and velocity are (x, z), he has a heading he
turns towards at a limited rate, and feet are placed either side of *that*
rather than either side of the screen. Foot placement still uses the capture
point: land under where the hips will be, plus half a stride along the heading.

**The skeleton solves in world space, y-up**, and hands out joint positions.
`rig3d.js` hangs geometry on them and knows nothing about biomechanics.

**Bones are oriented from an explicit basis**, not a shortest-arc rotation:
the bone's own axis is up and the cross-section is aligned to the body's right.
That is what lets a torso have an elliptical section rather than being a tube,
and stops limbs spinning about their own length as they swing.

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
- `body3d.js` is the third copy of the skeleton maths in this repository, after
  `../js/figure.js` and `../lab/body.js`. That is deliberate while the movement
  is being worked out and should collapse into one module before any of this
  goes back into the clock.

## Development

```
node ../tools/lab3dshot.js "click:jump,grid:6:150"
node ../tools/lab3dshot.js "click:grab,wait:3000,click:throw,grid:6:130"
```
