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
