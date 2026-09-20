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

**Everything is a lofted surface**, including the head and the hands. The head
is a stack of rings from the chin to the crown with separate width and depth
profiles and a per-ring forward offset, so the jaw is narrow, the cheekbones
are the widest point, the cranium is deeper than it is wide, and the face plane
sits forward of the axis while the crown sits behind it. The hands are
flattened paddles run along the forearm. Neither is a sphere with a scale on
it, and the head grows out of the neck rather than balancing on it.

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

**Limb roots are pinholes with joint masses over them.** Each limb starts at a
ring small enough to vanish inside the trunk and opens to full width a tenth of
the way along; a wide root ring produced flared trouser mouths at the hips. But
a limb rooted at a fixed point tears away from the trunk the moment it swings
up, because the root stops being inside — so a deltoid at each shoulder and a
femoral mass at each hip sit on the joint itself, in the colour of whatever
covers them, swallowed from both sides. The torso loft also carries the
shoulder line and narrows into the trapezius above it: stop it at the chest and
the shoulder joint floats 0.035 H clear of the ribcage with nothing under the
sleeve, which is what puts a man in shoulder pads.

**The profiles are girths, not guesses.** They are radii as fractions of
stature, derived from circumferences — an upper arm is about 32 cm around, so
10 cm across, so 0.029 H of radius. Eyeballing them produced a body about 1.7x
too thick everywhere, which reads as inflated however good the proportions
between the joints are. Cloth clears the limb under it by a real margin too:
run a sleeve within a millimetre of an arm and the skin z-fights through it,
which looks like a gap rather than the coincident surfaces it is.

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
- The cap, the peak and the ears are still placed primitives.
- Fingers are implied by the shape of the hand, not modelled.

## Development

```
node ../tools/lab3dshot.js "click:jump,grid:6:150"
node ../tools/lab3dshot.js "click:grab,wait:3000,click:throw,grid:6:130"
node ../tools/views3d.js reach          # the same pose from four sides
DIST=1.3 TY=1.55 node ../tools/views3d.js idle    # close on the head
```

`views3d.js` is the one that matters for the body: joint seams only show from
certain angles and in certain poses, so it orbits a held pose (`idle`, `reach`,
`crouch`, `run`, `jump`) and tiles front, left, back and right. Every junction
fault in this file was found that way and none of them were visible head-on.
