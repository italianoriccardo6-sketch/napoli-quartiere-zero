import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {buildCampaign,advanceCampaign,decodeCampaign,campaignReward,initialCampaign} from '../src/campaign';
import type {CityMapData} from '../src/city-data';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createCityWorld} from '../src/city-world';
import {parseCityElevationGrid} from '../src/city-elevation';
import {createCityTerrainPolicy} from '../src/city-terrain-policy';
import {openingStreetData} from '../src/vehicle-placement';
import {moveOnGround} from '../src/movement';
import type {Point} from '../src/geo';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
test('follow-up campaign uses measured route positions, awards once and persists a bounded checkpoint',()=>{
 const stops=buildCampaign(map.city!,()=>true),before=JSON.stringify(map.city);assert.equal(stops.length,9);let state=initialCampaign();
 for(const stop of stops){assert.equal(advanceCampaign(state,stops,stop.position,true),state);assert.equal(advanceCampaign(state,stops,[999999,999999],false),state);state=advanceCampaign(state,stops,stop.position,false);state=decodeCampaign(JSON.stringify(state),stops.length);}
 assert.equal(state.checkpoint,stops.length);assert.equal(campaignReward(state,stops),180);assert.equal(advanceCampaign(state,stops,stops.at(-1)!.position,false),state);assert.equal(JSON.stringify(map.city),before);
 for(const raw of ['null','{','{"version":1,"checkpoint":1000}','{"version":1,"checkpoint":-1}','{"version":1,"checkpoint":0.5}'])assert.deepEqual(decodeCampaign(raw,stops.length),initialCampaign());
});
test('campaign never activates unsafe or missing source route',()=>{assert.deepEqual(buildCampaign(map.city!,()=>false),[]);assert.deepEqual(buildCampaign({...map.city!,route:[]},()=>true),[]);});


test('actual graded Napoli: all nine campaign stops are safe and reachable with the production walking controller',()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try{
    const city=map.city!,before=JSON.stringify(map),elevation=parseCityElevationGrid(JSON.parse(readFileSync('public/data/city-elevation.json','utf8')));
    const terrain=createCityTerrainPolicy(elevation,openingStreetData(city).scooter),world=createCityWorld(scene,map,city,{terrain});
    const stops=buildCampaign(city,world.canStand);assert.equal(stops.length,9,'all follow-up stops must activate against the actual geography');
    const cumulative=[0];for(let i=1;i<city.route.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(city.route[i][0]-city.route[i-1][0],city.route[i][1]-city.route[i-1][1]));
    // Project destinations independently onto the original path, so the test
    // follows actual bends in either direction rather than cutting a chord
    // through measured buildings between two quest markers.
    function routeDistance(point:Point){
      let nearest=Infinity,along=NaN;
      for(let i=1;i<city.route.length;i++){
        const a=city.route[i-1],b=city.route[i],dx=b[0]-a[0],dz=b[1]-a[1],span2=dx*dx+dz*dz;if(!span2)continue;
        const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/span2)),distance=Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t);
        if(distance<nearest){nearest=distance;along=cumulative[i-1]+Math.sqrt(span2)*t;}
      }
      assert.ok(nearest<1e-6,'a campaign destination must lie on the original measured mission path');return along;
    }
    const walker=new Vector3(city.route[0][0],world.surfaceHeightAt!(...city.route[0]),city.route[0][1]);
    let state=initialCampaign(),currentDistance=0,steps=0,traversed=0,minimum=walker.y,maximum=walker.y;
    for(const stop of stops){
      assert.equal(world.canStand(...stop.position,.55),true,'full pedestrian clearance at '+stop.id);
      const destination=routeDistance(stop.position),outbound=destination>=currentDistance;
      const vertices=city.route.map((p,i)=>({point:p,distance:cumulative[i]})).filter(v=>outbound?v.distance>currentDistance+1e-6&&v.distance<destination-1e-6:v.distance<currentDistance-1e-6&&v.distance>destination+1e-6);
      if(!outbound)vertices.reverse();
      for(const target of [...vertices.map(v=>v.point),stop.position]){
        let remaining=Math.hypot(target[0]-walker.x,target[1]-walker.z),guard=0;
        while(remaining>1e-6&&guard++<10000){
          const span=Math.min(.18,remaining),result=moveOnGround(walker,{x:(target[0]-walker.x)/remaining*span,z:(target[1]-walker.z)/remaining*span},.5,world.canStand,true);
          assert.equal(result.collision,false,'controller route stays clear en route to '+stop.id);traversed+=result.distance;
          walker.y=world.surfaceHeightAt!(walker.x,walker.z);assert.ok(Number.isFinite(walker.y));minimum=Math.min(minimum,walker.y);maximum=Math.max(maximum,walker.y);steps++;
          remaining=Math.hypot(target[0]-walker.x,target[1]-walker.z);
        }
        assert.ok(remaining<1e-6,'controller reaches the source path vertex');
      }
      const next=advanceCampaign(state,stops,[walker.x,walker.z],false);assert.equal(next.checkpoint,state.checkpoint+1,'one interaction advances exactly one destination');state=decodeCampaign(JSON.stringify(next),stops.length);
      assert.equal(advanceCampaign(state,stops,[walker.x,walker.z],false),state,'repeated interaction cannot advance or reward a distant next stop');
      currentDistance=destination;
    }
    assert.ok(steps>10000&&traversed>2000,'the test walks the full multi-stage itinerary, rather than teleporting markers');
    assert.ok(maximum-minimum>3,'the route retains real relative terrain variation');
    assert.equal(campaignReward(state,stops),180);assert.equal(state.checkpoint,stops.length);assert.equal(JSON.stringify(map),before);
  }finally{scene.dispose();engine.dispose();}
});
