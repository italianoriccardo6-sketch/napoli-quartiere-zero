import type {CityRuntime} from './city-data';
import {segmentDistance,type Point} from './geo';
import {moveOnGround,type GroundCheck} from './movement';

export interface EncounterPlayer {position:Point;heading:number;riding:boolean}
export type EncounterEvent='started'|'player-hit'|'opponent-hit'|'defeated'|'knocked-out';
export interface EncounterSimulationOptions {
  player:()=>EncounterPlayer;
  onIncident?:()=>void;
  onEvent?:(event:EncounterEvent)=>void;
  protectedPoints?:Point[];
  /** Must be true only when the host actually renders the player's strike. */
  animationAvailable?:boolean;
}
export interface EncounterState {
  phase:'idle'|'active'|'defeated'|'knocked-out';position:Point;heading:number;
  playerHealth:number;opponentHealth:number;stamina:number;playerPunch:number;opponentPunch:number;
  punchesThrown:number;hits:number;opponentHits:number;travelled:number;playerAnimationAvailable:boolean;
}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const finitePlayer=(player:EncounterPlayer)=>player.position.length===2&&player.position.every(Number.isFinite)&&Number.isFinite(player.heading);
const routeDistance=(point:Point,route:Point[])=>{let d=Infinity;for(let i=1;i<route.length;i++)d=Math.min(d,segmentDistance(point,route[i-1],route[i]));return d;};
/** Select a free point on a source walking street, outside all quest interaction zones. */
export function planEncounterPoint(city:CityRuntime,ground:GroundCheck,anchor:Point):Point|undefined {
  const points:Point[]=[];
  for(const road of city.roads){
    if(!['footway','pedestrian','living_street'].includes(road.highway))continue;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],span=distance(a,b),count=Math.max(1,Math.ceil(span/4));
      for(let k=0;k<=count;k++){
        const point:Point=[a[0]+(b[0]-a[0])*k/count,a[1]+(b[1]-a[1])*k/count],d=distance(point,anchor);
        if(d<15||d>90||[city.pickup,city.delivery,city.spawn].some(p=>distance(p,point)<12)||routeDistance(point,city.route)<2.2)continue;
        if(ground(...point,.55)&&ground(point[0]+.8,point[1],.5)&&ground(point[0]-.8,point[1],.5)&&ground(point[0],point[1]+.8,.5)&&ground(point[0],point[1]-.8,.5))points.push(point);
      }
    }
  }
  points.sort((a,b)=>Math.abs(distance(a,anchor)-35)-Math.abs(distance(b,anchor)-35)||a[0]-b[0]||a[1]-b[1]);
  return points[0];
}
export function encounterLineClear(a:Point,b:Point,ground:GroundCheck):boolean {
  const count=Math.max(1,Math.ceil(distance(a,b)/.2));
  for(let i=1;i<count;i++){const t=i/count;if(!ground(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.12))return false;}
  return true;
}
export function encounterStrikeHits(origin:Point,heading:number,target:Point,ground:GroundCheck):boolean {
  const d=distance(origin,target);if(d>1.65||d<.15)return false;
  const dot=(Math.sin(heading)*(target[0]-origin[0])+Math.cos(heading)*(target[1]-origin[1]))/d;
  return dot>=.5&&encounterLineClear(origin,target,ground);
}

export function createEncounterSimulation(position:Point,ground:GroundCheck,options:EncounterSimulationOptions){
  const state:EncounterState={phase:'idle',position:[...position],heading:0,playerHealth:100,opponentHealth:100,stamina:100,playerPunch:-1,opponentPunch:-1,punchesThrown:0,hits:0,opponentHits:0,travelled:0,playerAnimationAvailable:options.animationAvailable??false};
  let playerCooldown=0,opponentCooldown=1.5,age=0,startedAt=0,playerStruck=false,opponentStruck=false;
  function start(){if(state.phase==='idle'){state.phase='active';startedAt=age;options.onEvent?.('started');}}
  function attack(){
    const player=options.player();
    if(!state.playerAnimationAvailable||!finitePlayer(player)||player.riding||state.phase==='defeated'||state.phase==='knocked-out'||playerCooldown>0||state.stamina<25)return false;
    state.stamina-=25;state.playerPunch=0;state.punchesThrown++;playerCooldown=.7;playerStruck=false;return true;
  }
  function update(dt:number){
    if(!Number.isFinite(dt)||dt<=0||dt>.25)return;
    const player=options.player();if(!finitePlayer(player))return;age+=dt;
    playerCooldown=Math.max(0,playerCooldown-dt);opponentCooldown=Math.max(0,opponentCooldown-dt);state.stamina=Math.min(100,state.stamina+dt*14);
    if(state.phase==='defeated'||state.phase==='knocked-out'){state.playerPunch=-1;state.opponentPunch=-1;return;}
    if(!player.riding&&distance(player.position,state.position)<8&&encounterLineClear(state.position,player.position,ground))start();
    if(state.playerPunch>=0){
      state.playerPunch+=dt;
      if(!playerStruck&&state.playerPunch>=.17){
        playerStruck=true;
        if(!player.riding&&encounterStrikeHits(player.position,player.heading,state.position,ground)){
          start();state.opponentHealth=Math.max(0,state.opponentHealth-25);state.hits++;options.onIncident?.();options.onEvent?.('opponent-hit');
          if(state.opponentHealth===0){state.phase='defeated';options.onEvent?.('defeated');return;}
        }
      }
      if(state.playerPunch>.45)state.playerPunch=-1;
    }
    if(state.phase!=='active'||player.riding)return;
    const d=distance(state.position,player.position);
    state.heading=Math.atan2(player.position[0]-state.position[0],player.position[1]-state.position[1]);
    if(d>1.35&&d<24&&state.opponentPunch<0){
      const step=Math.min(d-1.3,dt*1.65),unit:Point=[(player.position[0]-state.position[0])/d,(player.position[1]-state.position[1])/d],p={x:state.position[0],z:state.position[1]};
      const permitted:GroundCheck=(x,z,r)=>ground(x,z,r)&&distance([x,z],player.position)>r+.52&&!(options.protectedPoints??[]).some(target=>distance([x,z],target)<10);
      const moved=moveOnGround(p,{x:unit[0]*step,z:unit[1]*step},.45,permitted,true,.15);state.position=[p.x,p.z];state.travelled+=moved.distance;
    }
    if(age-startedAt>2&&opponentCooldown<=0&&state.opponentPunch<0&&encounterStrikeHits(state.position,state.heading,player.position,ground)){
      state.opponentPunch=0;opponentStruck=false;opponentCooldown=1.5;
    }
    if(state.opponentPunch>=0){
      state.opponentPunch+=dt;
      if(!opponentStruck&&state.opponentPunch>=.22){
        opponentStruck=true;
        if(!player.riding&&encounterStrikeHits(state.position,state.heading,player.position,ground)){
          state.playerHealth=Math.max(0,state.playerHealth-12);state.opponentHits++;options.onEvent?.('player-hit');
          if(state.playerHealth===0){state.phase='knocked-out';options.onEvent?.('knocked-out');}
        }
      }
      if(state.opponentPunch>.5)state.opponentPunch=-1;
    }
  }
  function canStand(x:number,z:number,radius=.5){
    if(!ground(x,z,radius))return false;
    return state.phase==='defeated'||state.phase==='knocked-out'||distance([x,z],state.position)>=radius+.45;
  }
  return {state,attack,update,canStand};
}

