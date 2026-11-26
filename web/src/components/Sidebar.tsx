import type { Category, DataIndex, Filters, HeatmapKind, MatchMeta } from "../lib/types";
import { CATEGORIES } from "../lib/types";
import { CATEGORY_LABELS, MAP_LABELS, clock, dateLabel, matchLabel } from "../lib/format";
import { COLORS } from "../lib/style";
import { HEAT_GRADIENT_CSS } from "../lib/heatmap";
import MarkerIcon from "./MarkerIcon";
import { IconBack, IconClose } from "./Icons";


interface Props {
  index: DataIndex;
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  matches: MatchMeta[]; // matches available for the current map + date
  counts: Record<Category, number> & { humans: number; bots: number };
  open: boolean; // mobile drawer state
  onClose: () => void;
}

const HEATMAPS: Array<{ id: HeatmapKind; label: string }> = [
  { id: "off", label: "Off" },
  { id: "traffic", label: "Traffic" },
  { id: "kill", label: "Kills" },
  { id: "death", label: "Deaths" },
  { id: "storm", label: "Storm" },
  { id: "loot", label: "Loot" },
];

export default function Sidebar({ index, filters, onChange, matches, counts, open, onClose }: Props) {
  const matchCount = (m: string) => index.matches.filter((x) => x.map === m && (filters.date === "all" || x.date === filters.date)).length;
  const selected = filters.matchId !== "all" ? index.matches.find((m) => m.id === filters.matchId) : undefined;

  return (
    <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Filters">
      <header className="brand">
        <BrandMark />
        <div>
          <div className="brand-title">LILA BLACK</div>
          <div className="brand-sub">Player Journey Explorer</div>
        </div>
        <button className="icon-btn ghost drawer-close" onClick={onClose} aria-label="Close filters">
          <IconClose />
        </button>
      </header>

      <section data-tour="maps">
        <h3>Map</h3>
        <div className="map-list" role="radiogroup" aria-label="Map">
          {index.maps.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={filters.mapId === m.id}
              className={`map-row ${filters.mapId === m.id ? "on" : ""}`}
              onClick={() => onChange({ mapId: m.id, matchId: "all" })}
            >
              <img className="map-thumb" src={`/${m.image.replace(/\.jpg$/, "_thumb.jpg")}`} alt="" width={36} height={36} />
              <span className="map-text">
                <span className="map-name">{MAP_LABELS[m.id] ?? m.id}</span>
                <span className="map-meta">{matchCount(m.id)} matches</span>
              </span>
              <span className="radio" aria-hidden />
            </button>
          ))}
        </div>
      </section>

      <section data-tour="date">
        <h3>Date</h3>
        <div className="select">
          <select value={filters.date} onChange={(e) => onChange({ date: e.target.value, matchId: "all" })}>
            <option value="all">All dates · Feb 10–14</option>
            {index.dates.map((d) => (
              <option key={d} value={d}>
                {dateLabel(d)}
                {d === "February_14" ? " (partial day)" : ""}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section data-tour="match">
        <h3>
          Match <span className="h-meta">{matches.length} available</span>
        </h3>
        <div className="select">
          <select value={filters.matchId} onChange={(e) => onChange({ matchId: e.target.value })}>
            <option value="all">All matches (overview)</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {matchLabel(m)}
              </option>
            ))}
          </select>
        </div>
        {selected && (
          <div className="match-card">
            <div className="match-card-head">
              <span>
                {dateLabel(selected.date)} · {new Date(selected.start * 1000).toISOString().slice(11, 16)} UTC
              </span>
              <code title={selected.id}>{selected.id.slice(0, 8)}</code>
            </div>
            <div className="match-stats">
              <Stat label="Length" value={clock(selected.duration)} />
              <Stat label="Humans" value={selected.humans} />
              <Stat label="Bots" value={selected.bots} />
              <Stat label="All kills" value={selected.kills} />
              <Stat label="All deaths" value={selected.deaths + selected.storm} />
              <Stat label="Loot" value={selected.loot} />
            </div>
            <button className="btn block" onClick={() => onChange({ matchId: "all" })}>
              <IconBack size={14} /> Back to overview
            </button>
          </div>
        )}
      </section>

      <section data-tour="players">
        <h3>Players</h3>
        <ToggleRow checked={filters.humans} onChange={(v) => onChange({ humans: v })} count={counts.humans}
          icon={<span className="swatch" style={{ background: COLORS.human }} />} label="Humans" />
        <ToggleRow checked={filters.bots} onChange={(v) => onChange({ bots: v })} count={counts.bots}
          icon={<span className="swatch dashed" style={{ color: COLORS.bot }} />} label="Bots" />
        <ToggleRow checked={filters.paths} onChange={(v) => onChange({ paths: v })}
          icon={<span className="swatch path" />} label="Movement paths" />
      </section>

      <section data-tour="events">
        <h3>Events</h3>
        {CATEGORIES.map((c) => (
          <ToggleRow key={c} checked={filters.cats[c]} onChange={(v) => onChange({ cats: { ...filters.cats, [c]: v } })}
            icon={<MarkerIcon cat={c} />} label={CATEGORY_LABELS[c]} count={counts[c]} />
        ))}
        <p className="note">Faded markers were logged by bots.</p>
      </section>

      <section data-tour="heatmap">
        <h3>Heatmap</h3>
        <div className="heat-grid" role="group" aria-label="Heatmap">
          {HEATMAPS.map((h) => (
            <button key={h.id} className={filters.heatmap === h.id ? "on" : ""} aria-pressed={filters.heatmap === h.id} onClick={() => onChange({ heatmap: h.id })}>
              {h.label}
            </button>
          ))}
        </div>
        {filters.heatmap !== "off" && (
          <div className="heat-legend">
            <span>Low</span>
            <div className="heat-bar" style={{ background: HEAT_GRADIENT_CSS }} />
            <span>High</span>
          </div>
        )}
        <p className="note">Heatmaps follow every filter above, including the timeline.</p>
      </section>

      <footer className="side-foot">
        Feb 10–14, 2026 · {index.matches.length} matches · 3 maps
      </footer>
    </aside>
  );
}

/** Scope reticle: the tool is about looking closely at places on a map. */
function BrandMark() {
  return (
    <svg className="brand-mark" width="30" height="30" viewBox="0 0 30 30" aria-hidden>
      <rect x="0.5" y="0.5" width="29" height="29" rx="8" fill="var(--accent)" />
      <circle cx="15" cy="15" r="7.5" fill="none" stroke="var(--accent-ink)" strokeWidth="2" />
      <path d="M15 4.5v5M15 20.5v5M4.5 15h5M20.5 15h5" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="15" cy="15" r="1.8" fill="var(--accent-ink)" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-v">{value}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

function ToggleRow(props: { checked: boolean; onChange: (v: boolean) => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <label className={`toggle-row ${props.checked ? "" : "off"}`}>
      <span className="tr-icon">{props.icon}</span>
      <span className="tr-label">{props.label}</span>
      {props.count !== undefined && <span className="pill">{props.count.toLocaleString()}</span>}
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}
