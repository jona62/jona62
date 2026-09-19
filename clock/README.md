# The Minute Painter

An analogue clock with no moving parts: a brass box with a round aperture and
a lit panel behind it, and standing on that panel, someone with a brush on a
long handle. They paint the hands — one minute stroke at a time, for as long as
the tab is open.

Open `index.html`. There is nothing to click.

Built after Maarten Baas's *Real Time* — the Schiphol clock, where a performer
wipes and redraws the hands from behind the glass. This is not a recording of
one; the figure is a rig being solved in real time against your own system
clock.

## The conceit

The face is a backlit diffuser panel, so the light is *behind* him. That is why
he reads the way he does: a colour-bled shape, overalls and cap legible, blown
out at every edge, with nothing of his face surviving the diffusion. Nothing of
him is drawn outside the aperture — the man is in the clock, and the clock is
all there is to see.

The markers are printed on the panel: crisp, black, identical every hour. Only
the hands are hand-made. That contrast is the whole object.

He comes up to about the six o'clock marker, which means most of the face is
out of arm's reach — so he works on the end of a long handle, holding it choked
right up for work near the hub and out at the very end of it to reach the
twelve. When even that runs out he walks, plants himself, and stays there until
staying there stops working.

**Every minute they wipe the minute hand off and repaint it**, and the stroke
is timed so that the last of the paint lands at the exact instant minute *n*
becomes minute *n+1*. The rag never lifts everything, so each wiped hand leaves
a ghost, and each pass of the cloth leaves a haze. Both build up, and both are
why the pane needs the bigger clean at the quarter.

**There is no second hand.** There is what they are doing instead: for most of
the minute the brush head hovers just off the panel, going round with the
seconds, trailing a damp mark that takes a few seconds to dry. Read the seconds
off the angle from the hub to the brush — the *distance* varies a little,
because the track pulls in towards the middle at the bottom, where the panel is
past his own feet.

## One minute

| seconds | what they're doing |
| --- | --- |
| 0 – 3 | peeling away from the stroke they just finished |
| 3 – ~40 | the brush tracks the seconds around the face |
| ~40 – ~48 | cloth in the other hand, wiping the minute hand away, tip first |
| ~48 – ~51 | down to the pot at his feet, load the brush, back up to the pivot |
| ~51 – 60.000 | the stroke, pivot to tip, finishing exactly on the turn |

The hour hand is repainted on the minute before each quarter — :14, :29, :44,
:59 — early in that minute, well clear of the minute stroke. Four repaints an
hour rather than one keeps the hour hand honest to within a couple of degrees
while still reading as an occasional, larger ceremony. Around the same moment
the accumulated cloth haze gets knocked back.

Every timing above is jittered per minute from a seed made of the date, the
hour and the minute, so no two minutes have quite the same rhythm — and any
given minute of any given day always plays back identically.

## How the movement is made

Nothing is keyframed and nothing loops. Each frame the schedule produces one
point on the panel — the head of the brush, or the corner of the cloth — and
the body is solved backwards from it:

```
brush head -> grip on the shaft -> where the shoulder would have to be
           -> how far to lean, how deep to sit, where to stand -> knees
```

It is a small biomechanical rig rather than a puppet, and three things do most
of the work.

**Real proportions.** Segment lengths are Winter's anthropometric table (after
Drillis & Contini), as fractions of stature: shoulder at 0.818 H, hip 0.530,
knee 0.285, ankle 0.039; upper arm 0.186, forearm 0.146, thigh 0.245, shank
0.246; biacromial width 0.259, bi-iliac 0.191. The joint heights and the
segment lengths agree with each other (0.530 − 0.285 = 0.245 = the thigh),
which is what keeps the silhouette honest in any pose.

**It is solved in 3D.** The panel is a plane in front of him, so reaching for
it is reaching towards the camera. Limbs are solved with a *pole vector* — the
joint is placed in the plane spanned by root-to-target and the pole, so knees
bend forward, out of the screen, and elbows fall back and down — and the result
is projected under a weak perspective. This is the single biggest change from
the flat two-bone solve that came before it, where the joint was simply put on
whichever side hung lower. A deep squat now reads as the thighs foreshortening
away rather than the knees splaying sideways like a frog.

**He has to stay up.** The horizontal centre of mass comes from Winter's
segment masses — HAT (head, arms, trunk) 0.678 sitting 63% up from the hip,
each leg 0.161 sitting 45% of the way down — which expands to a closed form:

