# Scape Skate

An arcade skating game in the 2009scape world, built with three.js and TypeScript. It mixes THPS 3+4 trick combos with skate.-style freedom across the whole Gielinor mainland, free to roam: Misthalin, Asgarnia, Kandarin, the Fremennik coast, Karamja, the Kharidian Desert, Morytania and the Wilderness, 1,792 × 1,664 tiles from Castle Wars to Port Phasmatys. You can teleport between 37 towns and landmarks, drop your own ramps and rails anywhere, clear tiered challenges and level up the Skateboarding skill.

## Play

Double-click `play.bat` (or run `npm run play`). It installs dependencies on the first start, rebuilds any missing game assets, starts the game and opens it in your browser. Keep its window open while you play; closing it stops the game.

## Setup

1. Node.js and a Java JDK (11 or newer, for the texture export).
2. `npm install`
3. Put the 530 cache in `vendor/2009scape-cache/`: `main_file_cache.*`, `xteas.json`, and `item_configs.json` from the [2009scape repository](https://gitlab.com/2009scape/2009scape).
4. Clone the 2009 client source for its texture code: `git clone --depth 1 https://gitlab.com/2009scape/rt4-client.git vendor/rt4-client`
5. Export assets in this order:
   - `npm run export:world -- gielinor` (or `misthalin`, `lumbridge` for smaller maps): builds the map block by block (4 × 4 regions at a time, each with a one-region border for blending, heights and shadows) and writes everything the game streams: render chunks with HD vertex colours, normals and texture coordinates; per 16-tile cell the terrain, solid objects and connected grind lines; water and void flags; the minimap tiles and world map overview; and the town runes. The whole world takes 10–20 minutes and about 4 GB; an interrupted export resumes where it stopped (`--fresh` starts over). Set `NODE_OPTIONS=--max-old-space-size=16384`.
   - `npm run export:player`: body kits, fashion items (with their textures) and RS animations
   - `npm run export:surfaces`: renders the cache's procedural textures with the client's own texture code (compiled from `vendor/rt4-client` against small stubs in `tools/texgen`) and packs the ones the maps and wardrobe use into a texture array; rerun after exporting a new map
6. `npm run dev`, then open http://localhost:5173 (`?area=misthalin` or `?area=lumbridge` loads a smaller map).

Exported files the game loads go to `public/world/<area>`; the exporter's progress and texture lists go to `work/world/<area>`. Cache assets, the client source and all exported files are ignored by Git.

## Playing

The start menu offers a two-minute run, free skate across the map, or the training grounds. Progress (Skateboarding XP, challenges, quests, decks, best runs) saves on this browser, as do your dropped obstacles (per map).

| Action | Keyboard | Standard gamepad |
| --- | --- | --- |
| Push / brake | W / S | RT / LT |
| Steer; balance on grinds and manuals | A / D | Left stick |
| Powerslide | S + A/D at speed | — |
| Charge / ollie | Hold / release Space | Hold / release A |
| Flip tricks (direction picks the trick) | Q (+ W/A/S/D) in the air | X |
| Shove-it tricks | E (+ W/A/S/D) in the air | B |
| Grabs, held | C (+ W/A/S/D) in the air | Y |
| Grind (direction at the catch picks it) | Land on a wall, fence, rail or ledge | Automatic |
| Wider grind catch / coping grind | Hold Shift in the air | RB |
| Skip a grind | Hold Space in the air | — |
| Drop off a grind / ollie out | Tap S / Space | LT / A |
| Manual / nose manual | Hold M / W + M | LB |
| Revert (links the combo) | Shift right after landing | RB |
| Special tricks (special bar full) | Hold Shift + Q / E / C | RB + X / B / Y |
| Surge (magic dash, 8 s cooldown) | G | R3 |
| Replay the last 20 seconds | Backspace | Pause menu |
| Session marker: set / return | Z / X | — |
| Quick drop obstacles | B, then 1–6, Q/E, WASD, Space, Backspace | — |
| Teleport menu / world map | T / Tab | — |
| Pause / help | Escape / H | Start |
| Training grounds | P | Menu button |
| Follow / free camera | V; drag to look around | Mouse |
| Walk / skate | F while grounded | — |
| Outfit / body type (on foot) | R / G | — |

Flip tricks: Q kickflip, A+Q heelflip, D+Q double kickflip, W+Q hardflip, S+Q impossible. Shove-its: E pop shove-it, A+E varial heelflip, D+E varial kickflip, W+E 360 shove-it, S+E 360 flip. Grabs: C indy, W+C nosegrab, S+C tailgrab, A+C melon, D+C method; they score while held, but landing while still grabbing loses the combo. Grinds: nothing held 50-50, W nosegrind, S 5-0, A/D boardslide, W+A/D crooked, S+A/D smith; harder grinds score more and wobble more.

**Riding.** Hills speed you up and slow you down; you coast a long way on the flat. You can't push up a steep bank, so you roll back down it fakie. Kickers and banks launch you off their lip, but hill crests and gentle slopes keep you on the ground. Landing on a downslope turns the fall into speed. Rolling off a ledge, A/D steers your line instead of spinning you. A clean landing that is a little crooked snaps the board onto the direction you were flying. Powerslides scrub speed, carve, and link after a landing like a revert. Kerbs up to 18 cm are ridden over, and small plants, rocks, stumps and pots are ridden through. Ride into a wall and you turn along it instead of getting pinned. A harder knock is a **Bonk!** that costs a little speed but keeps your combo; only a very fast head-on impact bails. Shorelines and the edge of the map act like walls: you glance along them, and if you ride straight at one you stop and the board swings toward open ground. Bridges are solid. If you fall into a hole in the world (a dungeon entrance, a mine pit) or get stuck on something too steep to stand on, you are brought back to where you rode a few seconds earlier.

**Big air.** Hold Space longer for a higher ollie (almost 2 m fully charged). Skateboarding levels add more: from level 20, Space in the air beside a wall is a **wallplant** that kicks you up and back off it (chain them up between walls); from level 30, Space again in the air is an **Agility leap**, a second jump that reaches roofs and high ledges. Drops up to about 10 m land clean, and from level 70 any height does.

**Combos.** Every trick adds to the multiplier. After each landing a gold bar under the score gives you 0.6 s to keep the combo going: ollie again, manual, revert or powerslide; when it runs out the combo banks. Repeating a trick in one combo scores 25% less each time (down to a quarter), so mix it up. A flip that is at least half done finishes itself as you land. Sketchy landings (mid-flip, sideways, still grabbing) and falling off a grind or manual are wobbles that still bank the combo at half points; only a hard bail loses it. Splashing into water banks the combo before you are put back on shore.

**Grinds** catch automatically within about 0.6 m (wider with Shift/RB), even from slightly below the lip or while still rising slowly. Grind lines follow the real tops of fences and walls, over hills and bridge arches and round corners, with sparks under the trucks. Waist-high blocks such as the Duel Arena's sandstone blocks, crates and market stalls have grindable edges. Keep the balance meter above the rider centred with A/D.

**Town runes.** Every teleport spot hides five runes (Air, Water, Earth, Fire and Cosmic) above its real grind lines, like THPS letters. Four are at ollie height, and one is higher up for a wallride, kicker or quarter pipe. A coloured beam marks each one, and they show white on the minimap. Each rune is worth 1,500 XP, and the full set of five gives a 15,000 XP bonus. The quest card counts them (RUNES n/5).

**Combo ratings.** Banked combos earn a metal rating: Bronze 1k, Iron 2.5k, Steel 5k, Mithril 10k, Adamant 20k, Rune 40k, Dragon 80k and Third-age 150k. Challenges and level-ups set off fireworks.

**Quarter pipes** (from quick drop) are real transitions: ride up the curve, fly straight up out of the lip and come back down into it. Tap A/D in the air to spin 180 and land forward (vert spins are quicker), or come down fakie. Shift catches the coping. W pumps for speed on the face and A/D carve.

**Wallrides:** ollie into a wall at a glancing angle with some speed; faster entries ride longer, and Space pops a wallie. A late ollie beside a wall you just touched still catches.

**Freedom.** Z drops a session marker with your position, direction and speed; X puts you back there to retry a line. B opens quick drop: choose a kicker, quarter pipe, flat rail, ledge, funbox or bank, place the green preview with WASD and Q/E, Space drops it and Backspace removes the nearest. T opens the teleport list and Tab the world map, where clicking a town teleports you. Surge (G) is RS3's dash: a burst of speed on the ground or in the air.

**Live key hints.** A line above the controls suggests the keys that matter right now: ollie onto the ledge ahead (or ollie and leap when it's too high), keep the combo going after a landing, balance on a grind, wallplant at the wall in front of you, leap again, use your special. Basic hints retire after a few showings; the pause menu turns them off.

**Special attack.** Every point a combo earns fills the RS special bar under your score. It drains slowly while you cruise, drops a quarter on a sketchy landing and empties on a bail. When it reads SPECIAL READY (with a chime), your next special trick is worth much more; holding Shift turns the trick keys into specials:
- Shift+Q: Rune flip (a triple kickflip and 360 shove in rune cyan)
- Shift+E: Teleport shove (a 720 shove-it where the board blinks out)
- Shift+C: Dragonfire grab (held, in flames)
- Shift+Q/E on a rail: Godsword grind (gold sparks, no wobble, 500 points a second)

**Gaps.** Clearing water and landing on dry ground scores a Water gap, landing clean from more than 2.5 m a Big drop, and more than 1.3 s of air Hang time.

**Bails** play RuneScape's own death animation while the board flies off and tumbles. You slide on along your line and get back up where you stopped. Pebbles, rubble, stumps and other clutter under shin height are ridden through, and small lips such as rug edges and deck boards are rolled over.

**Replay.** Backspace (or Watch replay in the pause menu) plays back the last 20 seconds of skating with the combo as it was. Space plays or pauses, A/D scrub, W/S change speed (¼× to 2×), dragging orbits the camera, and Backspace returns to the live game.

**Decks.** The board has a kicked nose and tail, wood plies and a painted graphic underneath. The first four decks come from the training quests; each town's Master challenge unlocks its own deck (the Lumbridge castle, the Varrock shield, the Wilderness skull, the Grand Exchange coins and more). `lab.html?decks` shows them all.

**Progress.** Every teleport spot has five challenges, Easy (bronze) to Grandmaster (rune), shown on the quest card while you skate there. Banked combos earn Skateboarding XP (a quarter of the score) and challenges award more. The skill uses RuneScape's experience curve, so level 99 takes 13,034,431 XP. Seven training quests unlock decks.

**Skill unlocks** (listed in the pause menu, announced with a card when you reach them):

| Level | Unlock |
| --- | --- |
| 5 | Steady feet: grinds and manuals wobble less |
| 10 | Strong pop: ollies about 15% higher |
| 20 | Wallplant |
| 30 | Agility leap |
| 40 | Surge mastery: 5 s cooldown |
| 50 | Steady feet II |
| 60 | Big pop: ollies, wallplants and leaps about 35% higher |
| 70 | Iron knees: no heavy landings |
| 80 | Special focus: the special bar fills a third faster |
| 90 | Double leap |
| 99 | Skateboarding mastery: Surge in the air also lifts you |

## Look and animation

The camera keeps its distance behind you, and world geometry between it and the rider (walls, arches, roofs, trees, chandeliers) dissolves with a dithered edge instead of hiding you or pushing the camera in.

The world is drawn the way the 2009 HD client draws it: real cache textures at the models' own texture coordinates, face colors scaled by each object's ambient, the client's light (ambient 1.15 + 0.7 N·L), the ground shadow map objects cast on nearby tiles, and its beige distance fog under a blue sky.

Players animate on the cache's player animation base, like the client: walk, run, emotes and teleport tween between frames, and every switch (including into and out of skating) crossfades. Skate poses are authored on the same joints with leg IK on the measured hip, knee and ankle pivots, so feet stay on the deck and every kit and worn item deforms correctly. Grabs lift the board to the hand. Open http://localhost:5173/lab.html to see all skate poses (`?only=indy,melon` filters, `?view=nose` shows the profile, `?look=random` a random outfit).

Sounds are procedural (Web Audio): rolling, the pop, landings, metal and stone grinds, powerslides, flip whooshes, Surge, and a jingle for challenges and level-ups.

The exports keep about a third of the identified trees (by object and tile, deterministically), opening the streets while retaining other scenery. To restore the original tree cover, add `--trees=full` to `export:world`, then regenerate render, collision and minimap.

## Architecture and validation

- `src/game/`: fixed-step controller (`skater.ts`), trick tables and specials (`tricks.ts`), replay (`replay.ts`), deck designs (`decks.ts`), quarter pipe maths (`transition.ts`), quick-drop obstacles (`props.ts`), challenges and the Skateboarding skill with its level unlocks (`challenges.ts`, `skill.ts`), live key hints (`hints.ts`), town runes (`runes.ts`), fireworks (`fireworks.ts`), teleport spots (`places.ts`), minimap and world map, session marker, board, chase camera, career, UI, audio, sparks, gamepad input and training grounds
- `src/player/`: cache avatar composition, RS pose application/tweening (`rs-pose.ts`) and skate poses on the RS rig (`skate-rig.ts`)
- `src/world/`: loading, render streaming, streamed BVH capsule collision cells and the rail index (`collision.ts`), the RS shader (`rs-material.ts`) and sky
- `src/shared/`: formats and helpers shared by the game and exporters (triangle soups, render chunks, connected grind lines)
- `tools/cache/`: cache, model, definition, sprite and animation decoding
- `tools/world/`: terrain/object geometry building
- `tools/texgen/`: stubs and driver that run the client's procedural texture code
- `tools/fuzz-skater.ts`: random-input physics fuzzing against the exported collision (`AREA=misthalin` for the big map, `LEVEL=60` for that level's abilities, `WHERE=1` to print where bails happen)
- `tests/`: gameplay, tricks, transitions, challenges, collision, progress saves, cache assets and animation regressions
- `docs/HANDOFF.md`: implementation notes for collaborators

`npm test` runs 96 regression tests. `npm run build` checks TypeScript (including tests and the dev configuration) and makes the production build. The cache sprite format was checked against the [530 RT4 client's sprite decoder](https://github.com/Pazaz/RT4-Client/blob/master/client/src/main/java/rt4/SpriteLoader.java).

Rendering streams nearby 16-tile sections (a teleport preloads the nearest ones while the spell plays), unloads distant geometry, uses compact indexed GPU attributes, and batches all training floor tiles into one draw call. Collision streams separately in 16-tile cells, each with its own terrain, solid objects and grind lines (stored relative to the cell's corner, so 16-bit positions work anywhere on the 1,800-tile map): it loads within 44 m and builds at most one cell per frame. Built cells stay cached up to 2.5 million triangles. The minimap loads 1,024-pixel tiles around you over a one-pixel-per-tile overview, which is also the world map. Nothing scales with the size of the world except small index files, so the whole of Gielinor starts as fast as one town. Visible distance does not change solidity. Distant scenery fades into fog at 64 tiles. The default rendering scale is capped at 1 to avoid unnecessary supersampling on high-DPI displays.

For local diagnosis, `?perf=1&test=1` shows frame intervals, CPU timing, submitted triangles, draw calls, and loaded geometry. Add `&dpr=1.5` to reproduce the former backing resolution. The development server collects these local reports at `/__game_performance` and `work/performance.json`; production builds do not send them.

## Remaining development

- Ground textures use one texture per tile; the client also blends neighbouring tiles' textures. Water has no animated material yet.
- Flip tricks animate the board, not the legs' catch; bails use the RS death animation rather than physics.
- Quick-drop obstacles are placed one at a time; there is no full park editor, sharing or undo history yet. Bowls (curved corners) and stairs with handrails are not in the set.
- Repeated world-object instancing and building collision BVHs in a worker would cut memory and the small hitch when a dense cell (the castle) first loads.
- Some roof models in this cache are placeholders. Dynamic doors and full world interactions are still to be added. Automatically derived grind ledges should be reviewed against the original geometry.
- Saves are local to this browser. There is no online multiplayer, leaderboard or cloud save.
