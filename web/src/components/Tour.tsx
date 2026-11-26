import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconClose } from "./Icons";

export interface TourStep {
  target: string; // value of a data-tour="…" attribute
  title: string;
  body: string;
  inSidebar?: boolean; // on mobile the sidebar drawer must be open for this step
}

export const TOUR_STEPS: TourStep[] = [
  { target: "questions", title: "Start with a question", body: "Each button sets the map up to answer one question a level designer asks, like where players die or where the storm catches them. If you're new, start here." },
  { target: "insight", title: "Read the explanation", body: "This panel says in plain words what the map is showing, lists the top hotspots (numbered on the map; click one to zoom in) and suggests what to look at next. For a single match it tells that match's story." },
  { target: "canvas", title: "The map", body: "Hover a marker for details. In the overview, click a marker to open the match it came from. Scroll or pinch to zoom, drag to pan." },
  { target: "timeline", title: "Timeline & playback", body: "Press play to watch a match unfold, or drag to scrub. Ticks mark fights. In the overview every match is lined up from its own start, so you can ask “where is everyone at minute 3?”." },
  { target: "maps", inSidebar: true, title: "Pick a map", body: "Switch between the three maps. The number on each is how many matches were recorded on it." },
  { target: "date", inSidebar: true, title: "Filter by day", body: "Look at one day of play, or all five together. Feb 14 is a partial day." },
  { target: "match", inSidebar: true, title: "Pick a specific match", body: "“All matches” overlays everything. Choose one match to replay it with its story." },
  { target: "players", inSidebar: true, title: "Humans vs bots", body: "Humans are solid green paths, bots are dashed blue. Toggle either one, or hide paths to see only the events." },
  { target: "events", inSidebar: true, title: "Event markers", body: "Each event type has its own shape: ✕ kill, ● death, ▲ storm death, ◆ loot pickup. Counts update with every filter." },
  { target: "heatmap", inSidebar: true, title: "Heatmaps", body: "Build your own heatmap of traffic, kills, deaths, storm deaths or loot. Brighter means more." },
  { target: "zoom", title: "Zoom controls", body: "Zoom in and out, or fit the whole map back on screen. Keyboard shortcuts: + − 0." },
  { target: "actions", title: "Share, theme & help", body: "The link always matches what you see, so copy it to share a view. Switch light or dark mode here, and reopen this guide at any time." },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onStep: (step: TourStep) => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const CARD_W = 320;

/** Guided tour: dims the page, spotlights one element at a time and explains it. */
export default function Tour({ open, onClose, onStep }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);
  const step = TOUR_STEPS[i];

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    onStep(step);
    // bring the target into view (sidebar sections may be scrolled away)
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, i]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the target every frame: follows scrolling, resizing and the mobile drawer animation.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, step.target]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [i, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  const next = () => (i === TOUR_STEPS.length - 1 ? onClose() : setI(i + 1));
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw < 700;

  // Card placement: right of the target, else left, else below, else above. Always clamped on screen.
  let cardStyle: React.CSSProperties;
  if (mobile || !rect) {
    // dock to whichever screen edge is away from the highlighted element
    const targetLow = rect ? rect.top + rect.height / 2 > vh / 2 && rect.height < vh * 0.6 : false;
    cardStyle = targetLow ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
  } else {
    const gap = 14;
    let left: number;
    let top: number;
    if (rect.left + rect.width + gap + CARD_W < vw - 12) {
      left = rect.left + rect.width + gap;
      top = rect.top;
    } else if (rect.left - gap - CARD_W > 12) {
      left = rect.left - gap - CARD_W;
      top = rect.top;
    } else if (rect.top + rect.height + gap + cardH < vh - 12) {
      left = rect.left + rect.width / 2 - CARD_W / 2;
      top = rect.top + rect.height + gap;
    } else {
      left = rect.left + rect.width / 2 - CARD_W / 2;
      top = rect.top - gap - cardH;
    }
    left = Math.min(Math.max(12, left), vw - CARD_W - 12);
    top = Math.min(Math.max(12, top), vh - cardH - 12);
    cardStyle = { left, top, width: CARD_W };
  }

  // Spotlight = target + padding, clamped inside the window so full-width targets
  // (question bar, timeline, map) never draw past the screen edge.
  const EDGE = 3;
  const spot = rect && (() => {
    const l = Math.max(EDGE, rect.left - PAD);
    const t = Math.max(EDGE, rect.top - PAD);
    const r = Math.min(vw - EDGE, rect.left + rect.width + PAD);
    const b = Math.min(vh - EDGE, rect.top + rect.height + PAD);
    return { left: l, top: t, width: Math.max(0, r - l), height: Math.max(0, b - t) };
  })();

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div className="tour-catcher" onClick={onClose} />
      {spot && (
        <div className="tour-spot" style={spot} />
      )}
      <div className="tour-card" ref={cardRef} style={cardStyle}>
        <div className="tour-head">
          <span className="tour-count">
            {i + 1} / {TOUR_STEPS.length}
          </span>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close tour">
            <IconClose size={14} />
          </button>
        </div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="tour-dots">
          {TOUR_STEPS.map((_, k) => (
            <button key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Step ${k + 1}`} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="btn ghost" onClick={onClose}>
            Skip
          </button>
          <div style={{ flex: 1 }} />
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn primary" onClick={next}>
            {i === TOUR_STEPS.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small first-visit card in the top-right corner that offers the tour. */
export function WelcomeCard({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="welcome" role="status">
      <div className="welcome-title">New here?</div>
      <p>Take a one-minute tour of what each part of the explorer does.</p>
      <div className="welcome-actions">
        <button className="btn ghost" onClick={onDismiss}>
          Not now
        </button>
        <button className="btn primary" onClick={onStart}>
          Start tour
        </button>
      </div>
    </div>
  );
}
