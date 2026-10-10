# Collaboration handoff — updated 2026-10-10

## Whole-world free roam (Claude, 2026-10-10) — "build the whole map to freeroam"

The default map is now `gielinor`: map regions 33–60 × 39–64 (tiles 2112–3903 × 2496–4159, 1,792 × 1,664 tiles). That is the connected mainland from Castle Wars and the Gnome Stronghold to Port Phasmatys, and from Karamja and the desert to the top of the Wilderness. The scattered areas the cache keeps further north (regions 65+, such as Zanaris and Puro-Puro) are left out. Regions whose objects need XTEA keys we don't have (about 80, for example Ape Atoll) export terrain only. `misthalin` and `lumbridge` are still available through `?area=` and use the same format.

**One exporter, block by block** (`tools/export-area.ts`, `npm run export:world -- <area>`; it replaces export-world, export-render, export-collision and export-minimap)
- Each block of 4 × 4 regions loads with a one-region border, so terrain blending, corner heights and shadows are seamless across blocks. `LocBuilder.build(grid, density, inside)` emits geometry only for spawns inside the block; nearby outside spawns still shade its ground. `buildTerrain(..., rect)` builds only the block's tiles.
- Each block is packed straight from memory into:
  - render chunks (as before);
  - per 16-tile cell: solid objects `<cx>_<cy>.bin`, terrain `.t.bin` and grind lines `.rails.json`;
  - traversal, ground heights and a minimap tile.
- Triangles go to the cell of their centre, clamped to the block, so blocks never share a file.
- The collision and grind-line rules moved unchanged into `tools/world/collision-rules.ts` (`classifyLocs`). Rail ids now use absolute world tiles, so they are unique across the world.
- Finished blocks are recorded in `work/world/<area>/blocks/`, and a rerun resumes from there (`--fresh` starts over). The last step joins:
  - `render/manifest.json` and `collision/index.json`;
  - `traversal.bin`;
  - `minimap.json` and `minimap/overview.png`;
  - `runes.json` (town runes are placed here, from all grind lines and the ground heights);
  - `work/.../textures.json`, which `export-surfaces` now reads.
- It also warns about teleports that land on water or void.
- Lumbridge re-exported identically: 2,837,025 object triangles, 1,301,970 solid, 4,193 grind lines, 3,163 water tiles, in 11 s.

**Streamed world format** (manifest `format: 2`, collision index `version: 2`)
- Soups are 16-bit, which spans 512 tiles. Collision cell soups are therefore stored relative to their own corner minus 64 tiles (`cellOrigin`); `soupPositions` / `decodeSoup({ origin })` add the origin back.
- `WorldCollision` holds static trees (training grounds, props) plus cells of `{ locs, terrain, rails }`. `terrainOnly` queries use only the cells' terrain. The `rails` property is the static list (park and props); cell grind lines are indexed into the rail grid as cells load and unload.
- `CollisionStream` looks up only the cells near the point (the index has about 10k entries), fetches up to three files per cell, and evicts above 2.5 M triangles.
- There is no `terrain.bin` or `rails.json` any more, so startup cost doesn't grow with the world.
- The minimap draws the overview (1 px per tile) underneath and then the 1,024 px tiles in view, lazily loaded with an LRU of 16. The world map draws the overview.

**Content**
- 37 teleport spots in 8 regions (`Place.region`): 26 new, from Falador, Camelot, Ardougne, Yanille, Rellekka and Brimhaven to Canifis, Port Phasmatys and the Wilderness. Each has five challenges, and the teleport menu groups them by region and shows challenge progress.
- `play.mjs` now checks and builds `gielinor`.
- `tests/collision.test.ts` covers cell terrain, streamed grind lines and cell origins (98 tests).

## Second footage pass (Claude, 2026-10-10) — 14.5 min recording plus an interview

The user answered an interview after the footage:
- Bonks felt too frequent: soften them.
- Sketchy landings should bank the combo at reduced value.
- Water should bank the combo, then put you on shore.
- Cruising is fun, but it stalls when you get stuck (small plants and rocks, pinned on walls and fences, roofs and high spots out of reach), when you can't link combos, and when you can't tell what's going on or what the special does.
- They want huge jumps and roofs like THPS and skate, a level system that unlocks skills, live key hints, and a game that is more forgiving by default.

The footage also showed three clear bugs:
- The camera clipped through the GE arches and pillar, the Varrock bank chandeliers, roofs, trees and walls.
- You could ride off the edge of the map into the void (north of the GE and at Draynor).
- Roofs and the Barbarian Village ground rendered white.

Best moment: a 50k GE-steps combo that completed the GE Grandmaster challenge.

