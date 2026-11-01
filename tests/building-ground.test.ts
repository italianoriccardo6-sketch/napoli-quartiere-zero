import test from 'node:test';
import assert from 'node:assert/strict';
import type {Footprint} from '../src/geo';
import {buildingGroundBases} from '../src/building-ground';

test('inferred flat foundations use the rendered outer footprint while retaining source geometry and building height',()=>{
  const buildings:Footprint[]=[{id:'slope',height:12,estimated:false,rings:[[[0,0],[20,0],[20,10],[0,10]],[[3,3],[7,3],[7,7],[3,7]]]}],before=JSON.stringify(buildings);
  const result=buildingGroundBases(buildings,(x,z)=>-3+(x-10)**2*.02+z*.1);
  assert.equal(result.heightAt('slope'),-3,'edge subdivision finds lower support between source corners');
  assert.equal(result.stats.samples,12);assert.equal(result.heightAt('unknown'),0);assert.equal(JSON.stringify(buildings),before);
  assert.throws(()=>buildingGroundBases(buildings,()=>NaN));assert.throws(()=>buildingGroundBases(buildings,()=>0,0));
});

const footprint=(id:string,estimated=true,height=10):Footprint=>({id,height,estimated,rings:[[[0,0],[20,0],[20,10],[0,10]],[[3,3],[7,3],[7,7],[3,7]]]});
test('fully supported unknown heights gain artistic roof clearance while known heights remain exact',()=>{
  const buildings=[footprint('estimated'),footprint('known-height',false,12)],before=structuredClone(buildings),ground=(x:number,z:number)=>-8+.9*x+1.4*z;
  let supports=0;const result=buildingGroundBases(buildings,ground,5,{supportedForHeightEstimate:()=>{supports++;return true;}});
  assert.equal(result.heightAt('estimated'),-8);assert.ok(Math.abs(result.renderHeightAt('estimated')-35.2)<1e-10);assert.equal(result.heightAt('known-height'),-8);assert.equal(result.renderHeightAt('known-height'),12);
  assert.equal(supports,12,'only source-unknown heights require the all-samples support decision');assert.equal(result.stats.adjustedRenderHeights,1);assert.equal(result.stats.unsupportedEstimates,0);assert.equal(result.stats.rejectedHeightLimit,0);assert.match(result.stats.renderHeightPolicy,/artistic/);assert.equal(result.stats.sourceHeightsModified,false);assert.deepEqual(buildings,before);
});

test('the roof uses maxima between source corners, with footprint samples no farther than five metres',()=>{
  const buildings=[footprint('midpoint')],seen:Array<[number,number]>=[];
  const result=buildingGroundBases(buildings,(x,z)=>{seen.push([x,z]);return z===0?40*Math.max(0,1-Math.abs(x-10)/10):0;},20,{supportedForHeightEstimate:()=>true});
  assert.ok(seen.some(([x,z])=>x===10&&z===0));assert.equal(result.stats.spacingMetres,5);assert.equal(result.stats.samples,12);assert.equal(result.heightAt('midpoint'),0);assert.equal(result.renderHeightAt('midpoint'),43.2,'corner-only sampling would incorrectly retain 10m');
  assert.ok(seen.every(([x,z])=>x===0||x===20||z===0||z===10),'courtyard holes do not supply outer-footprint clearance');
});

test('one unsupported footprint sample or no support callback leaves the source estimate unchanged',()=>{
  const buildings=[footprint('gap')],ground=(x:number)=>x*1.5,before=structuredClone(buildings),allSamples:Array<[number,number]>=[];
  const unsupported=buildingGroundBases(buildings,ground,5,{supportedForHeightEstimate:(x,z)=>{allSamples.push([x,z]);return x!==10||z!==0;}});
  assert.equal(allSamples.length,12);assert.equal(unsupported.renderHeightAt('gap'),10);assert.equal(unsupported.stats.adjustedRenderHeights,0);assert.equal(unsupported.stats.unsupportedEstimates,1);
  const unreviewed=buildingGroundBases(buildings,ground);assert.equal(unreviewed.renderHeightAt('gap'),10);assert.equal(unreviewed.stats.unsupportedEstimates,1);assert.deepEqual(buildings,before);
});

test('an estimate exceeding the rendering limit is rejected rather than truncated to it',()=>{
  const buildings=[footprint('too-tall')],options={supportedForHeightEstimate:()=>true};
  const rejected=buildingGroundBases(buildings,x=>x*3,5,options);assert.equal(rejected.renderHeightAt('too-tall'),10);assert.equal(rejected.stats.rejectedHeightLimit,1);assert.equal(rejected.stats.adjustedRenderHeights,0);assert.notEqual(rejected.renderHeightAt('too-tall'),60);
  const accepted=buildingGroundBases(buildings,x=>x*2.84,5,options);assert.ok(Math.abs(accepted.renderHeightAt('too-tall')-60)<1e-10);assert.equal(accepted.stats.adjustedRenderHeights,1);assert.equal(accepted.stats.rejectedHeightLimit,0);
  const custom=buildingGroundBases(buildings,x=>x,5,{...options,roofClearance:2,maximumRenderHeight:21});assert.equal(custom.renderHeightAt('too-tall'),10);assert.equal(custom.stats.rejectedHeightLimit,1);assert.equal(custom.stats.maximumRenderHeightMetres,21);
});

test('render heights retain a safe source fallback and reject nonfinite policy limits',()=>{
  const buildings=[NaN,Infinity,0,-1].map((height,i)=>footprint('invalid-'+i,true,height)),before=structuredClone(buildings),result=buildingGroundBases(buildings,()=>0,5,{supportedForHeightEstimate:()=>true});
  for(const b of buildings)assert.equal(result.renderHeightAt(b.id),10);assert.equal(result.renderHeightAt('missing'),10);assert.deepEqual(buildings,before);
  for(const roofClearance of [NaN,Infinity,0,-1])assert.throws(()=>buildingGroundBases(buildings,()=>0,5,{roofClearance}),/stima artistica/);
  for(const maximumRenderHeight of [NaN,Infinity,0,-1,61])assert.throws(()=>buildingGroundBases(buildings,()=>0,5,{maximumRenderHeight}),/stima artistica/);
});
