// Density heatmap: bin points into a grid, blur it, colour it, return an image to draw over the map.

const GRID = 128; // 1024 / 128 = one cell per 8 minimap pixels
const BLUR_PASSES = 3; // repeated box blur ≈ gaussian

export function buildHeatmap(points: Array<[number, number]>, mapSize: number): HTMLCanvasElement | null {
  if (points.length === 0) return null;
  let grid: Float32Array = new Float32Array(GRID * GRID);
  const k = GRID / mapSize;
  for (const [x, y] of points) {
    const cx = Math.min(GRID - 1, Math.max(0, Math.floor(x * k)));
    const cy = Math.min(GRID - 1, Math.max(0, Math.floor(y * k)));
    grid[cy * GRID + cx] += 1;
  }
  for (let i = 0; i < BLUR_PASSES; i++) grid = boxBlur(grid);

  // Normalise against the 99.5th percentile so one hot cell doesn't wash everything else out.
  const sorted = Array.from(grid).filter((v) => v > 0).sort((a, b) => a - b);
  const max = sorted[Math.floor(sorted.length * 0.995)] || sorted[sorted.length - 1] || 1;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = GRID;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(GRID, GRID);
  for (let i = 0; i < grid.length; i++) {
    const v = Math.min(1, grid[i] / max);
    if (v < 0.02) continue;
    const [r, g, b] = ramp(v);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(60 + 170 * Math.sqrt(v));
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function boxBlur(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= GRID) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= GRID) continue;
          sum += src[yy * GRID + xx];
          n++;
        }
      }
      out[y * GRID + x] = sum / n;
    }
  }
  return out;
}

// Dark purple -> red -> orange -> pale yellow (inferno-like, readable on dark minimaps)
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [60, 15, 110]],
  [0.35, [190, 40, 80]],
  [0.65, [245, 120, 30]],
  [1, [255, 245, 160]],
];

function ramp(v: number): [number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (v <= p1) {
      const f = (v - p0) / (p1 - p0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * f)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const HEAT_GRADIENT_CSS = `linear-gradient(90deg, ${STOPS.map(([p, c]) => `rgb(${c.join(",")}) ${p * 100}%`).join(", ")})`;
