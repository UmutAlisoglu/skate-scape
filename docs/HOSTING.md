# Hosting the playable site

The game is a static website: no server code runs. It has two parts, hosted separately:

| Part | Size | Where |
| --- | --- | --- |
| The game page (`npm run build` → `dist/`) | ~2 MB | Cloudflare Pages (or any static host) |
| The generated assets (`public/world`, `player`, `surfaces`, `npcs`) | ~3.8 GB for the whole world | a Cloudflare R2 bucket |

The page loads the assets from the URL in `VITE_ASSET_BASE`, set at build time. The game only downloads the area around the player, so the size of the bucket doesn't affect loading time.

The assets are converted Jagex content. Keep them **out of this Git repository**: they live only in the bucket.

## 1. Assets → Cloudflare R2

1. Generate the assets ([ASSET_SETUP.md](ASSET_SETUP.md)), e.g. `npm run export:world -- gielinor` plus player, npcs and surfaces.
2. In the Cloudflare dashboard, create an R2 bucket (e.g. `skate-scape-assets`) and connect a custom domain such as `assets.example.com` (*Settings → Public access*).
3. Add a CORS rule so the game page may fetch from it (*Settings → CORS policy*):
   ```json
   [{ "AllowedOrigins": ["https://play.example.com", "http://localhost:5173"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
   ```
4. Upload the four folders, keeping their paths (`world/…`, `player/…`, `surfaces/…`, `npcs/…`). With ~33,000 files, use an S3-compatible tool such as [rclone](https://rclone.org/s3/#cloudflare-r2) rather than the dashboard:
   ```bash
   rclone copy public r2:skate-scape-assets --include "/{world,player,surfaces,npcs}/**" --transfers 32 --progress
   ```

## 2. Game page → Cloudflare Pages

Connect the GitHub repository in *Workers & Pages → Create → Pages* with:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | `VITE_ASSET_BASE` = `https://assets.example.com/` |
| Environment variable | `NODE_VERSION` = `24` |

Every push to `main` then redeploys the page automatically. Assets only need re-uploading when an exporter changes.

To test a build against the hosted assets locally:

```bash
VITE_ASSET_BASE=https://assets.example.com/ npm run build && npx vite preview
```