```
com = 0.855 hip + 0.427 leanDX + 0.145 feetMid      (coefficients sum to 1)
```

Worth having in that form because it inverts: *where may the hips be, for the
centre of mass to stay over his feet?* The pelvis is clamped to that answer
every frame. He then keeps a second, unclamped position — where he would
*like* his hips to be — and the gap between wanting and being allowed is what
trips a step.

Steps are one foot at a time, never both, and have a preload before the swing:
~0.15 s of weight transfer onto the stance foot, then a ~0.34 s swing (stance
is the other 60% of the cycle), then ~0.12 s of double support before another
step may start. The swing is minimum-jerk horizontally, an arc vertically,
carries the foot forward and back in the sagittal plane, and rolls it from
toe-off through to a heel-first landing. It lands a natural stance width from
the planted foot and never crosses it. Afterwards the pelvis height is clamped so
that no planted leg can over-extend — which produces the hip dip over a wide
stance for free, the inverted-pendulum effect, without modelling it.

**He moves before he moves.** Bodies are not reactive. Postural muscles fire
50–100 ms ahead of the limb they serve, gaze leads the hand by 100–200 ms, and
weight transfers onto the stance foot *before* the other one leaves the ground
— an anticipatory postural adjustment, which everybody makes and nobody
notices making. Getting this wrong is the loudest tell there is: a rig whose
body follows its hand reads as a puppet however good the skeleton underneath.

This project gets it almost for free, because the schedule is a pure function
of time. The rig asks what the hand will be doing in 210 ms and postures for
*that* rather than for the present. The arm serves now; the trunk, the hips,
the gaze and the stepping decision serve the near future. Across a change of
hands there is nothing sensible to anticipate, so it falls back to the present.

Everything postural then runs on second-order springs rather than exponential
damping, slightly underdamped (ζ ≈ 0.72–0.8), so the body overshoots and
settles the way mass does instead of sliding to a halt. The pelvis is the
exception at ζ ≈ 0.92 — a bobbing pelvis reads as floating.

Two smaller things that are wrong in almost every procedural rig:

- **Hands re-grip in discrete moves.** The grip was sliding continuously along
  the shaft, which no hand does. It now holds, and only when the work has moved
  far enough does it let go and take a new hold, over about 200 ms, lifting off
  the shaft as it goes.
- **Gaze re-aims, it does not track.** The head commits to a target and holds
  it until the work has moved far enough to be worth a new look.

On top of that: trunk flexion is coupled to squat depth (a squat has to bring
the chest forward or he falls over backwards), the spine flexes in three
segments weighted towards the lumbar, the pelvis drops on the unloaded side
whether that is a swinging leg or just his weight on one foot, the shoulder
girdle rides up with a high reach, the head only partly follows the trunk
because people stabilise their heads, the free hand comes onto the shaft for
any stroke he commits to, and reaches travel on gently bowed paths — hands do
not move in straight lines — run with the minimum-jerk profile the motor system
actually produces (10t³ − 15t⁴ + 6t⁵, a symmetric bell-shaped speed curve). The
two-thirds power law relating speed to curvature falls out of the same model
rather than being bolted on. Breathing is phase-integrated so it can change
rate without a jump, and deepens and quickens with exertion, staying up for a
while afterwards. Clothing trails the limb it hangs off by a frame or so.

### Seeing the motion

Stills cannot show timing, and timing is the whole problem — the first rig
looked fine frozen and was obviously a puppet in motion, the body locked still
while the pole swung. `tools/strip.js` renders a contact sheet of consecutive
frames, which is what made that visible:

```
node tools/strip.js 10:37:39 150 4 3      # 12 frames, 150 ms apart
```

### What that is worth checking against

Balance and stepping systems fail by oscillating, and that is invisible in a
screenshot. `tools/simtest.js` runs the rig headlessly for two minutes of
simulated time and reports step count, direction reversals between consecutive
steps of the same foot, hip travel, and how often the centre of mass leaves the
support polygon. Healthy numbers are a handful of steps per minute, no
double-support violations, and zero frames out of support.

Three real failures were found that way and would not have been found by eye:
the step loop took the feet in a fixed order, so walking right made the left
foot step backwards forever; the pelvis clamp and the balance margin disagreed,
so he stepped every frame he could; and the stance half-width was wider than
the landing clamp allowed, so the feet could never satisfy both targets.

### What this still is not

A kinematic rig with dynamics painted on, not a simulation. There are no
forces: nothing carries momentum, no ground reaction is computed, and he cannot
be pushed over. Two levels remain above this one and both are out of proportion
to what the panel actually shows:

- **Torque-driven simulation** — PD controllers tracking a reference pose, with
  balance recovery. Weeks of work, an open research area, and mostly invisible
  through this much diffusion.
- **Motion capture**, which is the honest answer to "move like a real human".
  You do not generate convincing human motion procedurally; you record it and
  blend it. Worth remembering that the piece this is built after solves the
  problem exactly that way — Baas filmed twelve hours of a real performer.
  Everything here is an attempt to derive from first principles what he
  obtained with a camera.

Sources: Winter, *Biomechanics and Motor Control of Human Movement*, table of
segment lengths after Drillis & Contini (1966); Flash & Hogan's minimum-jerk
model; the anticipatory postural adjustment literature; the standard 60/40
stance–swing split.

Over the top of that sit two things. Layers of value noise (sway, breath,
tremor, the head drifting off its mark), and a per-beat **intent** — a fresh
roll of stance width, weight, crouch bias, head bias and where the idle hand
wants to hang, taken every time the minute or the phase changes. The body is
always arriving at a slightly different version of the same position, which is
the difference between a person and a mechanism.

The tool head is pinned to the exact scheduled point and the grip is placed
back along the shaft towards his chest, so the paint and the brush always agree
no matter how much the arm lags, and the handle can never swing to an
impossible angle.

## Time in, pixels out

The clock is a pure function of `new Date()`. Nothing accumulates in a buffer,
so loading the page at 09:41:12 shows nine minutes of ghosts and a half-wiped
hand, exactly as if it had been running all morning. Ghost and haze opacity are
computed from each mark's age, not painted into a texture.

## Files

| file | what's in it |
| --- | --- |
| `js/util.js` | maths, seeded RNG, value noise, two-bone IK |
| `js/schedule.js` | the choreography clock — phases, hand geometry, where the working hand is |
| `js/paint.js` | brush strokes, ghosts, cloth smears, the dial |
| `js/figure.js` | the skeleton, the reach solver, the drawing of the person |
| `js/glass.js` | wall, brass housing, lit panel, diffusion, grain, cover glass |
| `js/app.js` | layout, layer baking, the frame loop |

Plain scripts, no build step, no dependencies, no network calls. It runs from
`file://`, from any static host, and inside a `<iframe>`.

## Packaging

Nothing to compile — copy the folder onto any static host. For an embeddable
single page, `node tools/build-artifact.js` inlines the stylesheet and strips
the document wrapper into `dist/`.

## Performance

Everything that does not change between frames is baked into a layer once and
blitted: the wall and lit panel, the brass housing with its aperture punched
out, the diffusion, the grain, the printed markers, and the fan of old ghosts
(rebuilt once a second). Everything inside
the glass is drawn under a single circular clip. The figure is blurred at 55% of
display resolution, which is cheap as well as being the right amount of soft.
Live per frame: the person, the damp trail, and the three or four brush strokes
that are actually changing.

If the first hundred frames come in slower than ~26fps the canvas drops to one
device pixel per CSS pixel and stays there. `prefers-reduced-motion` trims the
idle sway and wandering attention; the painting itself still has to happen.

## Tuning

| where | knob |
| --- | --- |
| `schedule.js` `timings()` | when the wipe, the load and the stroke happen |
| `schedule.js` `GEO` | hand lengths, the second track, where the ink sits |
| `schedule.js` `HOUR_MINUTES` | how often the hour hand is repainted |
| `figure.js` `P` | body proportions |
| `figure.js` `PALETTES` | clothes, hair, skin — one is picked per day |
| `figure.js` `rollIntent()` | how much the stance varies between beats |
| `app.js` `GHOST_LIFE` / `SMEAR_LIFE` | how long the glass remembers |
| `figure.js` `POLE_BRUSH` / `POLE_CLOTH` | handle lengths, in dial radii |
| `figure.js` `P.crouchMax` | how far down a squat can go |
| `figure.js` walk block | the dead band and the strip he paces |
| `app.js` `measure()` | aperture size, box size, how tall he is inside it |
| `app.js` `drawHands()` | hand weights — these are marker strokes, not needles |
| `app.js` `compositeFigure` calls | how far behind the glass they read |

## Development

```
node tools/shot.js 10:37:45 14:59:20     # render stills at chosen instants
W=430 H=880 node tools/shot.js 10:37:50  # ...at a chosen viewport
```

Needs `playwright` available to node (`NODE_PATH` to a global install is fine).