**Fixes**
- **White textures.** `export-surfaces` looked for `*.materials.bin` in `public/world`, but `export:world` writes them to `work/world/<area>`. So every texture first used after the Misthalin expansion (texture 309 alone covers 343k vertices) was missing from the strip. Those faces showed their white-lifted HD face colour untextured. It now scans `work/world` too: 349 textures are packed (was 251) and none are missing.
- **Camera.** The RS shader has a see-through cutout (`cutCamera`/`cutTarget`/`cutRadius` in `rsUniforms`, per-material `cutout` option). It is a capsule from the camera to the rider's chest, 1.1 m radius widening to 1.65 m at the camera and tapering to nothing near the rider so the ground under the board stays. Inside it, world, park and prop surfaces dissolve with a 4×4 Bayer screen-door edge at most 0.22 m wide, and everything within 0.8 m of the lens is cut. The avatar and board never cut. With that in place, `ChaseCamera` no longer lifts or pulls in for walls; it only stays 0.6 m above the terrain. `placeCamera` is kept (tested) but unused.
- **Map edge.** `WorldCollision.inBounds` is true inside the traversal map, or where a static non-terrain tree (the training grounds) has geometry. The skater's `edgeAt` treats out-of-bounds like water or holes on the ground (glance along it). In the air it is an invisible wall you slide along ("Edge of the map").

**Unsticking**
- **Clutter.** Rocks, stones, stumps, logs, pots and similar debris up to 0.9 m tall and 2.6 m across are ridden through, plus anything else under 0.5 m and 2 m across. Skateable names (block, ledge, step, bench, crate, stall...) and any flat-topped `blockTop` object stay solid. Plants of any size are passable (`shrub|plant|weed|vine|ivy|cactus|sapling...` added). Collision `STEP` is 0.12 → 0.18 m. Misthalin skips 2,927 clutter objects and has 16,498 grind segments.
- **Walls.** Riding or pushing straight at a wall (slide under 45% of your speed) turns you along it toward the side you steer or drift. Bonk is now above 6.5 m/s into the wall (×0.8 speed); a bail needs over 11.
- **Water and edges.** A head-on stop at water or an edge swings the board toward the nearest open cardinal direction, so pushing gets you moving.
- **Perching.** Airborne, falling and not moving down for 0.6 s means you're perched on something too steep to stand on; you are rescued ("Stuck up there") instead of hovering for 6 s until "Out of bounds".

**Combos and landings**
- `LANDING_WINDOW` is 0.3 → 0.6 s, and an ollie inside it links the next air (`jump()` no longer banks). `REPEAT` scores a trick 25% less per repeat in one combo, down to a quarter (`repeats`, cleared with the combo), so ollie chains can't farm.
- `landingFault` finishes a flip that is at least half done. Sketchy landings, lost manual balance and falling off a grind call `sketchy()`: a wobble that banks the combo at `LANDING.sketchy` (half), with a `land` event flagged `sketchy` (trick challenges ignore those; combo challenges count them) and a `sketchy` event.
- Messages say why: "Landed mid-kickflip", "Landed sideways", "Fell off the grind · leaned too far right"...
- `bail(reason, relocate, keep)`: water, holes, perching and out of bounds bank the open combo first ("Splash! · back to dry ground · combo banked +800"). Relocating bails last 1.1 s.
- Easier balance: grind wobble grows over 5 s instead of 3, the manual drift is gentler, and both scale with `abilities.steady`. `GRIND_CATCH` is wider (reach 0.6, below 0.35, above 0.6).
- A heavy landing needs more than 17 m/s (about 10 m).

**Big air and unlocks**
- `OLLIE` is 4.3 + 3.1 × charge (was +2), times `abilities.pop`.
- Wallplant (`tryWallplant`): pop in the air with a wall within 0.4 m ahead, or touched within 0.5 s. Your line reflects off the wall, you rise at 6.4 × pop, and there is a 0.35 s cooldown, so you can chain up between walls.
- Agility leap (`tryLeap`): pop in the air at 6.2 × pop, `abilities.leaps` per air. Leaps reset on the ground, on grinds and on wallrides. When falling within 0.6 m of the ground, a pop is a buffered landing ollie instead. A wallie is now 5 × pop.
- `SkateAbilities` / `BASE_ABILITIES` live in skater.ts; `UNLOCKS` and `abilitiesFor(level)` in skill.ts (levels 5–99, table in the README). main.ts reapplies them when the level changes.
- `Career.unlocked` queues unlocks from level-ups for the UI's "NEW SKILL" card. The pause menu shows the skill guide.
- A `special` event chimes when the bar fills; the special's help and README text explain its value.

