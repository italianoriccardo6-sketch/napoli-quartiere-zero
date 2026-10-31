import { inside, segmentDistance, toLocal, type Footprint, type MapData, type Point } from './geo';
import { importOSM } from './import-osm';

/** Geographic measurements in local metres. Width exists only when OSM supplies it. */
export interface RealRoad {
  id: string;
  name?: string;
  highway: string;
  points: Point[];
  nodeIds: string[];
  width?: number;
  access?: string;
  surface?: string;
  /** Source tags retained verbatim so the caller can distinguish grade-separated roads. */
  tunnel?: string;
  bridge?: string;
  covered?: string;
  layer?: string;
}
export interface CoastlineWay { id: string; nodeIds: string[]; points: Point[] }
export interface CoastlineChain {
  sourceIds: string[];
  /** OSM direction is preserved: land lies to the left. Closed rings omit a duplicated last point. */
  points: Point[];
  nodeIds: string[];
  closed: boolean;
  ambiguous: boolean;
}
export interface CoastlineResult { chains: CoastlineChain[]; ambiguousNodeIds: string[] }
export interface RealGeography {
  map: MapData;
  roads: RealRoad[];
  coastlines: CoastlineChain[];
  diagnostics: { incompleteWays: string[]; ambiguousCoastNodes: string[] };
}
interface RawNode { type: 'node'; id: number; lon: number; lat: number }
interface RawWay {
  type: 'way'; id: number; nodes?: number[];
  geometry?: Array<{ lon: number; lat: number } | null>;
  tags?: Record<string, string>;
}
const validPoint = (p: Point) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
const pointCopy = (p: Point): Point => [p[0], p[1]];

/** Join only matching directed ends. Reversing a coast would invert its land/sea meaning. */
export function stitchDirectedCoastlines(input: CoastlineWay[]): CoastlineResult {
  const ways = input.filter(w => w.points.length >= 2 && w.points.length === w.nodeIds.length && w.points.every(validPoint))
    .map(w => ({ id: w.id, points: w.points.map(pointCopy), nodeIds: [...w.nodeIds] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const starts = new Map<string, number[]>(), ends = new Map<string, number[]>();
  ways.forEach((w, i) => {
    const a = w.nodeIds[0], b = w.nodeIds.at(-1)!;
    starts.set(a, [...(starts.get(a) ?? []), i]);
    ends.set(b, [...(ends.get(b) ?? []), i]);
  });
  const ambiguousNodeIds = [...new Set([...starts.keys(), ...ends.keys()])]
    .filter(id => (starts.get(id)?.length ?? 0) > 1 || (ends.get(id)?.length ?? 0) > 1).sort();
  const ambiguous = new Set(ambiguousNodeIds), visited = new Set<number>(), chains: CoastlineChain[] = [];
  // Begin open chains first, then any closed loops. Input order must not affect joins.
  const order = ways.map((_, i) => i).sort((a, b) => {
    const aOpen = !(ends.get(ways[a].nodeIds[0])?.length), bOpen = !(ends.get(ways[b].nodeIds[0])?.length);
    return Number(bOpen) - Number(aOpen) || a - b;
  });
  for (const first of order) {
    if (visited.has(first)) continue;
    const chain: CoastlineChain = { sourceIds: [], points: [], nodeIds: [], closed: false, ambiguous: false };
    let current = first;
    while (!visited.has(current)) {
      const way = ways[current]; visited.add(current); chain.sourceIds.push(way.id);
      const skip = chain.points.length ? 1 : 0;
      chain.points.push(...way.points.slice(skip)); chain.nodeIds.push(...way.nodeIds.slice(skip));
      const last = chain.nodeIds.at(-1)!;
      if (chain.nodeIds[0] === last) { chain.closed = true; break; }
      const next = starts.get(last) ?? [];
      if (ambiguous.has(last) || next.length !== 1 || visited.has(next[0])) break;
      current = next[0];
    }
    chain.ambiguous = chain.nodeIds.some(id => ambiguous.has(id));
    if (chain.closed) { chain.points.pop(); chain.nodeIds.pop(); }
    chains.push(chain);
  }
  return { chains, ambiguousNodeIds };
}

/** Keep roads/coasts from raw way geometry; existing importer handles buildings and relation holes. */
export function extractRealGeography(raw: unknown): RealGeography {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { elements?: unknown }).elements)) throw new Error('Estratto OSM privo di elementi.');
  const elements = (raw as { elements: Array<RawNode | RawWay | { type: string }> }).elements;
  const nodes = new Map<number, Point>();
  for (const e of elements) {
    if (e.type !== 'node') continue;
    const n = e as RawNode;
    if (Number.isFinite(n.lon) && Number.isFinite(n.lat)) nodes.set(n.id, toLocal(n.lon, n.lat));
  }
  const roads: RealRoad[] = [], coastWays: CoastlineWay[] = [], incompleteWays: string[] = [];
  for (const e of elements) {
    if (e.type !== 'way') continue;
    const way = e as RawWay, tags = way.tags ?? {};
    if (!tags.highway && tags.natural !== 'coastline') continue;
    let points: Array<Point | undefined>, nodeIds: string[];
    if (way.nodes?.length) {
      nodeIds = way.nodes.map(String); points = way.nodes.map(id => nodes.get(id));
      if (way.geometry?.length === way.nodes.length) points = points.map((p, i) => {
        const g = way.geometry![i]; return p ?? (g && Number.isFinite(g.lon) && Number.isFinite(g.lat) ? toLocal(g.lon, g.lat) : undefined);
      });
    } else if (way.geometry?.length) {
      points = way.geometry.map(g => g && Number.isFinite(g.lon) && Number.isFinite(g.lat) ? toLocal(g.lon, g.lat) : undefined);
      nodeIds = way.geometry.map((g, i) => g ? `coord:${g.lon.toFixed(8)},${g.lat.toFixed(8)}` : `missing:${way.id}:${i}`);
    } else { incompleteWays.push(`way/${way.id}`); continue; }
    if (points.length < 2 || points.some(p => !p || !validPoint(p))) { incompleteWays.push(`way/${way.id}`); continue; }
    const complete = (points as Point[]).map(pointCopy), id = `way/${way.id}`;
    if (tags.highway) {
      const widthText = (tags.width ?? '').trim();
      const width = /^(?:[0-9]+(?:[.,][0-9]+)?)\s*(?:m|metres?|meters?)?$/.test(widthText) ? Number.parseFloat(widthText.replace(',', '.')) : NaN;
      roads.push({ id, name: tags.name, highway: tags.highway, points: complete, nodeIds: [...nodeIds],
        ...(Number.isFinite(width) && width > 0 ? { width } : {}), access: tags.access, surface: tags.surface,
        tunnel: typeof tags.tunnel === 'string' ? tags.tunnel : undefined, bridge: typeof tags.bridge === 'string' ? tags.bridge : undefined,
        covered: typeof tags.covered === 'string' ? tags.covered : undefined, layer: typeof tags.layer === 'string' ? tags.layer : undefined });
    }
    if (tags.natural === 'coastline') coastWays.push({ id, points: complete, nodeIds: [...nodeIds] });
  }
  const stitched = stitchDirectedCoastlines(coastWays);
  return { map: importOSM(raw), roads, coastlines: stitched.chains,
    diagnostics: { incompleteWays, ambiguousCoastNodes: stitched.ambiguousNodeIds } };
}

