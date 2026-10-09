# Scape Skate

A single-player arcade skating game in the 2009scape world, built with three.js and TypeScript. Explore Lumbridge or ride the authored training grounds, link tricks, complete quests, and unlock decks.

## Setup

1. `npm install`
2. Put the 530 cache in `vendor/2009scape-cache/`: `main_file_cache.*`, `xteas.json`, and `item_configs.json` from the [2009scape repository](https://gitlab.com/2009scape/2009scape).
3. Export assets in this order:
   - `npm run export:world`: terrain, objects, material references, and traversal flags
   - `npm run export:render`: compact indexed meshes in spatial chunks; rerun after every world export
   - `npm run export:collision`: physical object geometry and grindable world ledges; rerun after every world export
   - `npm run export:surfaces`: cached bitmap textures plus detailed fallback surfaces for procedural texture graphs
   - `npm run export:player`: body kits, fashions and RS animations
4. `npm run dev`, then open http://localhost:5173.

The exports for Lumbridge have already been generated in this working copy. Cache assets and exported files remain ignored by Git.

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

Skating now uses a joint rig with planted feet, bent knees, a complete push/recovery cycle, and blended crouch, air, landing and balance poses. The rider and deck share a smoothed visual position. This Lumbridge export keeps 91 of 302 identified trees, opening the streets while retaining other scenery. To restore the original tree cover, run `npm run export:world -- lumbridge --trees=full`, then regenerate render and collision assets.

## Architecture and validation

- `src/game/`: fixed-step controller, board, chase camera, sessions/career, game UI, audio, gamepad input and training grounds
- `src/player/`: cache avatar composition, RS animations, and procedural skate poses across body kits and worn items
- `src/world/`: loading, BVH capsule collision, traversal flags, and textured material shaders
- `tools/cache/`: cache, model, definition, sprite and animation decoding
- `tools/world/`: terrain/object geometry building
- `tests/`: gameplay, collision, progress saves, cache assets and animation regressions
- `docs/HANDOFF.md`: implementation notes for collaborators

`npm test` runs 43 regression tests. `npm run build` checks TypeScript (including tests and the dev configuration) and makes the production build. The cache sprite format was checked against the [530 RT4 client's sprite decoder](https://github.com/Pazaz/RT4-Client/blob/master/client/src/main/java/rt4/SpriteLoader.java).

Rendering streams nearby 16-tile sections, unloads distant geometry, uses compact indexed GPU attributes, and batches all training floor tiles into one draw call. Collision remains separate, so visible distance does not change solidity. Distant scenery fades into fog at 64 tiles. The default rendering scale is capped at 1 to avoid unnecessary supersampling on high-DPI displays.

For local diagnosis, `?perf=1&test=1` shows frame intervals, CPU timing, submitted triangles, draw calls, and loaded geometry. Add `&dpr=1.5` to reproduce the former backing resolution. The development server collects these local reports at `/__game_performance` and `work/performance.json`; production builds do not send them.

## Remaining development

- The 680-slot surface atlas currently restores 29 simple cache bitmaps. Other procedural texture graphs use detailed reconstructed surfaces; original procedural operators and original model UV mapping still need a complete port.
- Skate motion uses a procedural joint rig with smooth transitions and planted feet. Artist-authored animation, clothing-specific deformation and recovery visuals need further polish.
- Bank ramps are rideable; curved quarter-pipe transitions, vert physics and more trick types still need work.
- Render geometry now streams and training tiles use instancing. Repeated world-object instancing, collision simplification and background BVH construction remain useful for reducing startup time and memory further.
- Some roof models in this cache are placeholders. Dynamic doors and full world interactions are still to be added. Automatically derived grind ledges should be reviewed against the original geometry.
- Saves are local to this browser. There is no online multiplayer or cloud save.
