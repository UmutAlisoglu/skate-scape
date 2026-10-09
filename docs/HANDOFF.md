# Collaboration handoff — updated 2026-10-09

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