**Clarity**
- `HintCoach` (hints.ts) picks one hint at 10 Hz by priority: link window, grind, manual, wallride, then in the air wallplant / leap / special / tricks, then on the ground the ledge ahead (reachable by ollie, or by ollie and leap), special, wall beside you, push, Surge.
- Basic hints have per-session budgets; urgent ones cut in. A hint sticks for 1.2 s. The profile's `hints` flag (default on) is toggled in the pause footer.
- The HUD shows the hint as key caps (`#hint-line`) and the link window as a gold bar under the combo.

**Tooling**
- `__scape.frames(n)` steps the game loop by hand (`?test=1`), because the hidden preview pane throttles requestAnimationFrame.
- `fuzz-skater.ts` takes `LEVEL=` (abilities) and `WHERE=1` (bail locations).

**Validation**
- 96 tests (new `tests/fun.test.ts`), typecheck and production build pass.
- Fuzz at levels 1, 30, 60 and 99 on both maps found no physics issues. Bails fell from about 310 to 26–53 per 27 simulated minutes, mostly water splashes that bank the combo. Grinds roughly doubled and banked combos went from about 400 to 550–760.
- Browser: Varrock roofs show slate textures; with the camera inside a building the rider stays visible through it; the skill guide, level-30 unlock card, leap hint and link bar all appeared.

## Footage fun pass (Claude, 2026-10-10) — the user's 278 s gameplay recording, "fix what's not good, enhance what is good, fun first"

What the footage showed: a fall loop in the Grand Exchange's underwall tunnel, frequent Bumped/Hard impact stops, unwanted "Launch" mini-airs off terrain followed by sketchy landings, "Rolling back fakie" spam on dunes, messages that lingered, the camera inside the rider or pressed against walls, and the Duel Arena's blocks bumping the rider instead of being grindable. What worked: teleport hopping, wallride-into-grind combos and challenge completions.

- **Holes.** `export:world` marks tiles with no terrain as voids (traversal 2; minimap dark): 116 in Misthalin, 37 in Lumbridge. `groundAt(..., terrainOnly)` returns null over them. The edge says "Hole ahead"; falling 4 m with nothing below bails at once ("Fell into a hole"), and rescues return to `safeTrail[0]`, a spot from up to 3 s back (one every 0.5 s, 6 kept, never on water). A sweep of all 116 voids from four directions, rolling and ollieing, never left the rider falling.
- **Water.** Shorelines glance like walls: a grounded step into water slides along the free axis (tile edges are axis-aligned), turns the board along the shore and keeps most of the speed. Only a head-on approach stops you. A rider who still ends up grounded on water (off a rail end, a wall slide) can roll out, and is rescued after 0.6 s (`wetClock`). Before this, such riders were boxed in by "Water ahead" in every direction.
- **Slopes.** `ROLL.slopeGravity` 9.8 → 7 and coasting friction 0.55 → 0.42. Push grip fades from 0.3 to 0.5 rad of uphill pitch, so you roll back off a steep bank instead of sticking to its face. Ramps launch only if they throw you at ≥ 2 m/s (`ROLL.minLaunch`), so hill crests don't. There is no roll-back message.
- **Air control.** `popped` marks an air that began with an ollie or a launch. Rolling off a ledge, A/D carves the line (heading and airHeading together) instead of spinning, so the landing stays clean. `land()` snaps `heading` onto `airHeading`, so a slightly crooked clean landing keeps your line. Sketchy needs alignment > 0.97.
- **Wall hits** (`IMPACT`). Bail above 10 m/s into the wall (was 7.8), Bonk above 4.5 (×0.6 speed, the combo survives, a `bonk` event with a thud and camera shake, message rate-limited to 2 s); scrapes are free. Misthalin fuzz hard-impact bails went from about 24–30 per 40 episodes to 0–2.
- **Block-top ledges.** `export-collision` adds the top edges of type 10/11 objects 0.35–1.6 m tall (footprint diagonal ≤ 3.5 m, flat top ≥ 45% of it; not doors, trees, statues, signs and so on) as grind lines with ids `...-e<k>`. Misthalin: 16,462 segments; Lumbridge: 4,193. The clutter rule no longer drops type-10 floor pieces (6,266 → 2,627 skipped).
- **Camera.** Automatic mode probes lifts of 0/1.5/3/4.5 m with `placeCamera` and eases up over walls. If placement ends within 1.3 m of the rider, it moves above and behind. Bonks and bails shake it.
- **Messages** show for 3 s, then fade out (`strong.idle`).
- **Town runes** (`runes.ts`). Five per spot (Air, Water, Earth, Fire, Cosmic), placed deterministically above rails ≥ 2.5 m long within 45 m: one 1.4–3 m up, the rest 0.4–1.4 m, ≥ 9 m apart, 0.85 m above the line. Touching one gives `RUNE_XP.each` (1,500), and all five give `RUNE_XP.set` (15,000). Saved in `profile.townRunes`, white on the minimap, and counted on the quest card.
- **Combo ratings** (`comboRating` in ui.ts): Bronze 1k … Third-age 150k, shown with each banked combo. **Fireworks** (`fireworks.ts`) burst on challenges and level-ups.
- Validation: 83 tests; typecheck; production build; Misthalin and Lumbridge fuzz with several seeds shows no physics issues. The only remaining "stuck" samples are random-steer riders pushing head-on into walls. Browser checks: a Lumbridge rune collected by grinding, Lumbridge Medium completed with fireworks, a shoreline glance on the River Lum, and 24 runs at 9 m/s around Lumbridge castle with bonks and no wall bails.

