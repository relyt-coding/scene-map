# Scene Map

A clean reader for the [Movie Scene Map](https://moviescenemap.com) open dataset (CC0):
41k places, 45k titles, plus hand-built "view in order" routes.

## Build the data

```powershell
# download the CC0 files once
Invoke-WebRequest https://moviescenemap.com/data/filming-locations.geojson -OutFile raw/filming-locations.geojson
Invoke-WebRequest https://moviescenemap.com/data/productions.csv -OutFile raw/productions.csv

node build/build-data.js
```

`build-data.js` writes the lean files into `web/data/` and validates every curated route
against the place list, so a bad slug fails loudly.

## Add a route

Create `routes/<id>.json`:

```json
{
  "id": "breaking-bad",
  "title": "Breaking Bad",
  "subtitle": "Vince Gilligan · 2008–2013",
  "curated": true,
  "note": "Hand-built. Places are real; order is editorial.",
  "aliases": ["el camino"],
  "stops": [
    { "part": "Season 1", "episode": "Ep. 1", "place": "albuquerque", "scene": "Walt's first cook" }
  ]
}
```

Then `node build/build-data.js` and reload. The route shows up as **View in order** on any
title whose name matches `title` or an alias.

`place` must be a slug from the dataset — the build prints any that don't exist.

## Run locally

```powershell
npx serve web
```

## Deploy

Live at **https://relyt-coding.github.io/scene-map/** (GitHub Pages).

Push to `main` and `.github/workflows/pages.yml` deploys the `web` folder automatically.
There is no build step at deploy time — `web/data` is committed.

```powershell
git add -A
git commit -m "Update data"
git push
```

Netlify is also wired up (`netlify.toml`, publish `web`) if you ever prefer that host:

```powershell
npx netlify deploy --prod --dir web
```

