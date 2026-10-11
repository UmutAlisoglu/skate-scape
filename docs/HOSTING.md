# Hosting the playable site

The game is a static website, served by GitHub Pages at **https://alisoglu.com/skate-scape/**. Nobody hosts game assets. Each visitor's browser downloads the 2009scape cache straight from the [2009scape GitLab repository](https://gitlab.com/2009scape/2009scape) and builds the world from it:
- GitLab's API sends the cache with CORS headers and answers Range requests.
- The cache is pinned to one commit (`GITLAB_REF` in `tools/cache/http-store.ts`).
- The download is about 95 MB in under 20 requests, kept in IndexedDB, so later visits download nothing.

| Part | Size | Where |
| --- | --- | --- |
| The game page (`npm run build` → `dist/`) | ~1.2 MB | GitHub Pages |
| The 2009scape cache | ~95 MB, once per browser | 2009scape's GitLab, fetched by the visitor's browser |

Nothing converted from the cache is ever uploaded anywhere: it's built in the visitor's own browser, in web workers, and kept there.

## Deploying to GitHub Pages

1. In the repository's *Settings → Pages*, set *Source* to **GitHub Actions**. The site lands at `https://<owner>.github.io/skate-scape/`. When the owner's user site has a custom domain (`alisoglu.com`), project sites appear under it: `https://alisoglu.com/skate-scape/`.
2. Run the **Deploy to GitHub Pages** workflow (*Actions → Deploy to GitHub Pages → Run workflow*). It runs `npm ci` and `npm run build`, then publishes `dist/`. The workflow is manual on purpose. To deploy on every push to `main`, add `push: { branches: [main] }` under its `on:`.

`npm run build` builds for the `/skate-scape/` path. For another path or a domain root, set `BASE_PATH` (for example `BASE_PATH=/ npm run build`).

To try the production build locally:

```bash
npm run build
```
```bash
npx vite preview
```

Then open http://localhost:4173/skate-scape/ in a fresh browser profile to see a first visit.

## What a first visit costs

Measured on 2026-10-11 in Chrome (fresh profile, `npx vite preview`, a fast home connection):
- **First visit:** the start menu is ready in **7.1 s**. The cache comes down in 18 requests (the index files, the region keys, the item data and three 32 MB blocks of the data file). The player, the NPCs, the textures they use and the streets at Lumbridge are built meanwhile.
- **Every later visit:** the start menu is ready in **0.4 s**, with nothing downloaded.

The rest of the map builds in the background, nearest the rider and the teleport destinations first, and is kept in IndexedDB too.

GitLab allows 500 unauthenticated API requests a minute per IP. The game makes about 18 in total and never starts more than 300 in a minute. It retries a 429 or 5xx with backoff, honouring `Retry-After`. If GitLab can't be reached, the page says so and offers **Try again**.

## Options for testing

| Query | Effect |
| --- | --- |
| `?source=gitlab` | build the world from GitLab even when exports exist in `public/` |
| `?source=local` | play the exports in `public/` (see [ASSET_SETUP.md](ASSET_SETUP.md)) |
| `?area=lumbridge` | a smaller map (`lumbridge`, `misthalin` or `gielinor`, the default) |
| `?cache=off` | don't use IndexedDB (every visit downloads and builds again) |
| `?ref=<commit>`, `?project=<group/name>` | read the cache from another commit or fork |
| `?block=<bytes>` | Range request size (default 32 MB) |

## Hosting exported assets instead (optional)

Exports made with `npm run export:*` can still be served from a separate host, such as an R2 bucket with a CORS rule for the site. Upload `public/world`, `player`, `surfaces` and `npcs` with their paths, then build with `VITE_ASSET_BASE=https://assets.example.com/ npm run build`. The game uses them when that host has the map, and builds from GitLab when it doesn't. They're converted Jagex content, so keep them out of this repository.
