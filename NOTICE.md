# Notices and credits

Skate Scape
Copyright (C) 2026 Umut Alisoglu and contributors

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3 of the License. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for details.

## Trademark and assets

Unofficial fan project. Not affiliated with or endorsed by Jagex. RuneScape is a trademark of Jagex Ltd. This repository does not contain Jagex assets.

The game's maps, models, textures, animations and item data are generated on your own computer from the 2009scape game cache (see [docs/ASSET_SETUP.md](docs/ASSET_SETUP.md)). The generated files (`public/world`, `public/player`, `public/surfaces`, `public/npcs`) and the cache itself (`vendor/`) are excluded from this repository and are not covered by its licence.

## Code ported from the 2009scape RT4 client

Parts of this project are translated from the [2009scape RT4 client](https://gitlab.com/2009scape/rt4-client), which is licensed under the GNU Affero General Public License v3.0:

| File | What it ports |
| --- | --- |
| `tools/cache/reader.ts` | the client's big-endian `Buffer` reader |
| `tools/cache/model.ts` | `RawModel.decodeNew` / `decodeOld`, texture spaces and `GlModel` texture coordinates |
| `tools/cache/npc-defs.ts` | NPC configs and base animation sets |
| `tools/cache/player-colors.ts` | the `PlayerAppearance` colour tables |
| `tools/world/mesh.ts` | `LocType.getRawModel` and the shape-10 diagonal turn |
| `src/player/rs-pose.ts` | `Model.transformBone` (animation transforms) |
| `tools/texgen/java/rt4/*.java` | small stand-ins for client classes (`Buffer`, `Js5`, `SoftwareSprite`, `SpriteLoader`) and a driver, so the client's own procedural texture code can run |

`npm run export:surfaces` compiles the client's texture classes from your local copy of the RT4 client source (`vendor/rt4-client`, downloaded separately, not included here).

## Other credits

- [2009scape](https://gitlab.com/2009scape/2009scape): the game cache, map keys (`xteas.json`) and item data.
- [three.js](https://threejs.org) (MIT), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (MIT), [seek-bzip](https://github.com/cscott/seek-bzip) (MIT) and [Vite](https://vitejs.dev) (MIT).
- Inspired by Tony Hawk's Pro Skater 3 + 4 and skate.
