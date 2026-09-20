# Body Lab

A sandbox for the clock painter's rig, away from the clock. The figure here is
drawn sharp and life-size on a metre grid, because nothing about body structure
can be judged through the diffusion of the clock panel.

The body itself is `../js/rig.js`, shared with the clock and the 3D lab; this
page is only a controller and a stage.

Open `lab/index.html`. Drag anywhere — he reaches for your finger, and walks to
it if it is out of reach.

| control | what it exercises |
| --- | --- |
| drag | reach, whole-body support of a reach, stepping when it runs out |
| Run | cadence and stride against speed, flight phase, forward lean, arm counter-swing |
| Jump | crouch, push-off, ballistic flight, landing absorption |
| Pick up | walking to an object, crouching to floor height, grasp |
| Throw | the kinetic chain — hips, then trunk, then arm — and release velocity |
| Slow-mo | 0.3x, for watching any of the above |
| Skeleton | bones, joints, support polygon, centre of mass, velocity |

The centre-of-mass marker goes red when it leaves the support polygon, which is
the fastest way to see a balance bug.

## Physics

Everything is in stature H, converted assuming H = 1.75 m:

| quantity | value | real equivalent |
| --- | --- | --- |
| gravity | 5.6 H/s² | 9.81 m/s² |
| walk | 0.80 H/s | 1.4 m/s |
| run | 2.05 H/s | 3.5 m/s |
| jump take-off | 1.62 H/s | ≈ 0.4 m apex |
| cadence | 1.75–3.05 steps/s | walk to run |
| duty factor | 0.62 walking, 0.36 running | below 0.5 means a flight phase |

Foot placement while moving uses the standard capture-point rule: land the
swing foot under where the hips will be, plus half a stride in the direction of
travel.

## Structure

`../js/draw2d.js` (shared with the clock) is where the figure stopped being a
stick man. Limbs are filled
outlines with a width profile down their length rather than round-capped
strokes of one thickness — thigh thick at the hip and narrow at the knee, calf
bellied in the upper third, forearm tapering hard into the wrist — and the
outline runs through the joint so there is no seam. The torso is three masses
(pelvis, waist, ribcage) with a belt between, the deltoid is the top of the
sleeve rather than a pad stuck on the shoulder, and the head is a cranium plus
a jaw. Both ends of every limb are capped round; without that the shoulders
grow square epaulettes.

## Known gaps

- The run is a fast walk with a flight phase, not a sprint.
- Objects are a single ball with a bounce; nothing can push him over.

## Development

```
node ../tools/labshot.js "click:jump,grid:9:120"     # contact sheet of a jump
node ../tools/labshot.js "click:run,drag:0.9:0.55,wait:1200,grid:6:120"
```
