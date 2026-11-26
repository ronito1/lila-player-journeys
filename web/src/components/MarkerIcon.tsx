import { useEffect, useRef } from "react";
import type { Category } from "../lib/types";
import { drawMarker } from "../lib/style";

/** Legend icon drawn with the exact same function the map uses. */
export default function MarkerIcon({ cat }: { cat: Category }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = 18 * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    drawMarker(ctx, cat, 9, 9, 6, false);
  }, [cat]);
  return <canvas ref={ref} className="marker-icon" style={{ width: 18, height: 18 }} />;
}