/** Horizontal building clearance only: does not certify terrain, road width, steps or water safety. */
export function clearOfBuildings(p: Point, buildings: Footprint[], radius = .6): boolean {
  if (!validPoint(p) || !Number.isFinite(radius) || radius < 0) return false;
  return !buildings.some(building => {
    const [outer, ...holes] = building.rings;
    if (!outer?.length) return false;
    if (inside(p, outer) && !holes.some(h => inside(p, h))) return true;
    return building.rings.some(ring => ring.some((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length]) < radius));
  });
}
export interface RoadPoint { roadId: string; name?: string; point: Point; tangent: Point; distanceAlong: number }

/** Candidate spawn/interaction points must still be checked against the finished ground and colliders. */
export function sampleClearRoadPoints(roads: RealRoad[], buildings: Footprint[], options: { spacing?: number; radius?: number; limit?: number } = {}): RoadPoint[] {
  const spacing = options.spacing ?? 8, radius = options.radius ?? .6, limit = options.limit ?? 10000;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(limit) || limit < 0) throw new Error('Campionamento strade non valido.');
  const points: RoadPoint[] = [];
  for (const road of roads) {
    if (road.width !== undefined && road.width < radius * 2) continue;
    let distanceAlong = 0, next = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      const tangent: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      while (next <= distanceAlong + length + 1e-8) {
        const t = (next - distanceAlong) / length;
        const point: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (clearOfBuildings(point, buildings, radius)) {
          if (points.length >= limit) return points;
          points.push({ roadId: road.id, name: road.name, point, tangent: [...tangent], distanceAlong: next });
        }
        next += spacing;
      }
      distanceAlong += length;
    }
  }
  return points;
}

export function nearestRoadPoint(p: Point, roads: RealRoad[], maximumDistance = Infinity): (RoadPoint & { distance: number }) | null {
  if (!validPoint(p) || maximumDistance < 0) return null;
  let nearest: (RoadPoint & { distance: number }) | null = null;
  for (const road of roads) {
    let distanceAlong = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dz = b[1] - a[1], squared = dx * dx + dz * dz;
      if (!squared) continue;
      const length = Math.sqrt(squared), t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / squared));
      const point: Point = [a[0] + dx * t, a[1] + dz * t], distance = Math.hypot(p[0] - point[0], p[1] - point[1]);
      if (distance <= maximumDistance && (!nearest || distance < nearest.distance)) nearest = { roadId: road.id, name: road.name, point, tangent: [dx / length, dz / length], distanceAlong: distanceAlong + length * t, distance };
      distanceAlong += length;
    }
  }
  return nearest;
}

/** Swept horizontal clearance with bounded sampling, not a full route or terrain validator. */
export function pathClearOfBuildings(path: Point[], buildings: Footprint[], radius = .6, step = .25): boolean {
  if (path.length < 2 || !Number.isFinite(step) || step <= 0 || path.some(p => !validPoint(p))) return false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j <= count; j++) {
      const t = j / count;
      if (!clearOfBuildings([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], buildings, radius)) return false;
    }
  }
  return true;
}
