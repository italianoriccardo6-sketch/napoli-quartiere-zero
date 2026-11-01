import type {Point} from './geo';
import {segmentDistance} from './geo';
import type {CityRuntime} from './city-data';
import {cityRoadWidth} from './road-width';
import {canStandForCar} from './vehicle-clearance';
import type {GroundCheck} from './movement';

export interface TrafficNode {id:string;point:Point;edges:TrafficEdge[]}
export interface TrafficEdge {to:string;roadId:string;distance:number;width:number}
export interface TrafficNetwork {nodes:Map<string,TrafficNode>;segments:Array<{a:Point;b:Point;width:number;roadId:string}>;sourceRoads:number;excludedRoads:number;validatedEdges:number}
export interface TrafficCapsule {position:Point;heading:number;radius:number;halfLength:number}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const drivable=new Set(['residential','tertiary','secondary','primary','unclassified','living_street','service']);
const absent=(v:unknown)=>v===undefined||v==='no'||v==='false'||v==='0';
const validPoint=(p:Point)=>p.length===2&&p.every(Number.isFinite);

/** Source centreline graph only. Widths without an OSM width tag remain visual estimates. */
/**
 * `edgeCache` may be shared between builds over the same static source ground:
 * it stores whether a source segment admits the full car capsule, so moving the
 * network around the player never re-samples streets already validated.
 */
export function buildTrafficNetwork(city:CityRuntime,ground:GroundCheck,options:{anchor:Point;radius?:number;maxEdges?:number;carRadius?:number;carHalfLength?:number;edgeCache?:Map<string,boolean>}):TrafficNetwork {
  const radius=options.radius??500,maxEdges=options.maxEdges??1600,carRadius=options.carRadius??1.3085043,halfLength=options.carHalfLength??2.225;
  if(!validPoint(options.anchor)||!Number.isFinite(radius)||radius<=0||radius>1500||!Number.isInteger(maxEdges)||maxEdges<1||maxEdges>5000)throw Error('Invalid traffic network budget.');
  const nodes=new Map<string,TrafficNode>(),segments:TrafficNetwork['segments']=[];
  const graph:TrafficNetwork={nodes,segments,sourceRoads:city.roads.length,excludedRoads:0,validatedEdges:0};
  // Each road's nearest-point distance is computed once. Roads whose every point
  // lies beyond the radius cannot contribute a segment (see the endpoint test
  // below), so dropping them before sorting leaves the resulting graph unchanged.
  const roads=city.roads.map(road=>road as typeof road&{nodeIds?:string[];tunnel?:string;bridge?:string;covered?:string;layer?:string;access?:string}).filter(road=>{
    const allowed=drivable.has(road.highway)&&absent(road.tunnel)&&absent(road.bridge)&&absent(road.covered)&&absent(road.layer)&&road.access!=='private'&&road.access!=='no';
    if(!allowed)graph.excludedRoads++;return allowed;
  }).map(road=>{let nearest=Infinity;for(const p of road.points){const d=distance(p,options.anchor);if(d<nearest)nearest=d;}return {road,nearest};})
    .filter(entry=>entry.nearest<=radius)
    .sort((a,b)=>a.nearest-b.nearest||a.road.id.localeCompare(b.road.id)).map(entry=>entry.road);
  const cache=options.edgeCache,cacheScope=`${carRadius}:${halfLength}:`;
  const node=(id:string,point:Point)=>{let n=nodes.get(id);if(!n){n={id,point:[...point],edges:[]};nodes.set(id,n);}return n;};
  for(const road of roads){
    const width=cityRoadWidth(road);if(width<carRadius*2+.3)continue;
    for(let i=1;i<road.points.length;i++){
      if(graph.validatedEdges>=maxEdges)return graph;
      const a=road.points[i-1],b=road.points[i];if(!validPoint(a)||!validPoint(b)||Math.min(distance(a,options.anchor),distance(b,options.anchor))>radius)continue;
      const span=distance(a,b);if(span<.3||span>350)continue;
      const heading=Math.atan2(b[0]-a[0],b[1]-a[1]);
      const cacheKey=cacheScope+road.id+':'+i+':'+a.join(',')+':'+b.join(',');
      let clear=cache?.get(cacheKey);
      if(clear===undefined){
        clear=true;
        // Include both endpoints and the complete body, not just a centre point.
        const count=Math.max(1,Math.ceil(span/1.25));
        for(let k=0;k<=count;k++){const t=k/count;if(!canStandForCar({x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t},heading,ground,carRadius,halfLength)){clear=false;break;}}
        cache?.set(cacheKey,clear);
      }
      if(!clear)continue;
      const key=(index:number,p:Point)=>road.nodeIds?.[index]??`point:${p[0].toFixed(6)},${p[1].toFixed(6)}`;
      const aid=key(i-1,a),bid=key(i,b);if(aid===bid)continue;
      const an=node(aid,a),bn=node(bid,b);
      if(an.edges.some(e=>e.to===bid))continue;
      an.edges.push({to:bid,roadId:road.id,distance:span,width});bn.edges.push({to:aid,roadId:road.id,distance:span,width});
      segments.push({a:[...a],b:[...b],width,roadId:road.id});graph.validatedEdges++;
    }
  }
  return graph;
}

