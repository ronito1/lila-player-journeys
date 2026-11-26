"""
Tests for the data pipeline:  python -m unittest discover pipeline

Covers the things the assignment calls out: coordinate mapping, bytes decoding, timestamps,
bot detection and data edge cases. The last test checks the real generated output end to end.
"""

import json
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from build_data import MAP_SIZE, MAPS, OUT_DIR, clean, world_to_pixel  # noqa: E402


def raw_rows(rows):
    """Build a DataFrame shaped like the raw parquet files (ts stored as 'ms', event as bytes)."""
    df = pd.DataFrame(rows, columns=["user_id", "match_id", "map_id", "x", "y", "z", "ts", "event", "day", "file"])
    df["ts"] = pd.to_datetime(df["ts"], unit="ms")  # how pyarrow hands the column over
    df["event"] = df["event"].map(lambda s: s.encode("utf-8"))
    return df


HUMAN = "f4e072fa-b7af-4761-b567-1d95b7ad0108"
MATCH = "b71aaad8-aa62-4b3a-8534-927d4de18f22.nakama-0"


class CoordinateMapping(unittest.TestCase):
    def test_readme_worked_example(self):
        # README: AmbroseValley, x=-301.45, z=-355.55  ->  pixel (78, 890)
        px, py = world_to_pixel(pd.Series([-301.45]), pd.Series([-355.55]), "AmbroseValley")
        self.assertEqual(round(px[0]), 78)
        self.assertEqual(round(py[0]), 890)

    def test_image_y_axis_is_flipped(self):
        cfg = MAPS["Lockdown"]
        # the world's minimum z is the bottom of the image, the maximum z is the top
        _, bottom = world_to_pixel(pd.Series([0.0]), pd.Series([float(cfg["origin_z"])]), "Lockdown")
        _, top = world_to_pixel(pd.Series([0.0]), pd.Series([float(cfg["origin_z"] + cfg["scale"])]), "Lockdown")
        self.assertAlmostEqual(bottom[0], MAP_SIZE)
        self.assertAlmostEqual(top[0], 0)

    def test_every_map_has_a_config(self):
        self.assertEqual(set(MAPS), {"AmbroseValley", "GrandRift", "Lockdown"})


class Cleaning(unittest.TestCase):
    def setUp(self):
        t0 = 1_770_727_161  # Unix seconds (stored in a column labelled milliseconds)
        self.df, self.notes = clean(raw_rows([
            [HUMAN, MATCH, "AmbroseValley", -301.45, 124.9, -355.55, t0, "Position", "February_10", "h"],
            [HUMAN, MATCH, "AmbroseValley", -301.45, 124.9, -355.55, t0, "Position", "February_10", "h"],  # exact dup ping
            [HUMAN, MATCH, "AmbroseValley", -300.00, 124.9, -350.00, t0 + 5, "Loot", "February_10", "h"],
            [HUMAN, MATCH, "AmbroseValley", -300.00, 124.9, -350.00, t0 + 5, "Loot", "February_10", "h"],  # 2 items, same second
            ["1440", MATCH, "AmbroseValley", -280.85, 121.6, -323.35, t0 + 10, "BotPosition", "February_10", "b"],
            ["1429", MATCH, "AmbroseValley", -290.00, 121.6, -330.00, t0 + 20, "Position", "February_11", "n"],  # numeric id, human events
        ]))

    def test_event_bytes_are_decoded(self):
        self.assertTrue(all(isinstance(e, str) for e in self.df["event"]))
        self.assertNotIn("b'", "".join(self.df["event"]))

    def test_timestamps_are_seconds_from_match_start(self):
        self.assertEqual(sorted(self.df["t"].unique().tolist()), [0, 5, 10, 20])

    def test_duplicate_pings_dropped_but_duplicate_loot_kept(self):
        self.assertEqual((self.df["event"] == "Position").sum(), 2)  # 1 dup removed (+ the numeric-id player)
        self.assertEqual((self.df["event"] == "Loot").sum(), 2)
        self.assertEqual(self.notes["dropped_duplicate_positions"], 1)

    def test_bot_detection_uses_behaviour_then_id(self):
        is_bot = self.df.groupby("user_id")["is_bot"].first()
        self.assertFalse(is_bot[HUMAN])
        self.assertTrue(is_bot["1440"])   # numeric id + BotPosition -> bot
        self.assertFalse(is_bot["1429"])  # numeric id but human-only events -> human
        self.assertEqual(self.notes["numeric_id_files_treated_as_human"], 1)

    def test_match_date_is_the_earliest_folder(self):
        self.assertEqual(set(self.df["date"]), {"February_10"})


@unittest.skipUnless((OUT_DIR / "index.json").exists(), "run build_data.py first")
class GeneratedOutput(unittest.TestCase):
    """End-to-end checks on the real files the web app loads."""

    def test_every_point_lands_on_the_minimap(self):
        for map_id in MAPS:
            data = json.loads((OUT_DIR / f"{map_id}.json").read_text())
            for m in data["matches"]:
                for p in m["players"]:
                    path = p["path"]
                    xs, ys, ts = path[1::3], path[2::3], path[0::3]
                    self.assertTrue(all(0 <= v <= MAP_SIZE for v in xs + ys), f"{map_id} {m['id']}")
                    self.assertEqual(ts, sorted(ts), "path must be in time order")
                for t, name, x, y, _ in m["events"]:
                    self.assertTrue(0 <= x <= MAP_SIZE and 0 <= y <= MAP_SIZE)
                    self.assertGreaterEqual(t, 0)
                    self.assertFalse(name.startswith("b'"))

    def test_index_matches_the_dataset_readme(self):
        index = json.loads((OUT_DIR / "index.json").read_text())
        self.assertEqual(len(index["matches"]), 796)
        self.assertEqual(len(index["dates"]), 5)
        self.assertTrue(all(m["duration"] < 20 * 60 for m in index["matches"]), "a match should last minutes, not hours")


if __name__ == "__main__":
    unittest.main()
