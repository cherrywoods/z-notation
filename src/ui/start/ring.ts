// Geometry of the topic ring: n bubbles evenly spaced (by angle) on an ellipse that fits
// the stage. The last bubble (own topic) sits at the bottom centre, the others follow
// clockwise from the bottom left. Returns null if no reasonable ring fits (→ carousel).

export interface RingLayout {
  /** Bubble diameter (px, unscaled). */
  size: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Bubble centres, in item order. */
  points: { x: number; y: number }[];
}

const D_MAX = 168;
const D_MIN = 96;
/** Room for the hover/selected scale (≈1.18) between neighbours. */
const MIN_GAP = 1.32;

export function ringLayout(w: number, h: number, n: number): RingLayout | null {
  if (n < 2 || w < 560 || h < 360) return null;
  const start = Math.min(D_MAX, Math.floor(0.24 * Math.min(w, h)));
  for (let d = start; d >= D_MIN; d -= 4) {
    const m = 0.6 * d + 6; // hovered bubble must stay inside the stage
    const ry0 = h / 2 - m;
    const rx0 = w / 2 - m;
    // landscape: a wide ellipse; portrait: slightly upright
    const ry = Math.min(ry0, rx0 * 1.3);
    const rx = Math.min(rx0, ry * 1.6);
    if (ry <= 0) continue;
    const points = Array.from({ length: n }, (_, k) => {
      const a = Math.PI / 2 + ((k + 1) * 2 * Math.PI) / n;
      return { x: w / 2 + rx * Math.cos(a), y: h / 2 + ry * Math.sin(a) };
    });
    let minDist = Infinity;
    for (let k = 0; k < n; k++) {
      const p = points[k];
      const q = points[(k + 1) % n];
      minDist = Math.min(minDist, Math.hypot(p.x - q.x, p.y - q.y));
    }
    // the ring must stay recognisable as a ring (not a squashed pair of rows)
    if (minDist >= MIN_GAP * d && ry >= 0.75 * d) {
      return { size: d, cx: w / 2, cy: h / 2, rx, ry, points };
    }
  }
  return null;
}
