# Skate Scape

**An arcade skateboarding game set in the 2009 RuneScape world, playable in your browser.**
Tony Hawk's Pro Skater 3 + 4 style combos meet skate.-style freedom across the whole of Gielinor: grind Lumbridge's castle walls, drop in from a mega ramp outside Falador, get catapulted across the map, race the Gnome agility course, and level up a brand-new Skateboarding skill to 99.

<!-- Screenshot / GIF goes here, e.g. ![Skate Scape gameplay](docs/images/gameplay.gif) -->
> 📸 *Screenshot / gameplay GIF coming soon.*

> ⚠️ **Early access.** The game is very playable but rough around the edges. Expect bugs, placeholder art and big changes. Help is very welcome; see [Contributing](#contributing).

> **Unofficial fan project. Not affiliated with or endorsed by Jagex. RuneScape is a trademark of Jagex Ltd. This repository does not contain Jagex assets.**

## Features

- **The whole mainland, free to roam:** about 1,800 × 1,700 tiles from Castle Wars to Port Phasmatys, streamed in as you skate, with 37 teleport spots.
- **THPS-style combos:** flips, shove-its, grabs, grinds on any wall, fence or rail, manuals, reverts, powerslides and wallrides, plus RS-themed special tricks once your special bar is full.
- **skate.-style freedom:** drop your own kickers, rails and quarter pipes anywhere, set a session marker and retry a line, replay the last 20 seconds.
- **Insane stuff:** four mega ramps, six catapults that throw you between towns, wallplants and Agility leaps onto rooftops.
- **A Skateboarding skill (1–99):** RuneScape's XP curve, with unlocks such as Wallplant, Agility leap, Iron knees and Double leap.
- **Progression:** five tiered challenges per town, town runes to collect, metal-tier boards (Bronze to Third-age), unlockable decks and pets that skate along with you.
- **A living world:** NPC skaters who chat in RS style ("gimme gp pl0x"), random events (Evil Chicken, Genie, Sandwich Lady…), agility-course and downhill races with medals and ghost runs.
- **The 2009 HD look:** real client textures, lighting, fog and player animations, rendered with three.js.

The full controls and mechanics are in [docs/GAMEPLAY.md](docs/GAMEPLAY.md).

## Quick controls

| Action | Keyboard |
| --- | --- |
| Push / brake / steer | W / S / A, D |
| Ollie (hold to charge) | Space |
| Flip / shove-it / grab tricks | Q / E / C (+ W/A/S/D) in the air |
| Manual / revert | M / Shift after landing |
| Surge (dash) | G |
| Teleport menu / world map | T / Tab |
| Quick drop obstacles | B |
| Pause and help | Escape / H |

A standard gamepad works too.

## Play it

**https://alisoglu.com/skate-scape/** in Chrome, Edge or Firefox on a computer.

The first visit downloads the 2009scape game cache, about 95 MB, straight from the 2009scape project's GitLab, then builds the world in your browser. This takes a few seconds on a fast connection. The browser keeps it, so later visits start in under a second. Nothing from Jagex is hosted by this project.

## Run it locally

1. **Install the tools** (once): [Node.js](https://nodejs.org) 24 LTS or newer and [Git](https://git-scm.com).
2. **Get the code:**
   ```bash
   git clone https://github.com/UmutAlisoglu/skate-scape.git
   ```
   ```bash
   cd skate-scape
   ```
   ```bash
   npm install
   ```
3. **Start the game:**
   ```bash
   npm run dev
   ```
   Then open http://localhost:5173. Like the website, it builds the world in your browser from the 2009scape cache on GitLab.

On Windows you can also double-click **`play.bat`**, which installs everything and opens the game. Keep its window open while you play.

**Working on the exporters or playing offline?** You can still convert the cache on your own computer into `public/` with `npm run export:*` ([docs/ASSET_SETUP.md](docs/ASSET_SETUP.md)). The game uses those exports when they're there. Use `?source=gitlab` or `?source=local` to choose.

## Project structure

```
src/
  main.ts          game loop: wires everything together
  game/            gameplay: skater physics, tricks, combos, career, UI, races, events, pets, landmarks…
  player/          RS avatar, animation and skate poses on the RS skeleton
  world/           streaming the map, collision, the RS-style shader, sky
  world/remote/    building the world in the browser from the 2009scape GitLab cache (web workers)
  shared/          data formats shared by the game and the exporters
tools/
  export-*.ts      asset exporters: read the 2009scape cache, write files to public/
  cache/           cache readers (disk and HTTP Range), models, configs, sprites
  world/           turns map regions into terrain, object meshes and collision (shared with the browser)
  player/          builds the player's wardrobe, emotes and the NPCs (shared with the browser)
  texgen/          the 2009 client's procedural texture generator, ported to TypeScript
  play.mjs         the one-click launcher behind play.bat
tests/             regression tests (npm test), no assets needed
docs/              gameplay guide, asset setup, implementation notes
public/            optional local exports (ignored by Git, never committed)
vendor/            the 2009scape cache and client source you download (ignored by Git)
```

Developer notes from the build so far are in [docs/HANDOFF.md](docs/HANDOFF.md).

## Contributing

Bug reports, ideas and pull requests are all welcome, especially for **performance** (loading time, memory, frame rate), **controls/feel** and **bugs**. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and look for issues labelled [`good first issue`](https://github.com/UmutAlisoglu/skate-scape/labels/good%20first%20issue). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence and credits

Skate Scape is free software under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)). You may use, change and share it, but modified versions, including ones you host as a website, must stay open source under the same licence.

Parts of the asset tools, the texture generator and the animation code are ported from the [2009scape RT4 client](https://gitlab.com/2009scape/rt4-client) (AGPL-3.0). The game assets come from the [2009scape](https://gitlab.com/2009scape/2009scape) cache, which your browser (or you) downloads from 2009scape's GitLab. See [NOTICE.md](NOTICE.md) for full credits.

## Contact

Made by **Umut Alisoglu**: [alisoglu.com](https://alisoglu.com) · [umut@alisoglu.com](mailto:umut@alisoglu.com)
