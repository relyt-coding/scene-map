# Scene Map

A clean map of where films, shows, anime, manga and games are filmed or set.
Live: https://relyt-coding.github.io/scene-map/
Repo: https://github.com/relyt-coding/scene-map (public, `main` auto-deploys)

Read this first, then `README.md` for the route schema.

## Run it

```powershell
# preview (from the project root)
python -m http.server 8123 --directory web
# http://localhost:8123

# rebuild data after editing routes/ or web/app.js
node build/build-data.js

# rebuild including private stills (never committed)
node build/build-data.js --local
```

Push to `main` and GitHub Actions deploys `web/` in ~30 seconds. No build step on CI.

## Files

- `web/` — the site. `index.html`, `app.js`, `styles.css`, `credits.html`.
- `web/data/` — generated. Never hand-edit; re-run the build.
- `routes/*.json` — one file per title. This is where content work happens.
- `build/build-data.js` — reads `raw/` and writes `web/data/`. Validates every
  route slug and prints `MISSING PLACE` / `MISSING PHOTO` loudly.
- `raw/` — the two CC0 files from moviescenemap.com (gitignored). Re-download if missing.
- `private/` — local-only screenshots (gitignored).

## Data contract

Source: Movie Scene Map (CC0). Films/TV are `filmed at`; games/anime/manga are
`set in`. Never present one as the other. A place is not a scene.

## Routes

Each route has `tracks`. `filmed` = where it was shot, `story` = where it takes
place. A stop may set `label` to pin a fictional place to a real one
(`"label": "Hawkins, Indiana"` on `south-bend`). Routes open on `story` when it
has 2+ stops, otherwise `filmed`. Routes also appear in search as "Guided routes",
so a title missing from the dataset (The Raid) still works.

Current routes: jojo, the-last-of-us, stranger-things, outlander, queens-gambit,
homeland, taken, apocalypto, the-raid, the-raid-2, raiders-of-the-lost-ark,
temple-of-doom, last-crusade, kingdom-of-the-crystal-skull, dial-of-destiny,
lost, the-walking-dead.

## Conventions

- `web/app.js` must stay ASCII-only (server sends no charset). Use `\u00b7` etc.
- Do not commit `private/` or `web/data/private/`.
- Photo credit stays visible whenever a Wikimedia image is shown.
- Approximate pins are fine, but say so in the route `note` (example: Gombong →
  Yogyakarta, Tanis → Egypt, the Island → Fiji).

## Known gaps

- JoJo is single-track and has no episode data; the dataset has none.
- The Raid is one stop on purpose: set and shot entirely in Jakarta.
- No "near me", no export, no favourites yet.

## Backlog (top picks)

1. Near me — what was shot within 10/25/50 km.
2. Copy share link / QR per stop.
3. Visited passport + favourites (localStorage).
4. Export route to Google Maps / GPX.
5. More routes: Bond, Mission: Impossible, Lord of the Rings, Your Name, GTA.
