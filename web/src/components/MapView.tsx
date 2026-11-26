import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameEvent, Journey } from "../lib/types";
import type { Hotspot } from "../lib/insights";
import { COLORS, ACCENT, drawMarker } from "../lib/style";
import { GRID, gridCol, gridRow } from "../lib/insights";
import { clock, describeEvent } from "../lib/format";
import { IconExpand, IconFit, IconMinus, IconPlus, IconShrink } from "./Icons";

export interface FocusRequest {
  x: number;
  y: number;
  zoom: number;
  nonce: number; // bump to re-trigger the same target
}

interface Props {
  imageUrl: string;
  mapSize: number;
  journeys: Journey[];
  events: GameEvent[];
  showPaths: boolean;
  time: number;
  singleMatch: boolean;
  heat: HTMLCanvasElement | null;
  hotspots: Hotspot[];
  focus: FocusRequest | null;
  theme: "dark" | "light";
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenMatch: (matchId: string) => void;
}

interface View {
  zoom: number; // 1 = whole map fits the viewport
  cx: number; // map coordinate at the centre of the viewport
  cy: number;
}

interface Hover {
  ev: GameEvent;
  sx: number;
  sy: number;
  pinned: boolean; // touch: stays open and offers an "Open match" button
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const STEP = 1.6; // zoom factor for buttons / keys
const CACHE_PX = 2048; // resolution of the cached path layer
const CACHE_MIN_POINTS = 4000; // below this, paths are cheap enough to always draw live
const MARKER_ORDER = { loot: 0, death: 1, storm: 2, kill: 3 } as const; // combat drawn on top of loot
const RULER = 20; // grid-reference ruler along the top and left edges (screen px)

// Canvas colours per theme (the canvas cannot read CSS variables cheaply every frame).
const INK = {
  dark: { backdrop: "#0a0f11", grid: "rgba(231,238,234,0.06)", rulerBg: "rgba(16,23,26,0.94)", rulerLine: "#22303a", label: "#7f908d", tick: "#3a4a50", hot: ACCENT },
  light: { backdrop: "#dfe5e2", grid: "rgba(15,26,28,0.07)", rulerBg: "rgba(251,252,251,0.95)", rulerLine: "#cfd8d4", label: "#5d6b66", tick: "#b3bfba", hot: "#9a6206" },
};
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Rendering model: all drawing happens in one requestAnimationFrame callback that reads the latest
 * state from refs. Input events (wheel, drag, pinch) only update refs and request a frame, so a
 * burst of wheel events costs one draw, never a queue of draws.
 */
export default function MapView(props: Props) {
  const { imageUrl, mapSize, journeys, events, showPaths, time, singleMatch, heat, hotspots, focus, theme, fullscreen, onToggleFullscreen, onOpenMatch } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [imgReady, setImgReady] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(1);
  const [hover, setHoverState] = useState<Hover | null>(null);

  const fitView = useCallback((): View => ({ zoom: 1, cx: mapSize / 2, cy: mapSize / 2 }), [mapSize]);

  // ---- refs read by the draw loop -----------------------------------------------------
  const sorted = useMemo(() => [...events].sort((a, b) => MARKER_ORDER[a.cat] - MARKER_ORDER[b.cat]), [events]);
  const totalPoints = useMemo(() => journeys.reduce((n, j) => n + j.path.length / 3, 0), [journeys]);
  const live = useRef({ ...props, sorted, totalPoints });
  live.current = { ...props, sorted, totalPoints };
  const viewRef = useRef<View>(fitView());
  const sizeRef = useRef(size);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const raf = useRef(0);
  const anim = useRef(0);
  const interacting = useRef(false);
  const idleTimer = useRef(0);
  const pathCache = useRef<{ canvas: HTMLCanvasElement; version: number } | null>(null);
  const pathVersion = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; pinchDist?: number; mid?: { x: number; y: number } }>({ moved: false });

  // The map fits the area beside the rulers; `centre` is that area's middle on screen.
  const baseScale = () => Math.min(sizeRef.current.w - RULER, sizeRef.current.h - RULER) / mapSize;
  const scaleNow = () => baseScale() * viewRef.current.zoom;
  const centre = () => ({ ox: RULER + (sizeRef.current.w - RULER) / 2, oy: RULER + (sizeRef.current.h - RULER) / 2 });
  const toScreen = (x: number, y: number): [number, number] => {
    const s = scaleNow();
    const { ox, oy } = centre();
    return [(x - viewRef.current.cx) * s + ox, (y - viewRef.current.cy) * s + oy];
  };

