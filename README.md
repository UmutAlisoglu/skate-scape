# Scape Skate

A THPS 3+4-style skating game set in the 2009scape (RuneScape 2009) world, running in the browser (three.js + TypeScript).

## Setup

1. `npm install`
2. Put the 2009scape cache in `vendor/2009scape-cache/` (the `main_file_cache.*` files from `Server/data/cache`, plus `xteas.json` and `item_configs.json` from `Server/data/configs` in the [2009scape repo](https://gitlab.com/2009scape/2009scape)).
3. Export the assets the game loads:
   - `npm run export:world` writes the Lumbridge area to `public/world/lumbridge/`
   - `npm run export:player` writes body kits, fashion items and animations to `public/player/`
4. `npm run dev` and open http://localhost:5173

## Layout

- `tools/cache/`: reads the 530 JS5 cache (store, XTEA, models, loc/floor/item/kit/anim definitions)
- `tools/world/`: builds terrain + object meshes from map regions
- `tools/export-*.ts`: the exporters
- `src/`: the browser game (`world/` loading, `player/` avatar assembly and RS animation playback, `shared/` code used by both)

Cache data and anything exported from it are Jagex assets and stay out of git (`vendor/`, `public/world/`, `public/player/`).

## Known gaps (Phase 0)

- Faces use texture average colors; real textures aren't rendered yet.
- Some roofs are missing: 2009scape's cache has 42-byte placeholder models for them.
- The Lumbridge object mesh is ~3M triangles / 64 MB. It needs instancing and region streaming before going online.
