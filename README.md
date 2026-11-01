# Pocket Meadow Golf

A nine-hole, cel-shaded golf game for phone browsers. It's set at a tiny countryside club run by animals. You play a golfer in an oversized cap, with Pip, a round bird, as your caddie.

TypeScript + Three.js + Vite. No accounts, no API keys, no external services, no asset downloads: all geometry, textures and audio are generated at runtime.

## Setup

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
npm test           # physics, rules, penalties, cup capture, and every hole played by bots (~2 min)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

To play on a phone, run `npm run dev`, then open the printed **Network** URL on a phone on the same Wi‑Fi. `dist/` is fully static: host it anywhere (the base path is relative).

Initial download is about **171 KB gzipped**. A 1.5 KB entry script shows boot progress while the engine chunk loads and the first hole is built.

## Controls

Everything works with one thumb. There's no keyboard, hover, right-click or precise tapping needed.

| Action | How |
| --- | --- |
| **Aim** | Drag left/right on the aim bar (or anywhere on the course). Slow drags are fine, quick flicks turn further. The ◀ ▶ buttons nudge by ¼° and repeat when held. On the green, aiming is extra fine. |
| **Club** | Big buttons: Driver · Iron · Wedge · Putter. The game picks a sensible club after each shot. |
| **Swing (default: Hold)** | **Hold SWING** to build power, **release** to lock it, then **press SWING again on the green mark** to lock accuracy. The meter stays above your thumb. Every shot gets a full-length return with 2.17 seconds to the mark at a constant speed. The green zone is dead straight; lighter shots and putting have wider zones. Early pulls left, late pushes right, smoothly up to 12° (4.2° for putts). Full power pauses for 320 ms, then returns automatically; if still holding, lift before a fresh accuracy press. Missing the return resolves one capped mishit. ✕ cancels without a stroke. Aim and clubs lock during the swing. The golfer holds the backswing until accuracy is locked. Mouse and Space use the same hold–release–press sequence. |
| **Pull swing** (Settings → Swing → *Pull*) | Touch the green swing pad and **pull down**. Power and predicted carry show in a bubble above your finger, and the landing marker moves live. **Release to hit.** Slide back above where you touched (or let the gesture be interrupted) to **cancel**. Full power is about 95–150 px of thumb travel, depending on screen size. |
| **Button swing** (Settings → Swing → *Buttons*) | − / + set power in 5% steps (hold to repeat), then press **Swing**. |
| **Look** (free camera) | Opens on the whole hole. Then **drag** to pan, **pinch** or **+ / −** to zoom (mouse wheel on desktop), and **twist two fingers** to rotate. The aim bar still aims, and your view stays where you left it. **Back** returns to the shot camera. |
| **Spin** | The ● button (bottom-left of the course) cycles **No spin → Topspin ⤴ (runs out after landing) → Backspin ⤵ (bites, can check back)**. It resets after each shot. Putts have no spin. |
| **Basket item** | Your snack from the picnic basket sits above the spin button. Tap it to arm it for the next shot; it's used up when you hit, otherwise it carries over to later holes. |
| **Steer** (Bumblebee only) | While the ball flies, drag left/right on the course. |
| **Skip** | Tap the course during a shot to fast-forward, or during a celebration to skip it. |
| Desktop extras | Mouse works like a finger; ← → also aim. |

There are no hidden random accuracy errors. Where the ball goes depends on aim, power, meter timing, club, lie, spin, item, wind and terrain. The yellow dotted arc and ring show the **estimated first landing in calm air**, from the same simulation the real shot uses. Wind isn't included in the preview, so allowing for it is your call. The wind indicator and Pip's pre-shot read help. Roll after landing isn't shown, so judging it is part of the skill. Putts show a straight flat-green line, and the drifting arrows on the green show its slope.

## The fun layer

- **Feel**: a low side-on camera during flight so the arc reads, a beat of hit-stop and screen shake on big strikes, a flight whistle, and slow motion as a rolling ball reaches the cup. A **perfect** meter strike stamps PERFECT!, flies 6% further and leaves a gold trail. A hole-in-one sets off the whole meadow.
- **Picnic basket**: the basket comes out **twice a round**, once on holes 1–4 and once on holes 5–9 (which holes varies by round). Pick one of two snacks and carry it until you use it on a shot; the second basket lets you swap or keep. The basket you see before hole 7 always offers an acorn for the ducks' errand. In practice, the basket only appears on hole 7. The snacks:
  - 🥪 Jam sandwich sticks where it lands.
  - 🎈 Balloon floats far and drifts 3× with the wind.
  - 🌰 Acorn is bouncy and skips across water.
  - 🐝 Bumblebee lets you steer in the air.
  - 🐌 Snail ignores slopes while rolling.
