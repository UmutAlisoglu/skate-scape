# Scape Skate

A single-player arcade skating game in the 2009scape world, built with three.js and TypeScript. Explore Lumbridge or ride the authored training grounds, link tricks, complete quests, and unlock decks.

## Play

Double-click `play.bat` (or run `npm run play`). It installs dependencies on the first start, rebuilds any missing game assets, starts the game and opens it in your browser. Keep its window open while you play; closing it stops the game.

## Setup

1. Node.js and a Java JDK (11 or newer, for the texture export).
2. `npm install`
3. Put the 530 cache in `vendor/2009scape-cache/`: `main_file_cache.*`, `xteas.json`, and `item_configs.json` from the [2009scape repository](https://gitlab.com/2009scape/2009scape).
4. Clone the 2009 client source for its texture code: `git clone --depth 1 https://gitlab.com/2009scape/rt4-client.git vendor/rt4-client`
5. Export assets in this order:
   - `npm run export:world`: terrain and objects with HD vertex colors, normals and texture coordinates, plus traversal flags
   - `npm run export:player`: body kits, fashion items (with their textures) and RS animations
   - `npm run export:render`: compact indexed meshes in spatial chunks; rerun after every world export
   - `npm run export:collision`: physical object geometry and grindable world ledges; rerun after every world export
   - `npm run export:surfaces`: renders the cache's procedural textures with the client's own texture code (compiled from `vendor/rt4-client` against small stubs in `tools/texgen`) and packs the used ones into a texture array
6. `npm run dev`, then open http://localhost:5173.

The exports for Lumbridge have already been generated in this working copy. Cache assets, the client source and exported files remain ignored by Git.

## Playing

Choose a two-minute run, free skate in Lumbridge, or the training grounds from the start menu. Runs score only landed combos, end with a results screen, and allow up to eight seconds to finish an active combo at the buzzer. Seven quests track trick variety, grinds, manuals, combos, rune collection and run score. Best runs, best combos, quests and deck unlocks save on this browser.

| Action | Keyboard | Standard gamepad |
| --- | --- | --- |
| Push / brake | W / S | RT / LT |
| Steer; balance during a manual/grind | A / D | Left stick |
| Charge / ollie | Hold / release Space | Hold / release A |
| Kickflip / pop shove-it | Q / E, in the air | X / B |
| Grind | Land on a wall, fence or rail top | Automatic |
| Wider grind catch | Hold Shift in the air | RB |
| Drop off a grind | S | LT |
| Manual; link landed tricks | Hold M while rolling | LB |
| Pause / resume | Escape | Start |
| Training grounds / home | P / T | Menu buttons |
| Follow / free camera | V; drag to look around | Mouse |
| Walk / skate | F while grounded | Keyboard |
| Outfit / gender | R / G | Keyboard |
| Help | H | Menu button |

Walk mode uses camera-relative WASD and Shift to run. Emotes are on 1–0 while stationary. The pause menu contains earned decks and a sound toggle.

Grinds attach automatically when descending onto a usable top. You stay attached without holding a key, and connected segments carry the grind around corners. Shift/RB widens the catch; S/LT drops to the side and Space/A ollies out. A rising jump or contact below the top does not latch.

Small curbs can be ridden over. Glancing contacts slide and slow you; only a fast head-on impact produces a full bail. A failed trick loses its combo and causes a brief stumble. Normal bails recover at the contact location; water landings and leaving the loaded world return you to safe ground. The camera follows behind the board's travel direction, preserves the view while spinning, and snaps immediately on teleport.

## Look and animation

The world is drawn the way the 2009 HD client draws it: real cache textures at the models' own texture coordinates, face colors scaled by each object's ambient, the client's light (ambient 1.15 + 0.7 N·L), the ground shadow map objects cast on nearby tiles, and its beige distance fog under a blue sky.

Players animate on the cache's player animation base, like the client: walk, run, emotes and teleport tween between frames, and every switch (including into and out of skating) crossfades. Skate poses are authored on the same joints with leg IK on the measured hip, knee and ankle pivots, so feet stay on the deck and every kit and worn item deforms correctly. Open http://localhost:5173/lab.html (add `?look=random` for a random outfit) to see all skate poses side by side.

This Lumbridge export keeps 91 of 302 identified trees, opening the streets while retaining other scenery. To restore the original tree cover, run `npm run export:world -- lumbridge --trees=full`, then regenerate render and collision assets.

## Architecture and validation

- `src/game/`: fixed-step controller, board, chase camera, sessions/career, game UI, audio, gamepad input and training grounds
- `src/player/`: cache avatar composition, RS pose application/tweening (`rs-pose.ts`) and skate poses on the RS rig (`skate-rig.ts`)
- `src/world/`: loading, streaming, BVH capsule collision, traversal flags, the RS shader (`rs-material.ts`) and sky
- `tools/cache/`: cache, model, definition, sprite and animation decoding
- `tools/world/`: terrain/object geometry building
- `tools/texgen/`: stubs and driver that run the client's procedural texture code
- `tools/fuzz-skater.ts`: random-input physics fuzzing against the exported Lumbridge collision
- `tests/`: gameplay, collision, progress saves, cache assets and animation regressions
- `docs/HANDOFF.md`: implementation notes for collaborators

`npm test` runs 47 regression tests. `npm run build` checks TypeScript (including tests and the dev configuration) and makes the production build. The cache sprite format was checked against the [530 RT4 client's sprite decoder](https://github.com/Pazaz/RT4-Client/blob/master/client/src/main/java/rt4/SpriteLoader.java).

Rendering streams nearby 16-tile sections, unloads distant geometry, uses compact indexed GPU attributes, and batches all training floor tiles into one draw call. Collision remains separate, so visible distance does not change solidity. Distant scenery fades into fog at 64 tiles. The default rendering scale is capped at 1 to avoid unnecessary supersampling on high-DPI displays.

For local diagnosis, `?perf=1&test=1` shows frame intervals, CPU timing, submitted triangles, draw calls, and loaded geometry. Add `&dpr=1.5` to reproduce the former backing resolution. The development server collects these local reports at `/__game_performance` and `work/performance.json`; production builds do not send them.

## Remaining development

- Ground textures use one texture per tile; the client also blends neighbouring tiles' textures. Water has no animated material yet.
- Skate poses are hand-authored on the RS rig; bails still fall by tilting the whole rider rather than using a dedicated animation.
- Bank ramps are rideable; curved quarter-pipe transitions, vert physics and more trick types still need work.
- Render geometry now streams and training tiles use instancing. Repeated world-object instancing, collision simplification and background BVH construction remain useful for reducing startup time and memory further.
- Some roof models in this cache are placeholders. Dynamic doors and full world interactions are still to be added. Automatically derived grind ledges should be reviewed against the original geometry.
- Saves are local to this browser. There is no online multiplayer or cloud save.