## Polish pass (Claude, 2026-10-09) — "small stones on the ground cause falls… make it the best"

- **Small stones.** Collision kept about 6,300 small objects (pebbles, rubble, rockslides, stumps, fungus, sacks, unnamed clutter) as solid, so at speed they caused hard-impact bails. `export:collision` now skips any non-wall, non-floor object under 0.45 m tall and 1.6 m across (`isClutter`). `WorldCollision.move` also ignores triangles within 12 cm of the feet (`STEP`); the ground follower rides over those lips. The fuzzer now reports bails by cause.
- **Bails.** These are 1.6 s (`BAIL`). The body slides on along the line with friction (walls stop it) and gets up where it stopped. The rider plays RS death animation 836 at 2.1× speed (exported with five extra emotes). The board flies off with its own gravity, bounce and spin, then drifts back under the feet. `Avatar.play` gained a `speed` option.
- **Combo HUD.** THPS-style: the trick chain, the running score in gold, and a "+score" pop on bank or "Combo lost" in red.
- **Special attack bar** (`SPECIAL` in tricks.ts). Combo points fill it (2,500 per bar); it drains at 1.5%/s with no combo, halves on a stumble and empties on a bail. When it's full, Shift turns the trick keys into Rune flip, Teleport shove (the board blinks out mid-spin), Dragonfire grab and Godsword grind, each with its own particle colour.
- **Replay** (`replay.ts`). The last 20 s are sampled at 30 Hz: player and board transforms, deck rotation, skate pose or RS sequence time (`Avatar.showSequence`), and the combo text. Backspace or the pause menu opens it; playback interpolates and uses the chase camera's free-orbit mode.
- **Decks** (`decks.ts`). The deck is a strip mesh with rounded kicked ends, concave, grip, plies and an unlit canvas graphic underneath. There are 15 designs; town decks unlock from each town's Master challenge (`Career.boardUnlocked`). `lab.html?decks` shows them all.
- **Automatic gaps** (`GAPS`): Water gap, Big drop (over 2.5 m) and Hang time (over 1.3 s), awarded on clean landings, including on ramps.
- **Bug fix:** spot challenges only count on the map (the training grounds sit near Draynor's coordinates).
- Validation: 77 tests.

## Skate-style expansion (Claude, 2026-10-09) — the user asked for "more skate 4 freedom… expand the map"

- **Map: greater Misthalin** (`misthalin`, regions 48–52 × 49–54, 320 × 384 tiles, now the default; `?area=lumbridge` still works). Expanding past 256 tiles exposed a format limit: soup positions were signed 16-bit at 128 per tile, so everything beyond tile 256 wrapped (Varrock had no ground). Soups now store x and −z unsigned (`src/shared/soup.ts`, 512 tiles), and render chunks store positions relative to a per-chunk `origin` (manifest version 3). Both maps were re-exported; Lumbridge's counts are unchanged.
- **Streamed collision.** `export:collision` writes 16-tile cells (`collision/index.json` + `<cx>_<cy>.bin`; Misthalin has 5.46M triangles in 464 cells, the largest ~88k at the castle). `CollisionStream` loads cells within 44 m, builds one BVH per frame, and keeps up to 1.8M triangles cached. `WorldCollision` only queries cells overlapping a query. Rails have a spatial index (`railsNear`). A 20k-query comparison against one merged mesh gave identical ground heights; movement differs by the order corrections are applied in (median 1 cm).
- **Water.** The traversal flag also marked rocks and fenced-off land as "water" (stopping riders there). It now requires a water overlay texture (669 or 651).
- **Teleports, minimap, world map.** `places.ts` lists 11 spots, each checked for open, rideable ground. T opens a spellbook-style menu. The teleport animation plays while the destination preloads, and its render chunks are pinned so the rider's current spot can't cancel them. `export:minimap` rasterizes terrain colours, water and walls into `minimap.png`; `minimap.ts` draws the RS-style rotating minimap and a Tab world map (click a town to teleport).
- **Riding physics.** Slope gravity: downhill speeds up, uphill slows, and stalling rolls back fakie. Kickers launch: a sustained incline (both incline samples up for 0.6 m) carries its vertical speed off the lip; curbs don't. The incline is measured from the ground under the board, not the raised support height. Downslope landings convert the fall into speed. Powerslides (S + A/D) link after landings.
- **Tricks** (`tricks.ts`): direction + Q/E picks 10 flips and shove-its, each with its own board spin spec; C grabs (5, held, with a tuck pose that lifts the board to the hand); 6 grind styles picked at the catch, each with board attitude, value and wobble. S held for a 5-0 needs a fresh press to drop off. The tuck (Space held in the air) replaces "hold S" for skipping grinds and wallrides. M+W nose manual. Spins score on their own.
- **Quick drop and quarter pipes.** `props.ts` has six obstacles with collision, grind lines and per-map saving (`scape-skate-props-<area>`). Quarter pipe faces are analytic (`transition.ts`); the sides, back and deck are ordinary collision. The skater's `transition` state is arc length, coping offset, signed speed along the nose, and board direction on the face. Gravity is 7.5 on the face for arcade-sized airs; vert lips send you straight up with a 0.4 m/s drift back over the face; landings reuse the normal rules (so you come down fakie unless you spin). Vert airs spin faster, and the camera faces the ramp. Coping grinds need Shift, so vert airs aren't swallowed.
- **Session marker** (Z/X) restores position, heading and speed. **Surge** (G / R3): +5 m/s (at least 11), 8 s cooldown, blue trail.
- **Challenges and the Skateboarding skill.** Five goals per spot, Easy→Grandmaster (bronze→rune badges). `ChallengeTracker` measures grind lines, clean airs, manual/wallride/grab times and banked combos. XP uses the RS curve (99 = 13,034,431); combos give score/4. Saved in the profile (`xp`, `challenges`; old saves load).
- **Audio** is procedural: rolling, pop, landing, metal/stone grinds, powerslide, whoosh, Surge, fanfares.
- **Assets.** Exporter-only files moved to `work/world/<area>`, so the production build went from 1.6 GB to 709 MB. `play.bat` checks the Misthalin files, rebuilds with more memory, and catches old render formats.
- Validation: 72 tests; the Misthalin fuzz (40 × 40 s) found no physics issues. In the browser I verified: Lumbridge → Varrock teleport, minimap and world map, a boardslide, a quarter pipe ride with vert air, kicker launches, quick drop with the B menu, and a challenge completion → level 14 toast.

## Playtest feedback pass (Claude, 2026-10-09) — supersedes the grind-attachment notes below

- **Fakie and revert.** Landing backwards keeps the fakie stance (THPS behaviour); the rider now looks over the other shoulder (`fakie` in `SkatePose`). Landings open a 0.3 s `LANDING_WINDOW` before the combo banks: Shift/RB reverts (180° on the ground, +100, flips stance) and links the combo; M starts a manual.
- **Push clipping.** `pushFoot()` in `src/player/skate-rig.ts` moves the pushing foot out past the deck edge before lowering it, sweeps back on the ground and returns on an arc. Worst foot/deck penetration measured at 0.6 cache units.
- **Magnetic grinds.** `tryGrind` picks the best rail within `GRIND_CATCH` reach (0.45 m, 0.8 m with Shift/RB), snaps up from up to 0.3 m below the lip, accepts slow rises (below 2 m/s), and allows a flip that is at least 70% done. Grind balance starts calm and wobbles harder over three seconds.
- **Wallrides.** Hitting a wall in the air at under 50° with at least 3 m/s, 0.3 m up, starts a `wallride` phase: reduced gravity, 150 points/s, and duration grows with speed (0.6–2.2 s). A wall touched in the last 0.5 s still catches if you ollie beside it. Entry lift is capped at 2.4 m/s so an ollie rides along the wall instead of over it. Space wallies off. On low walls a high entry carries over the top into a grind. The board rolls about 80° and the rider about 45° (`main.ts`).
- **Bridges.** Lumbridge's wooden bridge decks are type-22 ground decor on plane 1 and were skipped by collision. `tools/export-collision.ts` now keeps ground decor whose geometry is a flat walkable floor (`isFloor`). Both river bridges are solid; regenerate `collision.bin` after world exports.
- **Connected grind lines (after the grind video).** The user's recording showed fence and bridge grinds dropping within a second. The cause was the rail export: every wall piece became a flat line at its highest point, and pieces joined only when collinear and level, with corner pieces skipped. On Lumbridge's hills only 46% of line ends continued and most lines were shorter than 1 m. Now `tools/export-collision.ts` measures each piece's top as a sloped polyline (`topLine`), splits L-corner walls (type 2) into both edges (`splitCorner`), includes diagonal walls (type 9) and skips doors. `connectRails` in `src/shared/rails.ts` welds touching ends (0.32 m / 0.5 m) and merges straight steady-slope runs. Result: 4,150 tops → 2,829 segments; 91% of ends continue; 85% of grindable length sits in runs of 15 m or more; the east bridge walls are one arch. A catch sweep on the real geometry (4 angles × 12 pop timings) went from 0–1/48 long grinds to 28–39/48 on the cabbage-field fence and the bridge. Grinds now pitch the board with the slope and add a small downhill/uphill speed change. `src/game/sparks.ts` adds grind sparks; the balance meter is larger and sits above the rider.
- `npm test`: 56 tests.

## Latest changes (Claude, 2026-10-09) — supersede the texture, lighting and animation notes below

- **Textures are real.** `npm run export:surfaces` compiles the 2009 client's own procedural texture code (`Texture`/`TextureOp*` from `vendor/rt4-client`, AGPL, not vendored) against the stubs in `tools/texgen/java` and renders all 680 textures exactly; the used ones go into `public/surfaces/textures.png` as a WebGL2 texture array. The old reconstructed atlas and `src/world/material.ts` are gone.
- **HD look.** `tools/cache/model.ts` decodes texture spaces and computes GlModel UVs (planar/cylinder/cube/sphere) and smooth normals; `tools/world/mesh.ts` writes per-vertex colors (loc ambient + 64, texture brightness), normals and UVs to `*.shade.bin`, terrain uses textured underlays/overlays and the client's ground shadow map. Render chunks are format SCK2 (adds UVs, sRGB colors). `src/world/rs-material.ts` is the one shader for world, avatar, board and park: lit = color × (1.152 + 0.699 N·L), texture combine modes, alpha cutouts, beige linear fog; no tone mapping.
- **Animation on the RS rig.** `src/player/rs-pose.ts` applies poses for the player animation base in floating point, tweens cache frames and crossfades any pose change. `src/player/skate-rig.ts` authors skate poses on base transforms (indices in `JOINT`) with leg IK on measured pivots. The earlier heuristic per-slot deformation rig was removed. Pose lab: `/lab.html`.
- **Fixes.** Riding off a rail end no longer lands on the rail's own top; walk-mode HUD; training grounds use RS materials with cache textures; board colors scaled for RS lighting.
- **Launcher.** `play.bat` / `npm run play` (`tools/play.mjs`).

Export order is now: world, player, render, collision, surfaces.

## Current scope

The user requested a fuller game, a camera that follows behind and turns with the rider, fairer collisions, solid visible surfaces, skating animation and detailed graphics. These requirements supersede the first-pass prototype behavior. No direct connection to Opus 5.5 or current Opus assignment was available. The Git baseline remains `c7aac86`; all work is left uncommitted and reviewable in the working tree.

## Implemented

- Renderer-independent 120 Hz arcade controller with push/coast/brake, coyote time and buffered ollies, flips/shove-its/spins, fakie momentum, slope pitch, manuals, balance, rail attachment, ollie-out and connected combo banking.
- Contact normals separate head-on impact speed from total speed. Small curbs clear the board footprint. Glancing hits slide. Failed tricks stumble. Hard bails animate and recover in place, with a short grace period; safe-ground relocation is limited to water/out-of-bounds recovery.
- A turning chase camera with temporary manual orbit, V free-camera toggle, obstruction avoidance and immediate teleport snapping.
- Procedural body/gear deformation for skating stance, pushing, crouching, air/kick, land compression, balancing, bails and recovery. Native RS walk/run/emote/teleport playback remains intact. Teleport is bounded to 1.6 seconds because its cache sequence contains a 401.36-second server-controlled hold.
- Authored training grounds outside the original map bounds, with solid patterned stone floor/walls, two bank ramps, two rails, a low ledge and five collectible runes. P visits; T returns home.
- Two-minute scoring runs, bounded last-combo overtime, results/retry flow, free skate, pause/help menus, seven quests and four earned deck colors. Career saves best run/combo, lifetime score, quests and unlocks in localStorage.
- Rolling/action audio with mute; standard gamepad input. Native gamepad hardware has not been tested.
- Rendered terrain/objects preserve texture identifiers in material sidecars. The atlas restores 29 simple original cache bitmaps among 680 slots; remaining procedural graphs use detailed reconstructed surfaces. World shader projects textures onto surfaces and adds stone detail. Lighting is toned down; short unnamed nonblocking floor vegetation is tinted green.
- Collision now includes physical object geometry even when its tile blockwalk flag is off. Grass, bushes, flowers and wall decorations remain nonblocking. Traversal flags stop grounded riders before water and permit solid bridges. Exported bounding geometry supplies 1,813 candidate low world ledges/fences for grinds, in addition to the two training rails.

## Files

`src/main.ts` wires the systems. Game modules are under `src/game/`: `skater.ts`, `camera.ts`, `board.ts`, `park.ts`, `career.ts`, `ui.ts`, `audio.ts`, `gamepad.ts`, `input.ts`. `src/player/skate-pose.ts` handles anatomical pose deformation; `Avatar.setSkatePose` applies it across cache kit/item vertices. `src/world/material.ts` owns the atlas shader; `collision.ts` owns BVHs, support/capsule queries, traversal and camera clearance.

Export additions are `tools/export-collision.ts`, `tools/export-surfaces.ts`, `tools/cache/sprite.ts`, and texture/traversal changes in `tools/export-world.ts` / `tools/world/mesh.ts`. Native cache/model decoding remains otherwise unchanged. No dependency update was needed.

## Regenerating assets

Run `export:world`, then `export:collision`, `export:surfaces` and `export:player` as appropriate. The current Lumbridge collision export contains 1,577,596 physical triangles from 2,891,683 rendered object triangles. New assets include `*.materials.bin`, `traversal.bin`, `rails.json` and `public/surfaces/atlas.png` / `manifest.json`; all remain ignored with other cache assets.

## Verification

All 30 tests pass, TypeScript and production build pass, and the existing bundle-size warning remains. Regression coverage includes frame-rate consistency, score banking, late tricks, curb traversal, glancing collisions, recovery position, water/bridge traversal, manuals, grind/ollie-out, saved unlocks, run end/overtime, cache sprite transparency and animation completion/deformation.

Browser smoke testing has verified a landed 800-point kickflip, an 856-point grind combo, corresponding Rune/Dragon deck unlocks, stable training-ground camera snapping, and detailed Lumbridge surfaces. Further final browser checks are recorded below. Browser playtests use `?test=1`, which saves under a separate profile key.

## Next development

1. Fully evaluate the original procedural texture graphs and port original model UVs. Current reconstruction looks more detailed but is not a complete original-cache texture renderer.
2. Polish authored skate animations, foot planting, clothing and weapon deformation, ragdoll/recovery visuals and push cadence.
3. Add quarter-pipe/vert transitions, richer tricks, authored world challenges/routes and more skate spots. Review auto-generated ledges and the short unnamed-vegetation heuristic.
4. Stream regions and instance render objects; simplify collision and build BVHs off the main thread.
5. Add dynamic doors/world interactions and replace cache roof placeholders with authored assets.
6. Test gamepad hardware and broader device/performance coverage; local single-player saves work, online multiplayer/cloud saves are not implemented.

Final browser verification: the full two-minute run ended with the results card at 1,656 points. A manual banked 293 points and completed its quest; the best combo, three completed quests, and selected Dragon deck survived reload. Runtime logs were clear during final playtesting. Cache grass colors were preserved after identifying short unnamed decorative models whose blockwalk defaults differ from normal objects.

## Performance repair after the lag report

The user reported severe lag in Brave. The initial preview submitted about 2.99 million triangles every frame, including in the training grounds, and measured roughly 28–29 FPS at a 1920×1080 backing buffer on the Intel GPU. The training floor alone used hundreds of individual draws.

Implemented `tools/export-render.ts`, `src/shared/render-chunk.ts` and `src/world/render.ts`. The exporter preserves all 2,974,970 source triangles in 340 spatial chunks, deduplicates compatible vertices, and packs positions, normals, linear colors, material references and indices. Runtime loads nearby chunks with two requests in flight, prefetches ahead, disposes distant geometry and rejects obsolete queued/results after teleport. The world collision mesh remains separate and fully available, so streaming does not remove collision.

All 255 training-floor tiles now use one InstancedMesh. Rendering uses a 64-tile fog/culling distance and a default pixel ratio capped at 1; high-performance GPU preference is requested. The higher former ratio remains available through `dpr=1.5` for diagnosis. A menu-only draw throttle was tried and removed after the embedded preview showed unstable frame scheduling.

`src/game/performance.ts` provides opt-in diagnostics with `perf=1`. In development, frame reports also stay local to the loopback Vite server, via `vite.config.ts`, `/__game_performance` and ignored `work/performance.json`. Production builds do not post these reports. The user confirmed that movement in Brave felt smoother after reloading.

Final preview samples at the original 1920×1080 backing resolution and the same Intel GPU recorded approximately 150 FPS / 839k submitted triangles in Lumbridge and 163 FPS / 85k triangles in training. These are preview samples, not an automated benchmark of Brave. Preview visibility/frame scheduling varied during diagnosis; the user feedback and geometry/draw-call reductions are the direct confirmation for the intended browser.

All 34 regression tests and the production build pass. New tests cover compact format corruption, zero-copy attributes, coordinate scaling, alpha/material preservation and spatial selection across tile edges. Regenerate in this order after world changes: `export:world`, `export:render`, `export:collision` (plus surfaces/player when needed).

Further work can simplify the global collision meshes and move BVH construction off the main thread to improve startup. Repeated world-object instancing and distant LOD can reduce memory and draw load further. The game still needs the previously recorded visual/animation polish.

## Animation, automatic grinds and open streets — 2026-10-09

The user's latest report was janky skating animation, missing attachment when jumping onto walls/fences, and excessive trees. They clarified that attachment means **automatically grinding along the top**. This section supersedes earlier animation, ledge and export counts above.

### Rider motion

`src/player/skate-rig.ts` now prepares a joint rig once per pose frame, using two-bone IK for knees and elbows, cache bone labels for limb/torso seams, planted feet, and a head facing down the board. `src/player/skate-pose.ts` blends the push/recovery cycle, crouch, air tuck, kick, landing compression, manual and balance poses independently of frame rate. Both rider and deck share a smoothed visual position and heading in `src/main.ts`; deck rotations also blend across state changes. The avatar's sole height is calibrated from its current footwear.

Skate deformation writes Float32 coordinates directly to the rendering geometry instead of rounding the pose back to integer cache units. The native RS walk/run/emote pipeline remains intact. Walking faces the movement direction, and F transfers the travel direction correctly when mounting/dismounting, including a fakie stance.

This is a procedural rig. Authored animation, unusual clothing/weapon deformation and fall/recovery presentation remain polish work; do not treat the pass as a finished animation asset set.

### Automatic top attachment

`src/game/skater.ts` catches a usable wall/fence/rail top while descending, with no Shift requirement, and keeps the grind attached without a held key. The board must reach the actual top; rising or below-top contacts do not automatically latch. Shift/RB supplies a wider catch. S/LT drops to the side, Space/A ollies out, and the departed rail is excluded until landing so an exit does not immediately snap back. The combo banks after a safe landing; lost balance drops it.

`tools/export-collision.ts` derives the thin axis of each original wall/fence mesh rather than using an axis-aligned bounding box. It includes taller reachable tops, uniquely identifies repeated objects, excludes L-shaped corner pieces, stores top width, and joins collinear segments with `src/shared/rails.ts`. Runtime hands off at connected endpoints, including suitable corners. The current Lumbridge export joins 3,696 pieces into **1,448 world grind lines**. Training now has eight lines: two metal rails, two ledge edges and four boundary walls. Auto-generated world lines still need broader authored review, particularly unusually shaped caps and corner transitions.

### Tree cover and assets

`tools/world/tree-policy.ts` retains common trees deterministically by object ID and absolute tile coordinate. The default world export uses density 0.35; this Lumbridge export keeps **91 trees and removes 211** (about 70% of the 302 identified trees). Buildings and non-tree landmarks are preserved. The source cache is unchanged. `npm run export:world -- lumbridge --trees=full` restores full tree cover; regenerate render and collision afterwards.

World, render and collision exports have all been regenerated together. Current totals are 2,931,976 render triangles in 339 compact chunks, including 2,848,689 object triangles and 83,287 terrain triangles. Collision contains 1,534,602 solid object triangles. Removed trees are absent from both rendering and collision.

### Validation and review

All **43 regression tests pass**, TypeScript and the production build pass, and `git diff --check` is clean. Vite still reports the existing bundle-size warning. Added coverage verifies automatic/sticky top catches, perpendicular approaches, rising/below-top rejection, safe exits, segment joining/handoff, IK lengths/foot planting, pose blending, sub-cache-unit vertex motion, and deterministic tree thinning.

Browser testing in the Codex preview verified a charged ollie into the training rail without Shift, an S exit that banked 786 points, and walk/skate mode direction. No warning/error logs appeared. An integration check using the actual exported Lumbridge terrain and collision geometry also automatically caught three nearby stone ledges (`loc-33903-0-0-1-103-88`, `loc-33904-0-0-3-103-91`, `loc-33902-1-0-1-104-88`).

The final 1280×720 preview sample held 60 FPS with a 17 ms 95th-percentile frame interval, approximately 102k submitted triangles and 0.6 ms total frame CPU work. This is a preview playtest, not an automated Brave benchmark. The user's earlier confirmation that Brave felt smoother remains the direct Brave feedback. The local Vite server is running at http://localhost:5173; Brave should reload to pick up this pass.

The screenshot and a copy of this handoff are saved under the chat's `outputs` directory. The Git baseline remains `c7aac86`; changes remain uncommitted for collaboration. No direct Opus connection was available, so this file is the review handoff.