export function nearestTrafficNode(network:TrafficNetwork,point:Point,maxDistance=Infinity):TrafficNode|undefined {
  let nearest:TrafficNode|undefined,best=maxDistance;
  for(const node of network.nodes.values()){const d=distance(point,node.point);if(d<best){best=d;nearest=node;}}
  return nearest;
}
/** Dijkstra over real junction identities; never joins road crossings by proximity. */
export function routeTraffic(network:TrafficNetwork,start:string,end:string):Point[] {
  if(!network.nodes.has(start)||!network.nodes.has(end))return [];
  const costs=new Map([[start,0]]),previous=new Map<string,string>(),open=new Set([start]);
  while(open.size){
    let current:string|undefined;for(const id of open)if(current===undefined||costs.get(id)!<costs.get(current)!)current=id;
    open.delete(current!);if(current===end)break;
    for(const edge of network.nodes.get(current!)!.edges){const next=costs.get(current!)!+edge.distance;if(next<(costs.get(edge.to)??Infinity)){costs.set(edge.to,next);previous.set(edge.to,current!);open.add(edge.to);}}
  }
  if(start!==end&&!previous.has(end))return [];
  const ids=[end];while(ids[0]!==start){const parent=previous.get(ids[0]);if(parent===undefined)return [];ids.unshift(parent);}
  return ids.map(id=>[...network.nodes.get(id)!.point]);
}
export function onTrafficRoad(network:TrafficNetwork,point:Point,radius:number):boolean {
  return network.segments.some(s=>segmentDistance(point,s.a,s.b)<=s.width/2-radius+.05);
}
function axis(c:TrafficCapsule):[Point,Point]{const extent=Math.max(0,c.halfLength-c.radius),x=Math.sin(c.heading)*extent,z=Math.cos(c.heading)*extent;return [[c.position[0]-x,c.position[1]-z],[c.position[0]+x,c.position[1]+z]];}
export function trafficCapsulesOverlap(a:TrafficCapsule,b:TrafficCapsule,margin=0):boolean {
  const [a0,a1]=axis(a),[b0,b1]=axis(b);
  const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const crosses=cross(a0,a1,b0)*cross(a0,a1,b1)<0&&cross(b0,b1,a0)*cross(b0,b1,a1)<0;
  const separation=crosses?0:Math.min(segmentDistance(a0,b0,b1),segmentDistance(a1,b0,b1),segmentDistance(b0,a0,a1),segmentDistance(b1,a0,a1));
  return separation<a.radius+b.radius+margin;
}
