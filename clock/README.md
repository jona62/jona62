# The Minute Painter

An analogue clock with no moving parts. Inside the case, behind the glass,
stands someone with a brush and a rag, and they paint the hands — one minute
stroke at a time, for as long as the tab is open.

Open `index.html`. There is nothing to click.

## The conceit

A glass disc on a white wall. The paint is on the back of the glass, which is
the painter's side, so the marks are sharp and the painter is not: you can
follow the colour of their shirt and the outline of their hair, and you will
never see their face. Nothing of them is ever visible outside the rim — the man
is in the clock, and the clock is all there is to see.

The face is wider than he is tall, so most of it is out of arm's reach from
where he happens to be standing. He walks to the work, plants himself, and
stays there until staying there stops working. The bottom of the dial is around
his own feet, so the six o'clock end of a stroke is painted from a deep squat.

**Every minute they wipe the minute hand off and repaint it**, and the stroke
is timed so that the last of the paint lands at the exact instant minute *n*
becomes minute *n+1*. The rag never lifts everything, so each wiped hand leaves
a ghost, and each pass of the cloth leaves a haze. Both build up, and both are
why the pane needs the bigger clean at the quarter.

**There is no second hand.** There is what they are doing instead: for most of
the minute the brush hovers just off the glass, going round with the seconds,
trailing a damp mark in the frost that takes a few seconds to dry. Read the
seconds off the angle from the hub to the brush — the *distance* varies,
because the hovering brush rides near the rim at the top and pulls in towards
the middle at the bottom, which is the shape of what a person standing in there
can actually reach.

## One minute

| seconds | what they're doing |
| --- | --- |
| 0 – 3 | peeling away from the stroke they just finished |
| 3 – ~40 | the brush tracks the seconds around the face |
| ~40 – ~48 | cloth in the other hand, wiping the minute hand away, tip first |
| ~48 – ~51 | down to the ink, load the brush, back up to the pivot |
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
point on the glass — the tip of the brush, or the corner of the cloth — and the
body is solved backwards from it:

```
brush tip -> wrist -> where the shoulder would have to be
          -> how far to lean and how deep to sit -> knees -> feet
```

Two-bone IK does the arms and the legs; a small solver decides how much of the
reach is lean, how much is a bend in the knees, and — when neither is enough —
where he has to stand instead. Low targets are answered with a squat, far ones
with a twist across the body, and anything past that with a walk. The feet lag
the walk, which is what makes it read as steps rather than sliding.

Over the top of that sit two things. Layers of value noise (sway, breath,
tremor, the head drifting off its mark), and a per-beat **intent** — a fresh
roll of stance width, weight, crouch bias, head bias and where the idle hand
wants to hang, taken every time the minute or the phase changes. The body is
always arriving at a slightly different version of the same position, which is
the difference between a person and a mechanism.

The tool tip is pinned to the exact scheduled point and the hand is placed
behind it, so the paint and the brush always agree no matter how much the arm
lags.

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
| `js/glass.js` | wall, case, frost, grain, reflections, rim, travelling gloss |
| `js/app.js` | layout, layer baking, the frame loop |

Plain scripts, no build step, no dependencies, no network calls. It runs from
`file://`, from any static host, and inside a `<iframe>`.

## Packaging

Nothing to compile — copy the folder onto any static host. For an embeddable
single page, `node tools/build-artifact.js` inlines the stylesheet and strips
the document wrapper into `dist/`.

## Performance

Everything that does not change between frames is baked into a layer once and
blitted: the wall and the case, the milky pane, the grain, reflections and rim,
the dial, and the fan of old ghosts (rebuilt once a second). Everything inside
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
| `figure.js` `P.crouchMax` | how far down a squat can go |
| `figure.js` walk block | the dead band and the strip he paces |
| `app.js` `measure()` | dial size, how tall he is inside it |
| `app.js` `compositeFigure` calls | how far behind the glass they read |

## Development

```
node tools/shot.js 10:37:45 14:59:20     # render stills at chosen instants
W=430 H=880 node tools/shot.js 10:37:50  # ...at a chosen viewport
```

Needs `playwright` available to node (`NODE_PATH` to a global install is fine).
