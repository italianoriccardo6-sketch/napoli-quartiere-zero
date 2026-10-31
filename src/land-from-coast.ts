import polygonClipping from 'polygon-clipping';
import type { Point } from './geo';
import type { CoastlineChain } from './real-geography';

export type MetricBounds = readonly [number, number, number, number] | { minX: number; minZ: number; maxX: number; maxZ: number };
export interface MeasuredLand {
  /** Each polygon starts with an outer ring; subsequent rings are holes. No closing duplicate. */
  polygons: Point[][][];
  provenance: {
    source: 'OpenStreetMap natural=coastline';
    landSide: 'left';
    coastlineWayIds: string[];
    measuredCoastPointCount: number;
    clippingBounds: [number, number, number, number];
    syntheticClosureOutsideBounds: true;
    syntheticClosure: Point[];
  };
}
const EPSILON = 1e-7;
const equal = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON;
const signedArea = (ring: Point[]) => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
function boundsTuple(bounds: MetricBounds): [number, number, number, number] {
  const box: [number, number, number, number] = Array.isArray(bounds)
    ? [...bounds] as [number, number, number, number]
    : [(bounds as Exclude<MetricBounds, readonly number[]>).minX, (bounds as Exclude<MetricBounds, readonly number[]>).minZ,
      (bounds as Exclude<MetricBounds, readonly number[]>).maxX, (bounds as Exclude<MetricBounds, readonly number[]>).maxZ];
  if (!box.every(Number.isFinite) || box[0] >= box[2] || box[1] >= box[3]) throw new Error('Perimetro metrico non valido.');
  return box;
}
/** Intersection with the closed viewport. Used to prove that artificial edges remain invisible. */
function segmentTouchesBox(a: Point, b: Point, box: [number, number, number, number]): boolean {
  let near = 0, far = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - box[0]], [dx, box[2] - a[0]], [-dz, a[1] - box[1]], [dz, box[3] - a[1]]]) {
    if (Math.abs(p) < EPSILON) { if (q < 0) return false; }
    else {
      const ratio = q / p;
      if (p < 0) near = Math.max(near, ratio); else far = Math.min(far, ratio);
      if (near > far) return false;
    }
  }
  return true;
}
function cross(a: Point, b: Point, c: Point) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function hasObviousCrossing(ring: Point[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      const c = ring[j], d = ring[(j + 1) % ring.length];
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - EPSILON || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - EPSILON ||
          Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - EPSILON || Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - EPSILON) continue;
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
      const opposite = (x: number, y: number) => (x > EPSILON && y < -EPSILON) || (x < -EPSILON && y > EPSILON);
      if (opposite(abC, abD) && opposite(cdA, cdB)) return true;
      // Non-adjacent shared vertices can describe a pinched coastline. Overlapping edges cannot.
      if ([abC, abD, cdA, cdB].every(value => Math.abs(value) <= EPSILON)) {
        const axis = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 0 : 1;
        const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
        if (overlap > EPSILON) return true;
      }
    }
  }
  return false;
}

/**
 * For the verified Naples extract: one west→east OSM coastline, land on its left.
 * The large source chain extends beyond the viewport on both sides. It is closed
 * to the north OUTSIDE that viewport, then clipped as a polygon, not as separate
 * coastline fragments. Thus harbour piers and water holes survive boundary cuts.
 * It deliberately rejects other topologies instead of fabricating a shoreline.
 */
export function buildNaplesLand(coastlines: CoastlineChain[], bounds: MetricBounds): MeasuredLand {
  const box = boundsTuple(bounds);
  if (coastlines.length !== 1 || coastlines[0].closed || coastlines[0].ambiguous) throw new Error('Attesa una sola costa aperta, diretta e non ambigua.');
  const coast = coastlines[0];
  if (coast.points.length < 2 || coast.points.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new Error('Coordinate della costa non valide.');
  const points = coast.points.filter((p, i) => !i || !equal(p, coast.points[i - 1])).map(p => [p[0], p[1]] as Point);
  const first = points[0], last = points.at(-1)!;
  if (points.length < 2 || equal(first, last)) throw new Error('Costa aperta degenere.');
  if (!(first[0] < box[0] - EPSILON && last[0] > box[2] + EPSILON)) throw new Error('La costa deve iniziare a ovest e finire a est, fuori dal perimetro.');
  if (!points.slice(1).some((p, i) => segmentTouchesBox(points[i], p, box))) throw new Error('La costa misurata non attraversa il perimetro.');
  const margin = Math.max(100, Math.max(box[2] - box[0], box[3] - box[1]) * .1);
  const outerWest = Math.min(box[0], ...points.map(p => p[0])) - margin;
  const outerEast = Math.max(box[2], ...points.map(p => p[0])) + margin;
  const outerNorth = Math.max(box[3], ...points.map(p => p[1])) + margin;
  const closure: Point[] = [last, [outerEast, last[1]], [outerEast, outerNorth], [outerWest, outerNorth], [outerWest, first[1]], first];
  if (closure.slice(1).some((p, i) => segmentTouchesBox(closure[i], p, box))) throw new Error('Una chiusura sintetica entrerebbe nel perimetro: serve un estratto più ampio.');
  const ring: Point[] = [...points, ...closure.slice(1, -1)];
  if (signedArea(ring) <= EPSILON) throw new Error('Orientamento della costa incompatibile con terra a sinistra.');
  if (hasObviousCrossing(ring)) throw new Error('Costa/chiusura con intersezioni o sovrapposizioni: revisione necessaria.');
  const viewport: Point[] = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]];
  const clipped = polygonClipping.intersection([[...ring, ring[0]]], [viewport]);
  const polygons: Point[][][] = clipped.map(polygon => polygon.map((r, i) => {
    const cleaned = r.map(p => [Math.max(box[0], Math.min(box[2], p[0])), Math.max(box[1], Math.min(box[3], p[1]))] as Point);
    if (cleaned.length > 1 && equal(cleaned[0], cleaned.at(-1)!)) cleaned.pop();
    if ((i === 0 && signedArea(cleaned) < 0) || (i > 0 && signedArea(cleaned) > 0)) cleaned.reverse();
    return cleaned;
  })).filter(p => p[0].length >= 3 && Math.abs(signedArea(p[0])) > EPSILON);
  if (!polygons.length) throw new Error('Nessuna superficie terrestre ricavata dalla costa.');
  return { polygons, provenance: { source: 'OpenStreetMap natural=coastline', landSide: 'left', coastlineWayIds: [...coast.sourceIds], measuredCoastPointCount: coast.points.length,
    clippingBounds: box, syntheticClosureOutsideBounds: true, syntheticClosure: closure.map(p => [p[0], p[1]]) } };
}
