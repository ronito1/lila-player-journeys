# Three things I learned about LILA BLACK using the tool

All numbers come from the full Feb 10–14 dataset (796 matches, 798 human runs). You can reproduce each one in the tool with the filters named under **How to see it**.

---

## 1. Bots, not players, are the real opponent: combat is a PvE experience

**What caught my eye.** In the aggregate Kills view on any map, almost every ✕ marker is a *bot* kill. PvP barely exists.

**The evidence**
- Humans killed **2,245 bots** but only **3 humans** across five days.
- Of 446 human deaths: **90.6% to bots** (404), **8.7% to the storm** (39), **0.7% to other players** (3).
- 794 of 796 matches contain exactly **one** human journey in this dataset.
- **55%** of human runs on Ambrose Valley end in death, almost all from bots.

**Actionable?** Yes. The kill/death heatmaps are effectively a map of **bot placement**, so bot density and spawn positions are the main lever for encounter design.
- *Actions:* tune bot density in the top death cells, such as the central river-crossing compound on Ambrose Valley and the building cluster just west of it (Deaths heatmap). Add cover or alternate entries where human deaths cluster. If PvP tension is a design goal, matchmaking and lobby size need attention before map layout does.
- *Metrics affected:* deaths per run, bot kills per run (≈3), extraction/survival rate, time to first engagement.

**Why a level designer should care.** Encounter difficulty is currently set by where bots stand, not by how players meet each other. Sightlines, cover and chokepoints should be judged against bot behaviour first.

**How to see it:** any map → Heatmap *Deaths*, then untick *Bots*. Compare the *Kills* count (top bar) with the Humans/Bots toggles.

---

## 2. The storm kills 3× more often on Lockdown and Grand Rift than on Ambrose Valley

**What caught my eye.** Storm-death markers (▲) are rare on Ambrose Valley but show up repeatedly on the two smaller maps.

**The evidence**

| Map | Human runs | Storm deaths | Storm deaths per run | Median match length |
|---|---|---|---|---|
| Ambrose Valley | 568 | 17 | **3.0%** | 6:02 |
| Grand Rift | 59 | 5 | **8.5%** | 7:02 |
| Lockdown | 171 | 17 | **9.9%** | 7:28 |

- Storm deaths happen **late and in a tight window**: earliest at 10:55, with the median between 11:56 and 12:41 into the match on every map.
- On Lockdown they are **spread across the whole map** (x from 151 to 836 px), not clustered on one edge. That points to a timing or extraction-readability problem, not one bad route.

**Actionable?** Yes.
- *Actions:* on Lockdown and Grand Rift, add or move an extraction point toward the areas where runs are still alive at 10–11 minutes. Make extraction routes readable (landmarks, signage). Consider an earlier storm warning on the smaller maps.
- *Metrics affected:* storm deaths per run (target: Ambrose's 3%), extraction rate, average match length, frustration-driven churn (a storm death loses the whole run's loot).

**Why a level designer should care.** A storm death usually means the map didn't show the player the way out in time. That makes it a layout and readability problem, not a skill problem.

**How to see it:** Lockdown → Heatmap *Storm*, or tick only *Storm deaths*. Drag the timeline to about 11:00 and watch them appear.

---

## 3. Grand Rift's Mine Pit is the map's centre of gravity, and Gas Station and Maintenance Bay are nearly ignored

**What caught my eye.** Grand Rift's Deaths and Loot heatmaps both light up one place: the Mine Pit in the middle of the map.

**The evidence** (human runs, 59 matches; *visited* = path came within ~90 px of the named location)

| Named location | Matches visiting | Share of traffic | Loot pickups | Human deaths |
|---|---|---|---|---|
| **Mine Pit** | **61%** | **14.5%** | **189 (21% of all)** | **11 of 25 (44%)** |
| Cave House | 48% | 7.6% | 54 | 4 |
| Labour Quarters | 42% | 9.2% | 49 | 0 |
| Engineer's Quarters | 34% | 9.5% | 84 | 0 |
| Burnt Zone | 32% | 6.4% | 54 | 0 |
| Gas Station | 29% | 3.3% | 31 | 0 |
| Maintenance Bay | 22% | 3.7% | 39 | 0 |

**Actionable?** Yes. The caveat is sample size: Grand Rift has only 59 matches, so this is a strong signal to monitor rather than a final verdict.
- *Actions:* move some high-value loot out of the Mine Pit to Gas Station and Maintenance Bay to spread players out. Add a second route out of the pit, because deaths cluster at its north and south ends. Give the edge locations a reason to visit (an objective or extraction point).
- *Metrics affected:* share of traffic per location (aim for a flatter distribution), deaths per location, loot per run, match length.

**Why a level designer should care.** When one location pulls in 44% of deaths and 21% of loot, the rest of the map is decoration. Wasted art and layout budget, and repetitive matches.

**How to see it:** Grand Rift → Heatmap *Deaths*, then *Loot*, then *Traffic*.
