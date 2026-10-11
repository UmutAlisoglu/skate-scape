# Contributing to Skate Scape

Thanks for wanting to help! Skate Scape is an early-access fan project, and every bug report, idea and pull request makes it better. You don't need to be an expert: small, focused fixes are the most valuable kind of help.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** or a performance problem.
- **Suggest a feature** or tell us what feels wrong when you play.
- **Fix something.** Issues labelled [`good first issue`](https://github.com/UmutAlisoglu/skate-scape/labels/good%20first%20issue) are a gentle start, and [`help wanted`](https://github.com/UmutAlisoglu/skate-scape/labels/help%20wanted) ones are bigger.
- **Improve the docs.** If a step confused you, it will confuse the next person too.

## Reporting bugs

1. Search the [existing issues](https://github.com/UmutAlisoglu/skate-scape/issues) first; someone may have reported it already.
2. Open a new issue with the **Bug report** template (or **Performance problem** for slowness, stutter or memory).
3. Include:
   - what you did, what you expected, and what happened instead;
   - where in the world it happened (the town, or press `T` and note the nearest teleport);
   - your browser, operating system and graphics card;
   - errors from the browser console (`F12` → *Console*), and a screenshot or short clip if you can.

**Never attach game asset files** (anything from `public/` or `vendor/`) to issues or pull requests.

## Making a change

### 1. Set up

1. **Fork** the repository on GitHub (the *Fork* button, top right).
2. Clone your fork and install:
   ```bash
   git clone https://github.com/<your-username>/skate-scape.git
   ```
   ```bash
   cd skate-scape
   ```
   ```bash
   npm install
   ```
3. Generate the game assets with [docs/ASSET_SETUP.md](docs/ASSET_SETUP.md). For most work the small `lumbridge` map is enough.
4. Create a branch for your change:
   ```bash
   git checkout -b fix/grind-wobble
   ```

### 2. Code style

Match the code around you; consistency matters more than any rule. In short:

- **TypeScript, strict.** `npm run typecheck` must pass, with no `any` unless it's unavoidable.
- **Small modules with one job.** Gameplay lives in `src/game/`, rendering and streaming in `src/world/`, asset export in `tools/`.
- **Tunable numbers go in named constants** at the top of the file (`ROLL`, `LANDING`, `MEGA`…), not magic numbers inline.
- **Comments explain *why*,** not what. A short doc comment on exported classes and functions is welcome.
- **Gameplay is forgiving by default.** Prefer a wobble or partial penalty over a hard fail, and never leave the player stuck.
- **Performance counts.** Avoid allocating objects every frame in hot paths (the skater step, the render loop), and don't load anything that scales with the size of the whole world.
- No new dependencies without discussing it in an issue first.

### 3. Test your change

Run all three before opening a pull request:

```bash
npm run typecheck
```
```bash
npm test
```
```bash
npm run build
```

The tests don't need the game assets. Then **play it**: `npm run dev`, open http://localhost:5173 and try what you changed. Handy tools:

- `?area=lumbridge` loads the small map.
- `?perf=1` shows frame time, CPU time, draw calls, triangles and loaded geometry (handy for performance work).
- `lab.html` shows the skate poses and decks.
- `npx tsx tools/fuzz-skater.ts` throws random input at the physics to find spots where the skater gets stuck (`AREA=lumbridge`).

For physics or gameplay changes, add or update a test in `tests/` when you can.

### 4. Open a pull request

1. Commit with a clear message that says what changed and why, e.g. `Stop the camera clipping through Varrock's walls`.
2. Push your branch and open a pull request against `main`. The template has a short checklist.
3. **Keep pull requests small and focused**: one fix or feature each. Several small PRs are much easier to review than one big one. Don't mix refactoring or formatting changes with a fix.
4. The build check runs automatically. Once it passes, a maintainer reviews your PR. We may ask for changes, so don't take it personally!

## Licence

Skate Scape is licensed under the [GNU AGPL v3](LICENSE). By contributing, you agree that your contribution is licensed under the same terms. Only contribute code you wrote yourself, or code under a compatible licence with its notice kept.

## Questions?

Open an issue, or email [umut@alisoglu.com](mailto:umut@alisoglu.com).