- **Errands**: each hole has one animal request (tap the errand chip to read it). Examples: stop by the bunny, carry the pond onto the green, knock an apple loose, avoid every biscuit bunker, bonk the windmill, bounce off a sheep, skip across the duck pond, take the picnic shortcut, finish with one putt.
- **Stars**: up to three per hole (par, birdie, errand), 27 in all. Stars unlock cap colours for the golfer and scarves for Pip in **Club & Wardrobe** on the title screen. Practice rounds earn stars too.
- **Restoring the club**: errands complete projects that change the course.
  - Mend the bridge (the ducks' errand): the picnic shortcut on hole 8 becomes fairway.
  - Get the windmill turning (hole 5): its sails start swatting balls.
  - Plant flower beds (3 errands).
  - Light the clubhouse lanterns (6 errands).
  - Build Pip a nest (all 9): two rescues per round.
- **Critters**: sheep are woolly trampolines. Two mole hills per round sit in the rough beside the fairway and pop balls into the air; they move each round. Ducks paddle away from splashes. A ball that stops beside an animal gets a boop.
- **Pip's rescue**: once per round (twice with the nest), after a splash Pip offers to fetch the ball. You replay from your last spot and the splashed stroke doesn't count. You can take the normal drop instead.

## Rules (arcade, consistent)

- **Lie**: rough −15% power (wedge −8%), sand −50% driver / −35% iron / −15% wedge. The current penalty is shown in the lie chip.
- **Water**: +1 stroke. You drop back on the line from the hole through where the ball entered the hazard, on the first dry, playable spot. Duck Crossing's island green has a designated drop zone instead.
- **Out of bounds** (past the white stakes): +1 stroke, replay from the previous spot.
- **Cup**: slow, centred balls drop; fast balls lip out or roll across. A gentle chip landing on the cup is holed.
- **Pick-up** at 10 strokes on a hole.

## The course (par 35)

1. **First Flight**, par 4: wide and friendly.
2. **Puddle Jumper**, par 3: carry the pond, or go around it on the right.
3. **Apple Bend**, par 4: doglegs left around an orchard. The trees really are in play.
4. **Biscuit Bunker**, par 3: a round green ringed by biscuit bunkers.
5. **Windmill Walk**, par 5: tight left route or roomy right route past the windmill.
6. **Clover Hill**, par 4: uphill to a back-to-front green.
7. **Duck Crossing**, par 3: island green with a left-shore bailout and drop zone.
8. **The Long Picnic**, par 5: curl right, or take the narrow shortcut over the brook.
9. **Clubhouse Sunset**, par 4: pond short-left, clubhouse (out of bounds) long-right.

## Saving

The game saves to `localStorage` automatically after every resolved shot, at hole completion, when the tab is hidden, and on `pagehide`. Close the browser any time and use **Continue Round**. A shot still in flight when the page dies is not counted: you resume from the spot before it. Settings and best scores (per hole and per round) persist too. If storage is unavailable (for example in private mode), the game keeps working in memory and Settings says so.

## Where to tune things

| What | Where |
| --- | --- |
| Gravity, drag, wind strength, cup size/capture, stroke limit | `src/sim/constants.ts` |
| Surface bounce/roll/friction (fairway, rough, green, sand) | `SURFACES` in `src/sim/constants.ts` |
| Club carries, launch angles, spin; lie penalties | `CLUBS`, `lieMultiplier` in `src/sim/shot.ts` |
| Hole layouts, pars, hazards, slopes, scenery, animals, wind ranges, errands | `src/course/holes.ts` (pure data, design coordinates in yards) |
| Basket items, their physics and the twice-a-round schedule | `src/sim/items.ts`; spin in `launch()` in `src/sim/shot.ts` |
| Stars, errand rules, club projects, cap/scarf unlock thresholds | `src/game/club.ts` |
| Camera pitch, smoothing, framing paddings | `src/render/cameraRig.ts`, `frame*` methods in `src/game/game.ts` |
| Hold charge speed, full-power pause, return speed, power-scaled accuracy zones, pull/push angles, mishit penalty | `METER` in `src/sim/meter.ts` |
| Thumb travel for full power, aim sensitivity, look gestures | `travel()`, `bindAim`, `bindLook` in `src/input/controls.ts` |
| Render quality tiers (DPR cap, pixel budget, terrain detail) | `QUALITY` in `src/render/scene.ts` |
| Colours, cel ramp, outlines | `src/render/materials.ts` |
| Sound effects and music | `src/audio/audio.ts` |

## Architecture

- `src/sim/` is pure TypeScript with no Three.js: fixed-step (120 Hz) ball simulation, terrain/surfaces, shot model, rules. Aim predictions run the same `BallSim` as real shots. Fast balls are protected by sub-stepped terrain tests and segment-based cup tests.
- `src/course/` holds the data-driven hole definitions.
- `src/render/` is Three.js: a toon-shaded heightfield with a canvas-painted course texture, instanced trees and flowers, vertex-coloured merged characters, screen-space outlines, blob shadows. There's no real-time shadow mapping and no post-processing.
- `src/input/` handles Pointer Events with pointer capture. The aim region and the swing pad are separate elements, so an aiming drag can't fire a shot.
- `src/game/` holds the state machine, camera composition and saving. `src/ui/` is a thin DOM HUD and menus.

Performance measures: the backing resolution is capped by both a DPR ceiling and a pixel budget, and Auto quality steps down if the median frame time drops below ~40 fps. Physics and controls never change with quality. Rendering throttles to ~20 fps when idle and stops entirely while the tab is hidden. WebGL context loss shows a notice and rebuilds on restore. Each hole uses about 50–75 draw calls.

## Testing done (and how)

- **Automated** (`npm test`, 85 tests): spin roll-out, every basket item, sheep and mole bounces, per-round moles, errand completion and failure, star scoring, and projects changing the course; the swing meter’s hold/release power locking, constant return timing, power-scaled straight zones, maximum-power release gate, deterministic early/late grading, timeout and cancellation; pointer capture, multiple touches, synthetic clicks, lost capture, right-click filtering and the Space-key sequence; carry calibration, linear power, prediction matching the real first landing exactly, wind, anti-tunnelling, tree deflection, rolling and surfaces, green break, ball holding on slopes, cup capture, lip-outs, skip-proof cup tests, dunks, water and OOB detection, relief drops (dry, playable, not nearer the hole), scoring, and course data sanity. Two bots play every hole through the real simulation:
  - a search bot proves each hole is completable within par+1 at maximum head- and crosswind;
  - a straightforward bot (default aim, power = distance ÷ club range, no wind compensation) must finish within par+3.
- **Desktop browser with mobile emulation** (375×812 portrait and 812×375 landscape, via the built-in browser): played hole 1 end to end with real drags on the swing pad (drive → wedge → putt → birdie), checked every hole's overview, a water penalty with the island drop zone, tap-swing mode, the round-complete screen and best score, resume after reload, simulated tab hide/show mid-flight (the simulation pauses and resumes without jumping), forced WebGL context loss and restore, and that audio starts only after a real tap.
- **iOS Simulator (iPhone 16e, Mobile Safari, iOS 18.6)**: the title and in-hole HUD render correctly with WebGL, safe areas and Safari's bottom toolbar. I could only take screenshots there: touch input in the simulator wasn't exercised.

## Honest limitations

- **Not tested on a physical phone.** Touch feel, haptics, real GPU performance on older Android devices, and iOS toolbar collapse during play were checked only in emulation or the simulator. Please try it on a real device.
- Audio is synthesized (WebAudio oscillators and noise). It's charming but simple, and I could only check that it runs without errors, not how it sounds on phone speakers.
- No shot shaping (draw/fade), no elevation number in the HUD. Elevation shows through toon shading and in the landing preview.
- Animals are decorative and don't move around the course. Trees, the windmill and OOB stakes are the only physical obstacles; bridges and props are visual only.
- The bots show scoring is generous for precise players (a precise simulated human averages around 32 on the par 35), by design for arcade play.
- Two tabs open at once share one save, and whichever writes last wins.
- Spin, items, errands, restoration and the rescue were tested in desktop emulation only: scripted shots plus screenshots.
- Practice rounds aren't saved for resuming (your main round's save is never overwritten by practice).
- Dev-only URL hooks (`?hole=3`, `&swing=0.8`) exist for automated checks and are disabled in production builds.

## GitHub Pages

Live game: https://szabadkai.github.io/pocket-meadow-golf/

Pushing `main` runs `.github/workflows/deploy.yml`: clean install, the full test suite, a TypeScript/Vite build, then deployment of `dist/` to GitHub Pages. The relative Vite base keeps assets working at the repository URL. Failed tests prevent deployment.

The hold-swing update has automated state-machine and actual input-handler regression tests in `tests/meter.test.ts` and `tests/controls.test.ts`. `tests/viewports.html` is a development-only portrait/landscape fixture. Physical phone touch and haptics still need real-device testing.
