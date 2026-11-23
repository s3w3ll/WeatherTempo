export interface Pt { x: number; y: number }

/** One cubic Bézier segment: control points c1, c2 and end point p. */
export interface CubicSeg { c1: Pt; c2: Pt; p: Pt }

/**
 * Catmull-Rom → Bézier: the smooth curve through `pts` that the website's
 * smoothPath() draws. Returns the segments after the first point (which is
 * the path's moveTo). Ends are clamped (phantom neighbours repeat the end).
 */
export function catmullRom(pts: Pt[]): CubicSeg[] {
  const segs: CubicSeg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 2)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 1)];
    segs.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p: p2,
    });
  }
  return segs;
}

const f = (n: number) => +n.toFixed(2);

/**
 * SVG path data for the smooth curve through `pts`. `continueFrom` omits the
 * leading "M" so it can extend an existing path. Skia's Path accepts SVG
 * strings, and so does anything else we might render to later.
 */
export function smoothPathD(pts: Pt[], continueFrom = false): string {
  if (pts.length < 2) return "";
  let d = continueFrom ? "" : `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (const s of catmullRom(pts)) d += `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p.x)} ${f(s.p.y)}`;
  return d;
}

/** Closed area under a curve down to `floorY`. */
export function areaD(pts: Pt[], floorY: number): string {
  if (pts.length < 2) return "";
  const last = pts[pts.length - 1];
  return `${smoothPathD(pts)}L${f(last.x)} ${f(floorY)}L${f(pts[0].x)} ${f(floorY)}Z`;
}
