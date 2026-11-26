# Architecture

## What I built and why

| Layer | Choice | Why |
|---|---|---|
| Data pipeline | **Python + pandas/pyarrow** (`pipeline/build_data.py`) | The dataset is fixed (5 days, ~89k rows), so all parsing, cleaning and coordinate maths runs **once, offline**, in about 6 seconds. pandas is the most direct way to read parquet. |
| Frontend | **React + TypeScript + Vite, drawing on one HTML Canvas** | A minimap is just an image with points on it, so a canvas with one transform (zoom/pan) is simpler and faster than a map library. React only holds the filter state. |
| Hosting | **Static site on Vercel** | No server, database or env vars. The JSON is served as static files, so nothing can go down or run out of quota during review. |

## Data flow

```
data/player_data/February_*/<user>_<match>.nakama-0   (1,243 parquet files)
        │  build_data.py: read → decode bytes → fix timestamps → drop dup pings
        │                 → detect bots → world (x,z) → minimap pixels → group by match
        ▼
web/public/data/index.json          maps, dates, 796 match summaries (for the filters)
web/public/data/<Map>.json          every match on that map: player paths + events (0.1–1.2 MB)
web/public/minimaps/<Map>.jpg       minimaps resized to one square size
        │  browser: fetch index → fetch the selected map (cached)
        ▼
filter (date / match / humans-bots / event type / timeline) → canvas draws
minimap → heatmap → paths → markers
```

I chose **one JSON per map**, not one per match. The whole dataset is small, so the browser can hold an entire map and filter or rebuild heatmaps **instantly** for any combination of date, match, player type and playback time. Heatmaps are computed client-side (128×128 grid, 3× box blur), so they always match what the filters say.

## Coordinate mapping (the tricky part)

Each map has a `scale` and an `origin` (from the README). World `y` is **elevation**, so the 2D plane is `(x, z)`:

```
u = (x - origin_x) / scale          v = (z - origin_z) / scale
px = u * 1024                       py = (1 - v) * 1024     ← flip: image Y grows downward, world Z grows "north"
```

**Worked example** (AmbroseValley, scale 900, origin (-370, -473)), world `x=-301.45, z=-355.55`:
`u = 68.55/900 = 0.0762 → px = 78` · `v = 117.45/900 = 0.1305 → py = (1-0.1305)*1024 = 890`

- This lives in **one function** (`world_to_pixel` in `build_data.py`). The frontend only ever sees pixels, so there is exactly one place the mapping can be wrong.
- Everything is expressed in a fixed **1024×1024 map space**. The canvas then applies a single transform for fit, zoom and pan, so markers stay on the right spot at any zoom.
- **How I verified it:** I plotted all 88,894 points of each map over its minimap. Paths follow roads, rivers and building interiors, and nothing lands in water or the void. 0 rows fall outside the image.

## Assumptions and data edge cases

| What I ran into | How I handled it |
|---|---|
| `event` is stored as bytes | Decoded as UTF-8 in the pipeline. The UI never sees `b'…'`. |
| `ts` is labelled milliseconds, but the integers are **Unix seconds** (`1770727161` → 2026-02-10 12:39 UTC, matching the folder date). Read as ms, every match would last under 1 second. | Treated as seconds and converted to **seconds since match start**, so every match plays back from 0:00. Median match is about 6 min, and position pings come every 5 s. |
| Minimaps are 4320², 2160×2158 and 9000² pixels, not the documented 1024² | Resized all to a 2048² JPG and drawn into the 1024 coordinate space. The UV maths is resolution-independent. |
| 17 files have numeric (bot-style) IDs but emit only human events (`Position`, `Loot`); 587 rows come from user `1429` | Classified by **behaviour first** (`BotPosition` → bot, `Position` → human), then by ID. With the ID rule alone, 16 matches would have **zero humans**. With the behaviour rule, every match has a human. |
| 210 exact-duplicate position pings, plus ~2.3k duplicate `Loot` rows | Dropped the duplicate pings (no information). Kept duplicate loot, since several items picked up in the same second is plausible. |
| Every event is logged at the **owner's** position. In a bot's file, `BotKilled` means *the bot died* (always its last event, and it stops moving). | Markers are drawn at the logger's position. The tooltip wording depends on who logged it ("Player killed a bot" vs "Bot was killed"). Bot-logged markers are faded. |
| One match spans two date folders (it started at 23:51) | The match's date is the folder of its earliest row. |
| Feb 14 is a partial day | Labelled "(partial day)" in the date filter. |

## Trade-offs

| Considered | Decided | Why |
|---|---|---|
| Streamlit vs React | React + Canvas | Smooth playback and zoom/pan, and a UI built for level designers rather than a notebook look. Costs a bit more code. |
| Backend + DB (DuckDB/Postgres) vs static JSON | Static JSON | The data never changes, and 1.7 MB total fits in the browser. A server would add hosting, cost and failure modes for no benefit. Would revisit at ~100× the data. |
| JSON per match vs per map | Per map | Instant cross-match heatmaps and filters with no extra requests. Ambrose Valley is 1.2 MB (~250 KB gzipped). |
| Precomputed vs client-side heatmaps | Client-side | Heatmaps respond to every filter (date, humans/bots, playback time) at negligible cost (≤60k points). |
| Leaflet/Mapbox vs plain canvas | Plain canvas | No geographic projection needed. One affine transform is easier to reason about and to explain. |
| Timeline in aggregate view | "Seconds since match start" across all matches | Lets a designer ask "where is everyone at minute 3?" across hundreds of matches with the same control used for single-match playback. |
