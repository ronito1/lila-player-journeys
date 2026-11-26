# Architecture

## What I built and why

| Layer | Choice | Why |
|---|---|---|
| Data pipeline | **Python + pandas/pyarrow** (`pipeline/build_data.py`) | The data is fixed (5 days, ~89k rows), so parsing, cleaning and coordinate maths run **once, offline** (~6 s). pandas reads parquet directly. |
| Frontend | **React + TypeScript + Vite, one HTML Canvas** | A minimap is an image with points on it: one canvas with one zoom/pan transform is simpler and faster than a map library. |
| Hosting | **Static site on Vercel** | No server, database or env vars, so nothing can go down or run out of quota during review. |

## Data flow

```
data/player_data/February_*/<user>_<match>.nakama-0        1,243 parquet files
   │ build_data.py: read → decode bytes → fix timestamps → drop duplicate pings
   │                → detect bots → world (x,z) → minimap pixels → group by match
   ▼
web/public/data/index.json      maps, dates, 796 match summaries (drives the filters)
web/public/data/<Map>.json      every match on the map: paths + events (0.1–1.2 MB)
   │ browser: fetch index → fetch selected map (15 s timeout, 2 retries, cached; other maps preloaded)
   ▼
filters + question + playhead → useViewModel (paths, events, heatmap, hotspots, story) → canvas
```

**One JSON per map** (not per match): the browser holds a whole map, so filters, heatmaps and hotspots recompute **instantly** for any date, match, player type or playback time. **Frontend layout:** `lib/` is pure logic (URL state, hotspots, panel text: unit-tested), `hooks/` holds data loading, playback and derived data, and `components/` only render. The canvas redraws in one `requestAnimationFrame` per frame and caches the path layer while zooming, so 60k-point views stay at 60 fps.

**Question layer:** six "lenses" (*Where do players die?* …) are filter presets plus explanation text. The panel's numbers and **top-3 hotspots** (16×16 grid, 3×3 neighbourhood, non-max suppression) are computed live from whatever is on screen, so explanations always match the map. The same 16×16 grid is drawn as **rulers** around the map (A–P, 1–16), so every hotspot also gets a grid square designers can quote ("Mine Pit · H9").

## Coordinate mapping (the tricky part)

Each map has a `scale` and `origin` (from the README). World `y` is **elevation**, so the 2D plane is `(x, z)`:

```
u = (x - origin_x) / scale      v = (z - origin_z) / scale
px = u * 1024                   py = (1 - v) * 1024     ← flip: image Y grows down, world Z grows "north"
```

**Worked example** (AmbroseValley, scale 900, origin (-370, -473)), world `x=-301.45, z=-355.55`:
`u = 68.55/900 = 0.0762 → px = 78` · `v = 117.45/900 = 0.1305 → py = (1-0.1305)·1024 = 890`

- One function (`world_to_pixel`) does this; the frontend only ever sees pixels in a fixed **1024×1024 space**, and the canvas applies one transform for fit/zoom/pan.
- **Verified** three ways: a unit test reproduces the worked example; all 88,894 points overlaid on each minimap follow roads and building interiors (none in water or void); a test asserts every generated point lies inside the image.

## Assumptions and data edge cases

| What I ran into | How I handled it |
|---|---|
| `event` is bytes | Decoded as UTF-8 in the pipeline; the UI never sees `b'…'`. |
| `ts` is labelled ms but holds **Unix seconds** (`1770727161` → 2026-02-10, matching the folder). Read as ms, every match would last < 1 s. | Treated as seconds (cast explicitly, independent of pandas version), then made **relative to match start**. Median match ≈ 6 min, pings every 5 s. |
| Minimaps are 4320², 2160×2158 and 9000², not the documented 1024² | Resized to 2048² and drawn into the 1024 space; the UV maths is resolution-independent. |
| 17 files with numeric (bot-style) IDs emit only human events | **Behaviour first** (`BotPosition` → bot, `Position` → human), then ID. ID-only would leave 16 matches with **zero humans**. |
| 210 duplicate position pings; ~2.3k duplicate `Loot` rows | Dropped duplicate pings; kept loot (several items in one second is plausible). |
| Events are logged at the **owner's** position; in a bot's file `BotKilled` = the bot died | Markers drawn at the logger's position; tooltip wording depends on who logged it; bot-logged markers faded. |
| One match spans two date folders; Feb 14 is partial | Date = folder of the earliest row; Feb 14 labelled "partial day". |

## Trade-offs

| Considered | Decided | Why |
|---|---|---|
| Streamlit vs React | React + Canvas | Smooth playback, zoom and a UI for level designers, not a notebook. More code. |
| Backend + DB vs static JSON | Static JSON | Data never changes and 1.7 MB fits in the browser; a server adds cost and failure modes. Revisit at ~100× data. |
| JSON per match vs per map | Per map | Instant cross-match filters and heatmaps; Ambrose Valley is 1.2 MB (~250 KB gzipped). |
| Precomputed vs live heatmaps/insights | Live, in the browser | They follow every filter and the playhead; ≤60k points is cheap. |
| Charts/dashboard vs map-first + questions | Map-first, question bar, plain-language panel | Users are level designers: they think in places, not tables. |
| Leaflet/Mapbox vs plain canvas | Plain canvas | No projection needed; one affine transform is easy to reason about. |

**Reliability & security** (details in README): URL inputs validated against real maps/matches; strict CSP and anti-framing headers; downloads time out and retry. **Tests:** 10 pipeline tests (`python -m unittest discover pipeline`), 20 frontend tests and ESLint (`npm run check`).
