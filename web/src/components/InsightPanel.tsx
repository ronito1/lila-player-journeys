import { useEffect, useRef, useState } from "react";
import type { Hotspot, MatchStory, Moment } from "../lib/insights";
import { gridRef, pct } from "../lib/insights";
import { clock } from "../lib/format";
import MarkerIcon from "./MarkerIcon";

interface Props {
  title: string;
  seeing: string;
  facts: string[];
  hotspots: Hotspot[];
  hotspotNoun: string;
  next: string;
  story: MatchStory | null;
  time: number;
  onFocus: (x: number, y: number, zoom: number) => void;
  onSeek: (m: Moment) => void;
}

/** Floating "what am I looking at?" panel that explains the current view in plain words. */
export default function InsightPanel(p: Props) {
  const [open, setOpen] = useState(() => window.innerWidth > 640);
  const listRef = useRef<HTMLOListElement>(null);

  // On phones the panel covers part of the map: tuck it away as soon as the user touches the map.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (window.innerWidth > 640) return;
      if ((e.target as HTMLElement).closest?.(".map-wrap canvas, .zoom-ctrl")) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // keep the current moment of a playing match in view
  const current = p.story ? p.story.moments.filter((m) => m.t <= p.time).length - 1 : -1;
  useEffect(() => {
    // scroll only the moments list (never the panel), so the match summary stays in view
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-i="${current}"]`);
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: top - list.clientHeight / 2, behavior: "smooth" });
    }
  }, [current]);

  return (
    <section className={`insight ${open ? "" : "collapsed"}`} data-tour="insight" aria-label="Explanation of the current view">
      <button className="insight-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="insight-kicker">{p.story ? "Match story" : "What am I looking at?"}</span>
        <span className="insight-title">{p.title}</span>
        <span className="chev" aria-hidden>{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="insight-body">
          {p.story ? (
            <>
              <p className="lead">{p.story.summary}</p>
              <h5>Key moments <span className="h5-meta">click to jump there</span></h5>
              {p.story.moments.length ? (
                <ol className="moments" ref={listRef}>
                  {p.story.moments.map((m, i) => (
                    <li key={i} data-i={i} className={i === current ? "now" : m.t > p.time ? "future" : ""}>
                      <button onClick={() => p.onSeek(m)}>
                        <span className="m-time">{clock(m.t)}</span>
                        <MarkerIcon cat={m.ev.cat} />
                        <span className="m-text">
                          {m.text}
                          <span className="m-place">{m.place}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted-p">No combat in this match. Turn on Loot pickups to see what the player collected.</p>
              )}
              {p.story.lootCount > 0 && <p className="muted-p">+ {p.story.lootCount} loot pickups (toggle “Loot pickups” to show them).</p>}
              <p className="next">Press ▶ to watch it unfold. Green is the player, dashed blue are bots, and a dot shows where each one is right now.</p>
            </>
          ) : (
            <>
              <p className="lead">{p.seeing}</p>
              {p.facts.length > 0 && (
                <ul className="facts">
                  {p.facts.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
              {p.hotspots.length > 0 && (
                <>
                  <h5>Hotspots <span className="h5-meta">click to zoom in</span></h5>
                  <ol className="hotspots">
                    {p.hotspots.map((h, i) => (
                      <li key={i}>
                        <button onClick={() => p.onFocus(h.x, h.y, 3)}>
                          <span className="hs-badge">{i + 1}</span>
                          <span className="hs-body">
                            <span className="hs-line">
                              <span className="hs-place">{h.place}</span>
                              <span className="hs-ref" title="Grid square (see the rulers around the map)">{gridRef(h.x, h.y)}</span>
                              <b className="hs-pct">{pct(h.share)}</b>
                            </span>
                            <span className="hs-bar" aria-hidden>
                              <span style={{ width: `${Math.max(4, h.share * 100)}%` }} />
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="hs-caption">Percent {p.hotspotNoun}. Grid squares (e.g. H9) match the rulers around the map.</p>
                </>
              )}
              {p.next && <p className="next">{p.next}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