  // ---- drawing ------------------------------------------------------------------------
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const L = live.current;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const view = viewRef.current;
    const scale = scaleNow();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = INK[L.theme];
    const { ox, oy } = centre();
    ctx.fillStyle = ink.backdrop;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(-view.cx, -view.cy);
    if (imgRef.current) {
      ctx.drawImage(imgRef.current, 0, 0, L.mapSize, L.mapSize);
      // faint reference grid: the same 16×16 cells the hotspots are counted in
      const cell = L.mapSize / GRID;
      ctx.beginPath();
      for (let i = 1; i < GRID; i++) {
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, L.mapSize);
        ctx.moveTo(0, i * cell);
        ctx.lineTo(L.mapSize, i * cell);
      }
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = ink.grid;
      ctx.stroke();
    }
    if (L.heat) {
      ctx.globalAlpha = 0.85;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(L.heat, 0, 0, L.mapSize, L.mapSize);
      ctx.globalAlpha = 1;
    }
    if (L.showPaths) {
      const heavy = !L.singleMatch && L.totalPoints > CACHE_MIN_POINTS;
      // Heavy overview: draw from a cached bitmap while moving or when the cache is sharp enough.
      const cacheSharpEnough = scale * dpr <= (CACHE_PX / L.mapSize) * 1.3;
      if (heavy && (interacting.current || cacheSharpEnough)) {
        if (!pathCache.current || pathCache.current.version !== pathVersion.current) {
          const c = pathCache.current?.canvas ?? document.createElement("canvas");
          c.width = c.height = CACHE_PX;
          const cctx = c.getContext("2d")!;
          cctx.clearRect(0, 0, CACHE_PX, CACHE_PX);
          cctx.scale(CACHE_PX / L.mapSize, CACHE_PX / L.mapSize);
          drawPaths(cctx, L.journeys, L.time, false, baseScale());
          pathCache.current = { canvas: c, version: pathVersion.current };
        }
        ctx.drawImage(pathCache.current.canvas, 0, 0, L.mapSize, L.mapSize);
      } else {
        drawPaths(ctx, L.journeys, L.time, L.singleMatch, scale);
      }
    }
    ctx.restore();

    // Markers in screen space: constant readable size, growing a little when zoomed in.
    const few = L.sorted.length < 120;
    const r = (L.singleMatch || few ? 7 : 4) * Math.min(1.6, 1 + (view.zoom - 1) * 0.08);
    for (const e of L.sorted) {
      const [sx, sy] = toScreen(e.x, e.y);
      if (sx < -10 || sy < -10 || sx > w + 10 || sy > h + 10) continue;
      drawMarker(ctx, e.cat, sx, sy, e.cat === "loot" ? r * 0.75 : r, e.bot);
    }

    // Numbered hotspot rings
    L.hotspots.forEach((hs, i) => {
      const [sx, sy] = toScreen(hs.x, hs.y);
      const R = Math.max(18, hs.r * scale);
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(sx, sy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.setLineDash([]);
      const bx = sx + R * 0.71;
      const by = sy - R * 0.71;
      ctx.beginPath();
      ctx.arc(bx, by, 11, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.stroke();
      ctx.fillStyle = "#1a1204";
      ctx.font = `700 12px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), bx, by + 0.5);
      ctx.restore();
    });

    if (hoverRef.current) {
      const [hx, hy] = toScreen(hoverRef.current.ev.x, hoverRef.current.ev.y);
      ctx.beginPath();
      ctx.arc(hx, hy, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawRulers(ctx, w, h, toScreen(0, 0), L.mapSize / GRID * scale, L.hotspots, ink);

    if (Math.abs(view.zoom - zoomLabelRef.current) > 0.01) {
      zoomLabelRef.current = view.zoom;
      setZoomLabel(view.zoom);
    }
    const fitted = view.zoom < 1.01 && Math.abs(view.cx - L.mapSize / 2) < 2 && Math.abs(view.cy - L.mapSize / 2) < 2;
    if (fitted !== fittedRef.current) {
      fittedRef.current = fitted;
      setIsFitted(fitted);
    }
  };
  const zoomLabelRef = useRef(1);
  const fittedRef = useRef(true);
  const [isFitted, setIsFitted] = useState(true);

  const requestDraw = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      draw();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Mark the map as "moving" (use the cheap path cache) until input has been idle for a moment. */
  const touchInteraction = () => {
    interacting.current = true;
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      interacting.current = false;
      requestDraw(); // final sharp frame
    }, 160);
  };

  const setView = (v: View) => {
    viewRef.current = v;
    requestDraw();
  };

  const setHover = (hv: Hover | null) => {
    hoverRef.current = hv;
    setHoverState(hv);
    requestDraw();
  };

  // redraw whenever the data being shown changes
  useEffect(() => {
    pathVersion.current++;
    requestDraw();
  }, [journeys, time, showPaths, singleMatch, requestDraw]);
  useEffect(requestDraw, [events, heat, hotspots, theme, requestDraw]);
  // canvas text uses the web fonts: redraw once they have loaded
  useEffect(() => {
    document.fonts?.ready.then(requestDraw);
  }, [requestDraw]);

  // ---- view maths ------------------------------------------------------------------------
  const clampView = (v: View): View => ({
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom)),
    cx: Math.min(mapSize, Math.max(0, v.cx)),
    cy: Math.min(mapSize, Math.max(0, v.cy)),
  });

  /** View after zooming by `factor` around screen point (sx, sy), keeping that point still. */
  const zoomedAround = (v: View, factor: number, sx: number, sy: number): View => {
    const { ox, oy } = centre();
    const s0 = baseScale() * v.zoom;
    const mx = (sx - ox) / s0 + v.cx;
    const my = (sy - oy) / s0 + v.cy;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
    const s1 = baseScale() * zoom;
    return clampView({ zoom, cx: mx - (sx - ox) / s1, cy: my - (sy - oy) / s1 });
  };

  const animateTo = (target: View) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const dur = 260;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      touchInteraction();
      setView({
        zoom: from.zoom * Math.pow(target.zoom / from.zoom, e),
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
      });
      if (k < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  };

  const zoomBy = (factor: number) => {
    const { ox, oy } = centre();
    animateTo(zoomedAround(viewRef.current, factor, ox, oy));
  };
  const resetView = () => animateTo(fitView());

  // ---- lifecycle --------------------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      const h = e.contentRect.height;
      const dpr = window.devicePixelRatio || 1;
      const c = canvasRef.current!;
      // Resizing the canvas bitmap is expensive: only do it when the box actually changes.
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      sizeRef.current = { w, h };
      setSize({ w, h });
      pathVersion.current++;
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    imgRef.current = null;
    setImgReady(false);
    viewRef.current = fitView();
    const im = new Image();
    im.onload = () => {
      imgRef.current = im;
      setImgReady(true);
      requestDraw();
    };
    im.src = imageUrl;
    requestDraw();
  }, [imageUrl, fitView, requestDraw]);

  useEffect(() => {
    if (focus) animateTo(clampView({ zoom: focus.zoom, cx: focus.x, cy: focus.y }));
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // wheel / trackpad zoom: native listener so we can preventDefault page zoom/scroll
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; // lines -> pixels (Firefox)
      else if (e.deltaMode === 2) dy *= 400; // pages -> pixels
      dy = Math.max(-150, Math.min(150, dy)); // one mouse-wheel notch ≈ one zoom step
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.003)); // ctrl+wheel = trackpad pinch
      const r = canvas.getBoundingClientRect();
      touchInteraction();
      setView(zoomedAround(viewRef.current, factor, e.clientX - r.left, e.clientY - r.top));
      if (hoverRef.current) setHover(null);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [mapSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard: + / - / 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      if (e.key === "+" || e.key === "=") zoomBy(STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / STEP);
      else if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // no dependency list on purpose: re-subscribes each render so the handler always sees current state

  // ---- pointer interaction (mouse, pen, touch; two fingers = pinch) --------------------------
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const nearestEvent = (sx: number, sy: number, radius: number): GameEvent | null => {
    let best: GameEvent | null = null;
    let bestD = radius;
    for (const e of live.current.sorted) {
      const [ex, ey] = toScreen(e.x, e.y);
      const d = Math.hypot(ex - sx, ey - sy);
      if (d <= bestD) {
        // later entries are drawn on top (combat over loot), so prefer them on ties
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    cancelAnimationFrame(anim.current);
    pointers.current.set(e.pointerId, local(e));
    gesture.current = { moved: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") {
        const ev = nearestEvent(p.x, p.y, 10);
        if (ev !== hoverRef.current?.ev) setHover(ev ? { ev, sx: p.x, sy: p.y, pinned: false } : null);
      }
      return;
    }
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2 && gesture.current.pinchDist) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let v = zoomedAround(viewRef.current, dist / gesture.current.pinchDist, mid.x, mid.y);
      const s = baseScale() * v.zoom;
      v = clampView({ ...v, cx: v.cx - (mid.x - gesture.current.mid!.x) / s, cy: v.cy - (mid.y - gesture.current.mid!.y) / s });
      touchInteraction();
      setView(v);
      gesture.current = { moved: true, pinchDist: dist, mid };
      if (hoverRef.current) setHover(null);
      return;
    }

    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (!gesture.current.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    gesture.current.moved = true;
    const s = scaleNow();
    touchInteraction();
    setView(clampView({ ...viewRef.current, cx: viewRef.current.cx - dx / s, cy: viewRef.current.cy - dy / s }));
    if (hoverRef.current) setHover(null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasTap = !gesture.current.moved && pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinchDist = undefined;
    if (!wasTap) return;
    const p = local(e);
    if (e.pointerType === "mouse") {
      const ev = nearestEvent(p.x, p.y, 10);
      if (ev && !singleMatch) onOpenMatch(ev.matchId);
    } else {
      const ev = nearestEvent(p.x, p.y, 18);
      setHover(ev ? { ev, sx: p.x, sy: p.y, pinned: true } : null);
    }
  };

  const tooltipW = 260;
  const tipLeft = hover ? Math.min(hover.sx + 14, size.w - tooltipW - 8) : 0;
  const tipTop = hover ? Math.min(hover.sy + 14, size.h - 120) : 0;

  return (
    <div className="map-wrap" ref={wrapRef} data-tour="canvas">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, cursor: hover && !singleMatch && !hover.pinned ? "pointer" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => e.pointerType === "mouse" && !pointers.current.size && hoverRef.current && setHover(null)}
        onDoubleClick={(e) => {
          const p = local(e);
          animateTo(zoomedAround(viewRef.current, 2, p.x, p.y));
        }}
      />
      {!imgReady && <div className="map-loading">Loading minimap…</div>}

      <div className="zoom-ctrl" data-tour="zoom">
        <button onClick={() => zoomBy(STEP)} disabled={zoomLabel >= MAX_ZOOM - 0.01} aria-label="Zoom in" title="Zoom in (+)">
          <IconPlus />
        </button>
        <div className="zoom-level" title="Current zoom">{zoomLabel.toFixed(zoomLabel < 10 ? 1 : 0)}×</div>
        <button onClick={() => zoomBy(1 / STEP)} disabled={zoomLabel <= MIN_ZOOM + 0.01} aria-label="Zoom out" title="Zoom out (−)">
          <IconMinus />
        </button>
        <button onClick={resetView} disabled={isFitted} aria-label="Fit map" title="Fit the whole map on screen (0)">
          <IconFit />
        </button>
        <button
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen: just the map and timeline"}
          className="fs-btn"
        >
          {fullscreen ? <IconShrink /> : <IconExpand />}
        </button>
      </div>

      <div className="map-hint">
        <span className="hint-desktop">Scroll to zoom · drag to pan · double-click to zoom in{!singleMatch && " · click a marker to open its match"}</span>
        <span className="hint-touch">Pinch to zoom · drag to pan · tap a marker</span>
      </div>

      {hover && (
        <div className={`tooltip ${hover.pinned ? "pinned" : ""}`} style={{ left: Math.max(8, tipLeft), top: Math.max(8, tipTop), width: tooltipW }}>
          <div className="tt-title">
            <span className="dot" style={{ background: COLORS[hover.ev.cat] }} />
            {describeEvent(hover.ev.name, hover.ev.bot)}
          </div>
          <div className="tt-row">
            {hover.ev.bot ? "Bot" : "Human"} <code>{hover.ev.playerId.slice(0, 8)}</code> · {clock(hover.ev.t)} into match
          </div>
          <div className="tt-sub">Raw event: {hover.ev.name}</div>
          {!singleMatch &&
            (hover.pinned ? (
              <button className="btn primary block tt-open" onClick={() => onOpenMatch(hover.ev.matchId)}>
                Open this match
              </button>
            ) : (
              <div className="tt-sub">Click to open this match</div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Paths in map space; `scale` = screen pixels per map unit, so line widths stay ~constant on screen. */
function drawPaths(ctx: CanvasRenderingContext2D, journeys: Journey[], time: number, singleMatch: boolean, scale: number) {
  const px = 1 / scale;
  for (const j of journeys) {
    const p = j.path;
    if (p.length < 3 || p[0] > time) continue;
    ctx.beginPath();
    ctx.moveTo(p[1], p[2]);
    let lastX = p[1];
    let lastY = p[2];
    for (let i = 3; i < p.length; i += 3) {
      if (p[i] > time) break;
      ctx.lineTo(p[i + 1], p[i + 2]);
      lastX = p[i + 1];
      lastY = p[i + 2];
    }
    ctx.strokeStyle = j.bot ? COLORS.bot : COLORS.human;
    ctx.globalAlpha = singleMatch ? 0.95 : j.bot ? 0.22 : 0.18;
    ctx.lineWidth = (singleMatch ? (j.bot ? 1.5 : 2.5) : 1) * px;
    ctx.setLineDash(j.bot ? [4 * px, 3 * px] : []);
    ctx.stroke();

    // playback head: where this player is right now (while still in the match)
    if (singleMatch && time <= j.endT) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(lastX, lastY, (j.bot ? 4 : 5.5) * px, 0, Math.PI * 2);
      ctx.fillStyle = j.bot ? COLORS.bot : COLORS.human;
      ctx.fill();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = "#000";
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/**
 * Grid-reference rulers (columns A–P along the top, rows 1–16 down the left), pinned to the
 * viewport edges and following pan/zoom. Columns and rows that contain a hotspot are lit.
 */
function drawRulers(
  ctx: CanvasRenderingContext2D, w: number, h: number, origin: [number, number], cellPx: number,
  hotspots: Hotspot[], ink: (typeof INK)["dark"],
) {
  const R = RULER;
  const hotCols = new Set(hotspots.map((hs) => gridCol(hs.x)));
  const hotRows = new Set(hotspots.map((hs) => gridRow(hs.y)));
  const every = cellPx < 16 ? 2 : 1; // thin out labels when cells get tiny
  ctx.save();
  ctx.fillStyle = ink.rulerBg;
  ctx.fillRect(0, 0, w, R);
  ctx.fillRect(0, R, R, h - R);
  ctx.fillStyle = ink.rulerLine;
  ctx.fillRect(0, R - 1, w, 1);
  ctx.fillRect(R - 1, 0, 1, h);
  ctx.font = `500 10px ${FONT_MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < GRID; i++) {
    // columns
    const x0 = origin[0] + i * cellPx;
    if (x0 + cellPx > R && x0 < w) {
      ctx.fillStyle = ink.tick;
      if (x0 > R) ctx.fillRect(Math.round(x0), R - 6, 1, 5);
      const cx = x0 + cellPx / 2;
      if (i % every === 0 && cx > R + 4 && cx < w - 4) {
        const hot = hotCols.has(i);
        ctx.fillStyle = hot ? ink.hot : ink.label;
        ctx.font = `${hot ? 700 : 500} 10px ${FONT_MONO}`;
        ctx.fillText(String.fromCharCode(65 + i), cx, R / 2);
      }
    }
    // rows
    const y0 = origin[1] + i * cellPx;
    if (y0 + cellPx > R && y0 < h) {
      ctx.fillStyle = ink.tick;
      if (y0 > R) ctx.fillRect(R - 6, Math.round(y0), 5, 1);
      const cy = y0 + cellPx / 2;
      if (i % every === 0 && cy > R + 4 && cy < h - 4) {
        const hot = hotRows.has(i);
        ctx.fillStyle = hot ? ink.hot : ink.label;
        ctx.font = `${hot ? 700 : 500} 10px ${FONT_MONO}`;
        ctx.fillText(String(i + 1), R / 2, cy);
      }
    }
  }
  ctx.restore();
}
