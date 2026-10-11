# Asset setup

Skate Scape's maps, models, textures and animations come from the 2009 RuneScape game cache. They belong to Jagex, so **they are not in this repository**. Instead, you download the cache that the [2009scape](https://gitlab.com/2009scape/2009scape) project publishes and convert it on your own computer. The converted files go to `public/` and the downloads go to `vendor/`. Git ignores both folders, so **never commit them**.

These steps were tested from a fresh clone on Windows 11. The commands are for **Git Bash** (installed with Git for Windows); they work the same on macOS and Linux.

## What you need

| Tool | Version | Used for |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 24 LTS or newer | everything |
| [Git](https://git-scm.com) | any recent | downloading the cache and the client source |
| Java JDK, e.g. [Temurin](https://adoptium.net) | 11 or newer | `export:surfaces` (runs the 2009 client's texture code) |
| Disk space | 1 GB for Lumbridge, ~5 GB for the whole world | |

Check them with `node --version`, `git --version` and `java -version`.

## 1. Install the project

From the project folder:

```bash
npm install
```

## 2. Download the 2009scape cache (~90 MB)

This fetches only the cache folder and two config files from the 2009scape repository, not the whole server:

```bash
git clone --depth 1 --filter=blob:none --no-checkout https://gitlab.com/2009scape/2009scape.git vendor/2009scape-src
```
```bash
git -C vendor/2009scape-src sparse-checkout set --no-cone Server/data/cache/ Server/data/configs/xteas.json Server/data/configs/item_configs.json
```
```bash
git -C vendor/2009scape-src checkout
```
```bash
mkdir -p vendor/2009scape-cache && cp vendor/2009scape-src/Server/data/cache/* vendor/2009scape-src/Server/data/configs/xteas.json vendor/2009scape-src/Server/data/configs/item_configs.json vendor/2009scape-cache/
```

You should now have `vendor/2009scape-cache/main_file_cache.dat2` (about 91 MB), `main_file_cache.idx0` to `idx28` plus `idx255`, `xteas.json` and `item_configs.json`.

## 3. Download the 2009 client source (for textures)

```bash
git clone --depth 1 https://gitlab.com/2009scape/rt4-client.git vendor/rt4-client
```

## 4. Export the assets

Run these in order. The first one decides which map you get.

**a) The map.** Start with Lumbridge. It's small and takes about 15 seconds:

```bash
npm run export:world -- lumbridge
```

| Map | Area | Time | Size |
| --- | --- | --- | --- |
| `lumbridge` | Lumbridge and its surroundings | ~15 s | ~150 MB |
| `misthalin` | Lumbridge, Varrock, Draynor, Al Kharid | a few minutes | ~540 MB |
| `gielinor` | the whole mainland (the full game) | 10–20 min | ~3.7 GB |

The whole world needs more memory than Node allows by default. Run this first in the same terminal:

```bash
export NODE_OPTIONS=--max-old-space-size=16384
```

An interrupted export resumes where it stopped, and `--fresh` starts over. You can export several maps; they live side by side in `public/world/<map>`.

**b) Players, NPCs and textures** (a few seconds each):

```bash
npm run export:player
```
```bash
npm run export:npcs
```
```bash
npm run export:surfaces
```

`export:surfaces` should print `Rendered … textures at 128px, 0 failed`. **Run it again whenever you export another map**, because it only packs the textures your exported maps use.

## 5. Play

```bash
npm run dev
```

Open http://localhost:5173. The game opens the biggest map you've exported. To pick one, add `?area=`: http://localhost:5173/?area=lumbridge.

Alternatively, double-click `play.bat` (or run `npm run play`). It builds anything missing, defaulting to the **whole world**, and opens the game.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Missing vendor/rt4-client` | Do step 3. |
| `Could not open the game: … manifest.json: invalid JSON` | That map isn't exported. Run `npm run export:world -- <map>` or use `?area=` with a map you have. |
| `This map was exported in an older format` | Re-run `npm run export:world -- <map> --fresh`. |
| White or untextured buildings | Re-run `npm run export:surfaces` after exporting the map. |
| `JavaScript heap out of memory` | Set `NODE_OPTIONS` as shown in step 4a. |
| `java` is not recognised | Install a JDK and reopen the terminal. |

## What's generated where

| Folder | Contents | In Git? |
| --- | --- | --- |
| `vendor/2009scape-cache/` | the cache and configs you downloaded | no |
| `vendor/rt4-client/` | the 2009 client source | no |
| `public/world/<map>/` | render chunks, collision cells, minimap, runes | no |
| `public/player/`, `public/npcs/` | avatars, items, animations, NPC models | no |
| `public/surfaces/` | the texture atlas | no |
| `work/` | exporter progress and caches | no |
