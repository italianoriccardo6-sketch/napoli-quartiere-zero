import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {CityMapData} from '../src/city-data';
import {createPhotoDrivingSimulation,createPhotoSourceCollision} from '../src/photo-driving';
import {planEncounterPoint,createEncounterSimulation,type EncounterPlayer} from '../src/encounter-simulation';

test('native photographic encounter uses the same source space and requires a real strike renderer',()=>{
  const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData,source=createPhotoSourceCollision(map),driver=createPhotoDrivingSimulation(map),before=JSON.stringify(map);
  const position=planEncounterPoint(map.city!,source.canStand,driver.activePosition);assert.ok(position);assert.equal(source.canStand(...position,.55),true);
  let player:EncounterPlayer={position:[position[0],position[1]-1.5],heading:0,riding:false};
  const unavailable=createEncounterSimulation(position,()=>true,{player:()=>player});assert.equal(unavailable.attack(),false,'a photographic host without a real rendered hand cannot claim a strike');
  const events:string[]=[],sim=createEncounterSimulation(position,()=>true,{player:()=>player,animationAvailable:true,onEvent:event=>events.push(event)});
  assert.equal(sim.attack(),true);assert.equal(sim.state.playerPunch,0);assert.equal(sim.attack(),false);
  for(let i=0;i<5;i++)sim.update(.04);
  assert.ok(sim.state.playerPunch>=.17&&sim.state.playerPunch<=.25,'native hand transform gets the actual impact envelope age');
  assert.equal(sim.state.hits,1);assert.equal(sim.state.opponentHealth,75);assert.ok(events.includes('opponent-hit'));
  player={...player,riding:true};for(let i=0;i<20;i++)sim.update(.04);assert.equal(sim.attack(),false);
  assert.equal(JSON.stringify(map),before);
});
