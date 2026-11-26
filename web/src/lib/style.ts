import type { Category } from "./types";

/** Signal amber: the single accent (selection, hotspots, playhead). */
export const ACCENT = "#f4b23e";

// One place for the visual language so the legend and the canvas always agree.
export const COLORS = {
  human: "#3ddc97",
  bot: "#7aa7ff",
  kill: "#ff4d4f",
  death: "#f2f2f2",
  storm: "#c77dff",
  loot: "#ffd166",
};

/** Draw an event marker centred on (x, y). Shapes differ by category so they read without colour too. */
export function drawMarker(ctx: CanvasRenderingContext2D, cat: Category, x: number, y: number, r: number, bot: boolean) {
  ctx.save();
  ctx.globalAlpha = bot ? 0.55 : 1;
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.fillStyle = COLORS[cat];
  ctx.beginPath();
  switch (cat) {
    case "kill": {
      // ✕ with a dark outline
      const a = r * 0.9;
      for (const [w, style] of [[4.5, "rgba(0,0,0,0.85)"], [2.25, COLORS.kill]] as const) {
        ctx.beginPath();
        ctx.lineWidth = w;
        ctx.strokeStyle = style;
        ctx.moveTo(x - a, y - a);
        ctx.lineTo(x + a, y + a);
        ctx.moveTo(x + a, y - a);
        ctx.lineTo(x - a, y + a);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case "death":
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      break;
    case "storm":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      ctx.closePath();
      break;
    case "loot":
      ctx.moveTo(x, y - r * 0.8);
      ctx.lineTo(x + r * 0.8, y);
      ctx.lineTo(x, y + r * 0.8);
      ctx.lineTo(x - r * 0.8, y);
      ctx.closePath();
      break;
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
