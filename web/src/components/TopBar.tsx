import { useState } from "react";
import type { Category } from "../lib/types";
import type { Theme } from "../lib/theme";
import { IconHelp, IconLink, IconMenu, IconMoon, IconSun } from "./Icons";

interface Props {
  crumbs: [string, string, string]; // map / date / selection
  counts: Record<Category, number>;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenGuide: () => void;
  onOpenFilters: () => void; // phones: opens the sidebar drawer
}

const STAT_LABEL: Partial<Record<Category, string>> = { kill: "kills", death: "deaths", storm: "storm" };

export default function TopBar({ crumbs, counts, theme, onToggleTheme, onOpenGuide, onOpenFilters }: Props) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the address bar still holds the shareable link */
    }
  };

  return (
    <div className="topbar">
      <button className="icon-btn drawer-open" onClick={onOpenFilters} aria-label="Open filters">
        <IconMenu />
        <span>Filters</span>
      </button>
      <div className="crumbs">
        <span className="crumb">{crumbs[0]}</span>
        <span className="sep">/</span>
        <span className="crumb">{crumbs[1]}</span>
        <span className="sep">/</span>
        <span className="crumb strong">{crumbs[2]}</span>
      </div>
      <div className="stats">
        {(["kill", "death", "storm"] as const).map((c) => (
          <span key={c} className={`stat-chip ${c}`}>
            <b>{counts[c].toLocaleString()}</b> {STAT_LABEL[c]}
          </span>
        ))}
      </div>
      <div className="actions" data-tour="actions">
        <button className="icon-btn" onClick={copyLink} title="Copy a link to this exact view" aria-label="Copy link">
          <IconLink />
          <span className="btn-label">{copied ? "Copied!" : "Share"}</span>
        </button>
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle light or dark mode"
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button className="icon-btn" onClick={onOpenGuide} title="Guided tour" aria-label="Open guided tour">
          <IconHelp />
          <span className="btn-label">Guide</span>
        </button>
      </div>
    </div>
  );
}
