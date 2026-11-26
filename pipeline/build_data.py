"""
Build step: raw LILA BLACK parquet telemetry -> small static JSON files for the web app.

    python pipeline/build_data.py            (reads data/player_data, writes web/public/data)

Everything heavy (parsing, decoding, bot detection, coordinate mapping, timestamp
normalisation) happens here, once. The browser only loads the finished JSON.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "player_data"
OUT_DIR = ROOT / "web" / "public" / "data"
MINIMAP_OUT = ROOT / "web" / "public" / "minimaps"

# --- Map configuration (from the dataset README) -----------------------------------
MAP_SIZE = 1024  # all pixel coordinates are expressed in a 1024 x 1024 minimap space
MAPS = {
    "AmbroseValley": {"scale": 900, "origin_x": -370, "origin_z": -473, "image": "AmbroseValley_Minimap.png"},
    "GrandRift": {"scale": 581, "origin_x": -290, "origin_z": -290, "image": "GrandRift_Minimap.png"},
    "Lockdown": {"scale": 1000, "origin_x": -500, "origin_z": -500, "image": "Lockdown_Minimap.jpg"},
}
MINIMAP_EXPORT_PX = 2048  # exported image resolution (crisp when zoomed); drawn into 1024 space

# Raw event name -> category shown in the UI. Events are always logged at the position
# of the file's owner, from the owner's point of view.
EVENT_CATEGORY = {
    "Kill": "kill",          # human killed a human
    "BotKill": "kill",       # owner killed a bot (or, in a bot's file, the bot killed someone)
    "Killed": "death",       # human killed by a human
    "BotKilled": "death",    # human killed by a bot (or, in a bot's file, the bot died)
    "KilledByStorm": "storm",
    "Loot": "loot",
}
POSITION_EVENTS = {"Position", "BotPosition"}

NUMERIC_ID = re.compile(r"^\d+$")


def world_to_pixel(x: pd.Series, z: pd.Series, map_id: str) -> tuple[pd.Series, pd.Series]:
    """World (x, z) -> minimap pixel (px, py) in a 1024x1024 image. `y` is elevation and is ignored."""
    cfg = MAPS[map_id]
    u = (x - cfg["origin_x"]) / cfg["scale"]
    v = (z - cfg["origin_z"]) / cfg["scale"]
    return u * MAP_SIZE, (1 - v) * MAP_SIZE  # image Y axis points down, so flip v


def load_raw() -> pd.DataFrame:
    frames = []
    skipped = []
    for day_dir in sorted(p for p in RAW_DIR.iterdir() if p.is_dir() and p.name.startswith("February")):
        for f in day_dir.iterdir():
            if f.name.startswith("."):
                continue
            try:
                df = pq.read_table(f).to_pandas()
            except Exception as exc:  # corrupt / non-parquet file: skip but report
                skipped.append(f"{f.name}: {exc}")
                continue
            df["day"] = day_dir.name
            df["file"] = f.name
            frames.append(df)
    if skipped:
        print(f"Skipped {len(skipped)} unreadable files", file=sys.stderr)
    return pd.concat(frames, ignore_index=True)


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    notes: dict = {"raw_rows": len(df)}

    # 1. `event` is stored as bytes.
    df["event"] = df["event"].map(lambda b: b.decode("utf-8") if isinstance(b, (bytes, bytearray)) else str(b))

    # 2. `ts` is labelled milliseconds but the integer is actually Unix *seconds*
    #    (1_770_727_161 -> 2026-02-10 12:39 UTC, matching the folder dates).
    df["t_abs"] = df["ts"].astype("int64")
    df = df.drop(columns=["ts"])

    # 3. Exact duplicate Position pings carry no information -> drop. Duplicate Loot rows
    #    are kept: several items picked up in the same second at the same spot is plausible.
    pos = df["event"].isin(POSITION_EVENTS)
    dup = df.duplicated(["file", "t_abs", "event", "x", "y", "z"])
    notes["dropped_duplicate_positions"] = int((pos & dup).sum())
    df = df[~(pos & dup)]

    # 4. Bot detection. README rule: numeric user_id = bot. A handful of numeric-ID files emit
    #    only human events (Position/Loot), so behaviour decides; the ID is the fallback.
    events_per_file = df.groupby("file")["event"].agg(set)
    numeric = df.groupby("file")["user_id"].first().str.match(NUMERIC_ID)

    def file_is_bot(f: str) -> bool:
        evs = events_per_file[f]
        if "BotPosition" in evs:
            return True
        if "Position" in evs:
            return False
        return bool(numeric[f])

    is_bot = {f: file_is_bot(f) for f in events_per_file.index}
    df["is_bot"] = df["file"].map(is_bot)
    notes["numeric_id_files_treated_as_human"] = int(sum(1 for f in is_bot if numeric[f] and not is_bot[f]))

    # 5. Coordinates -> minimap pixels, per map. Count anything outside the image.
    df["px"] = 0.0
    df["py"] = 0.0
    for map_id in MAPS:
        m = df["map_id"] == map_id
        df.loc[m, "px"], df.loc[m, "py"] = world_to_pixel(df.loc[m, "x"], df.loc[m, "z"], map_id)
    oob = (df.px < 0) | (df.px > MAP_SIZE) | (df.py < 0) | (df.py > MAP_SIZE) | df.px.isna()
    notes["out_of_bounds_rows"] = int(oob.sum())
    df = df[~oob]

    # 6. Time relative to match start (seconds) so every match plays back from 0:00.
    start = df.groupby("match_id")["t_abs"].transform("min")
    df["t"] = (df["t_abs"] - start).astype(int)

    # 7. One match can straddle midnight across two folders -> the match's date is the
    #    folder of its earliest row.
    first_day = df.sort_values("t_abs").groupby("match_id")["day"].first()
    df["date"] = df["match_id"].map(first_day)

    notes["clean_rows"] = len(df)
    return df, notes


def build_outputs(df: pd.DataFrame) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    matches_meta = []
    per_map: dict[str, list] = {m: [] for m in MAPS}

    for match_id, g in df.sort_values("t_abs").groupby("match_id", sort=False):
        map_id = g["map_id"].iloc[0]
        players = []
        events = []
        for pi, (user_id, pg) in enumerate(g.groupby("user_id", sort=False)):
            bot = bool(pg["is_bot"].iloc[0])
            p = pg[pg["event"].isin(POSITION_EVENTS)]
            # flat [t, px, py, t, px, py, ...] keeps the JSON compact
            path = [v for row in zip(p["t"], p["px"].round(1), p["py"].round(1)) for v in row]
            players.append({"id": user_id, "bot": bot, "path": path})
            for row in pg[~pg["event"].isin(POSITION_EVENTS)].itertuples():
                events.append([int(row.t), row.event, round(row.px, 1), round(row.py, 1), pi])
        events.sort(key=lambda e: e[0])

        cats = pd.Series([EVENT_CATEGORY.get(e[1], "other") for e in events], dtype="object")
        meta = {
            "id": match_id,
            "map": map_id,
            "date": g["date"].iloc[0],
            "start": int(g["t_abs"].min()),
            "duration": int(g["t"].max()),
            "humans": int((~g.drop_duplicates("user_id")["is_bot"]).sum()),
            "bots": int(g.drop_duplicates("user_id")["is_bot"].sum()),
            "kills": int((cats == "kill").sum()),
            "deaths": int((cats == "death").sum()),
            "storm": int((cats == "storm").sum()),
            "loot": int((cats == "loot").sum()),
        }
        matches_meta.append(meta)
        per_map[map_id].append({"id": match_id, "players": players, "events": events})

    for map_id, matches in per_map.items():
        (OUT_DIR / f"{map_id}.json").write_text(json.dumps({"map": map_id, "matches": matches}, separators=(",", ":")))

    index = {
        "mapSize": MAP_SIZE,
        "maps": [
            {"id": m, "scale": c["scale"], "originX": c["origin_x"], "originZ": c["origin_z"], "image": f"minimaps/{m}.jpg"}
            for m, c in MAPS.items()
        ],
        "dates": sorted(df["date"].unique().tolist(), key=lambda d: int(d.split("_")[1])),
        "eventCategories": EVENT_CATEGORY,
        "matches": sorted(matches_meta, key=lambda m: m["start"]),
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    return index


def export_minimaps() -> None:
    """Source minimaps are 4320², 2160x2158 and 9000² (not 1024 as documented) -> resize all to one square size."""
    MINIMAP_OUT.mkdir(parents=True, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = None
    for map_id, cfg in MAPS.items():
        out = MINIMAP_OUT / f"{map_id}.jpg"
        if out.exists():
            continue
        img = Image.open(RAW_DIR / "minimaps" / cfg["image"]).convert("RGB")
        img.resize((MINIMAP_EXPORT_PX, MINIMAP_EXPORT_PX), Image.LANCZOS).save(out, quality=85, optimize=True)


def main() -> None:
    raw = load_raw()
    df, notes = clean(raw)
    index = build_outputs(df)
    export_minimaps()

    print("== Build summary ==")
    for k, v in notes.items():
        print(f"{k:40s} {v}")
    print(f"{'matches':40s} {len(index['matches'])}")
    print(f"{'dates':40s} {index['dates']}")
    print(df.groupby(["map_id"])["match_id"].nunique().to_string())


if __name__ == "__main__":
    main()
