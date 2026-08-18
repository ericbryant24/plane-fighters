# Plane Fighters

A 2D side-view biplane dogfighting game that runs in the browser. Built for
portrait-orientation phones, playable with a keyboard on desktop. No build
step, no dependencies — plain HTML, CSS and ES modules on a `<canvas>`.

**Play:** https://ericbryant24.github.io/plane-fighters/

## The game

You fly a scout biplane over a wrapping strip of front line. Every level hands
you a different objective; clear it for a bonus, a bomb reload and some hull
repair, then take the next one. Enemy flying skill climbs with the level number
independently of what the objective happens to be.

| Level | Objective | What it asks |
| --- | --- | --- |
| Air superiority | shoot down N fighters | the classic sweep |
| Balloon bust | pop N observation balloons | against a clock |
| Bombing raid | flatten N depots and hangars | bombs only, so you have to go low |
| Flak suppression | silence N AA guns | the guns shoot back |
| Intercept | down N bombers before they cross the sector | let too many through and you fail |
| Ace duel | defeat the red aces | tougher, sharper, three rounds each |
| Hold the sector | stay airborne for N seconds | continuous opposition |

The rotation repeats and escalates, so a run lasts as long as you do.

- **Guns** — twin fixed forward guns, so you have to point the whole aeroplane.
  Two rounds down a fighter, three an ace, five a bomber.
- **Bombs** — 8 per level, dropped from the belly. They fall with your momentum,
  so a shallow dive throws them forward. Blast radius will also clip a plane —
  including yours, if you release too low.
- **Ground targets** — AA emplacements shoot flak at you, plus depots, hangars
  and observation balloons. The sector is rebuilt between levels, so an
  objective always has something to aim at.
- **Failure** — running a clock out, or letting the bombers through, ends the
  run as a failed mission rather than a shoot-down.
- **Checkpoints** — progress is saved on arrival at every level, so being shot
  down costs you that level rather than the whole run. The game-over screen
  offers *Retry level N* with a fresh aeroplane and the score you had on
  arrival; *New flight* starts over from level 1 and clears the checkpoint. The
  save lives in `localStorage`, so it survives closing the tab.

### Flying it

The flight model is the point of the game, not a detail. It integrates speed and
flight-path angle directly rather than summing xy forces, because lift does no
work: the wings bend your flight path toward the nose instead of destroying
momentum, and turning is charged as induced drag.

- **Climbing costs speed, diving buys it.** At cruise the wings carry the weight
  and you hold altitude; slower than that and the aircraft mushes downward.
- **Speed sets your turn radius, not your turn rate.** Fast means wide arcs;
  easing off tightens them — right up to the point the wings stop biting.
- Below ~70 units of airspeed you **stall**: the wings quit, the nose falls
  through, and the flight path stops following where you point. Dive to recover.
- **Pulling back is always the same rotation, upright or inverted.** Holding it
  flies a continuous loop; reversing the stick reverses the arc immediately.
- The aircraft is drawn at a fixed roll, so it genuinely flies inverted when it
  is inverted. Half a loop reverses your direction of travel and leaves you
  upside down — which is fine, keep flying, or keep pulling to come round. The
  earlier version mirrored the sprite upright as it crossed vertical, which
  inverted the apparent control sense at the same moment and was thoroughly
  disorienting.
- Hard turns bleed speed, so a long turning fight leaves you slow and low —
  which is exactly when the AA guns get interesting.
- Air thins near the ceiling and the engine starves. The ground is fatal.

### Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Pull up / push down | **drag anywhere** — up pulls back, down pushes | `↑` `↓` or `W` `S` |
| Fire guns | FIRE | `Space` |
| Drop bomb | BOMB | `B` |
| Pause | II (top right) | `P` / `Esc` |
| Start / retry | on-screen buttons | `Enter` (resumes the checkpoint when there is one) |

Pitch is an analog drag rather than buttons: press anywhere on the playfield
and a stick appears under your finger. Deflection is proportional — about 84px
of travel is full stick — so you can hold a gentle turn instead of only
hard-over. Drag past full deflection and the anchor follows your finger, so
easing back off responds immediately rather than needing the whole travel back.
The two weapon buttons keep their own touches, so you can drag and fire at the
same time.

## Running locally

ES modules need a real HTTP origin, so opening `index.html` from the filesystem
won't work. Serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

To try the touch controls, use your browser's device emulation in portrait
(e.g. iPhone 12/Pixel 5) or open the address on a phone on the same network.

## Deploying to GitHub Pages

Pages serves the repository root directly from `main`, configured under
**Settings → Pages → Source: Deploy from a branch** (`main`, `/ (root)`).
Because there is no build step, the checked-in files *are* the site — every
push to `main` republishes. `.nojekyll` is present so the `src/` directory is
served as-is rather than being run through Jekyll.

There is deliberately no Actions workflow. The `actions/deploy-pages` route
was tried first and its job was rejected before a runner was ever assigned
(no steps, no logs), so it was dropped in favour of branch deployment, which
needs no runner, no artifact upload and no `github-pages` environment.

## Layout

```
index.html          markup, HUD, touch controls, overlays
style.css           portrait-first chrome, safe-area aware
src/config.js       tuning table
src/missions.js     objective rotation + per-level difficulty curve
src/util.js         math helpers (angles, horizontal world wrap)
src/plane.js        flight model, guns, bombs, damage — shared by all aircraft
src/ai.js           CPU pilot: pursuit with lead, breaks, ground avoidance,
                    plus a transit mode for bombers that ignore you
src/world.js        wrapping terrain, ground targets, AA fire, clouds
src/projectiles.js  bullets, bombs, flak shells
src/effects.js      particle pool, screen shake
src/render.js       canvas painting: sky, parallax, biplanes, HUD overlays
src/audio.js        synthesised sound (no audio assets)
src/main.js         game state machine, collisions, mission runtime, HUD sync
```

Player and CPU planes run the exact same physics in `plane.js` — the only
difference is where the stick inputs come from, so any manoeuvre the AI pulls
off is available to you too.
