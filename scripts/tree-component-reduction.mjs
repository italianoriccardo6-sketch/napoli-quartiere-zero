import {inflateSync} from 'node:zlib';

// Original 16-bit grayscale PNG, decoded without changing or re-encoding bytes.
export function readAlphaPNG(bytes){
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG signature.');
  let width,height,depth,channels;const idat=[];
  for(let offset=8;offset<bytes.length;){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);offset+=12+length;
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];channels=data[9];if(depth!==16||channels!==0||data[10]||data[11]||data[12])throw Error('Expected unchanged noninterlaced 16-bit grayscale mask.');}
    if(type==='IDAT')idat.push(data);if(type==='IEND')break;
  }
  if(!width||!height||width*height>4*1024*1024)throw Error('Unexpected alpha dimensions.');
  const stride=width*2,raw=inflateSync(Buffer.concat(idat)),scan=Buffer.alloc(stride*height);
  if(raw.length!==(stride+1)*height)throw Error('Alpha scanline length mismatch.');
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw Error('Invalid PNG scanline filter.');for(let x=0;x<stride;x++){const left=x>=2?scan[y*stride+x-2]:0,up=y?scan[(y-1)*stride+x]:0,upperLeft=y&&x>=2?scan[(y-1)*stride+x-2]:0;const prediction=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);scan[y*stride+x]=(raw[y*(stride+1)+1+x]+prediction)&255;}}
  const values=new Float32Array(width*height);for(let i=0;i<values.length;i++)values[i]=scan.readUInt16BE(i*2)/65535;
  return {width,height,values,bitDepth:depth,normalization:65535};
}
const radicalInverse=i=>{let value=0,base=.5;while(i){value+=(i&1)*base;i>>>=1;base*=.5;}return value;};
const samples=Array.from({length:64},(_,i)=>{const s=Math.sqrt((i+.5)/64),b=radicalInverse(i);return [1-s,s*(1-b),s*b];});
function alphaAt(mask,u,v){const x=u*mask.width-.5,y=v*mask.height-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,wrap=(i,size)=>(i%size+size)%size;const x0=wrap(ix,mask.width),x1=wrap(ix+1,mask.width),y0=wrap(iy,mask.height)*mask.width,y1=wrap(iy+1,mask.height)*mask.width;return (mask.values[y0+x0]*(1-fx)+mask.values[y0+x1]*fx)*(1-fy)+(mask.values[y1+x0]*(1-fx)+mask.values[y1+x1]*fx)*fy;}
export function metricIndices(indices,positions,uvs,mask){
  let surfaceArea=0,uvArea=0,alphaArea=0,flippedAlphaArea=0,degenerateTriangles=0;
  for(let t=0;t<indices.length;t+=3){const a=indices[t],b=indices[t+1],c=indices[t+2],ax=positions[a*3],ay=positions[a*3+1],az=positions[a*3+2],bx=positions[b*3]-ax,by=positions[b*3+1]-ay,bz=positions[b*3+2]-az,cx=positions[c*3]-ax,cy=positions[c*3+1]-ay,cz=positions[c*3+2]-az,area=.5*Math.hypot(by*cz-bz*cy,bz*cx-bx*cz,bx*cy-by*cx);if(area<=1e-14){degenerateTriangles++;continue;}surfaceArea+=area;
    const au=uvs[a*2],av=uvs[a*2+1],bu=uvs[b*2],bv=uvs[b*2+1],cu=uvs[c*2],cv=uvs[c*2+1];uvArea+=.5*Math.abs((bu-au)*(cv-av)-(bv-av)*(cu-au));
    if(mask){let passed=0,flippedPassed=0;for(const [wa,wb,wc]of samples){const u=au*wa+bu*wb+cu*wc,v=av*wa+bv*wb+cv*wc;if(alphaAt(mask,u,v)>=.55)passed++;if(alphaAt(mask,u,1-v)>=.55)flippedPassed++;}alphaArea+=area*passed/64;flippedAlphaArea+=area*flippedPassed/64;}
  }
  return {triangles:indices.length/3,surfaceArea,uvArea,alphaArea:mask?alphaArea:surfaceArea,flippedAlphaArea:mask?flippedAlphaArea:surfaceArea,degenerateTriangles};
}
export function componentPartition(indices,count){
  const parent=new Uint32Array(count);for(let i=0;i<count;i++)parent[i]=i;
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};for(let i=0;i<indices.length;i+=3){join(indices[i],indices[i+1]);join(indices[i],indices[i+2]);}
  const ids=new Map(),componentByVertex=new Uint32Array(count),triangleCounts=[];componentByVertex.fill(0xffffffff);
  for(let i=0;i<indices.length;i+=3){const root=find(indices[i]);if(!ids.has(root)){ids.set(root,ids.size);triangleCounts.push(0);}triangleCounts[ids.get(root)]++;}
  for(const index of indices)componentByVertex[index]=ids.get(find(index));
  const offsets=new Uint32Array(ids.size+1);for(let i=0;i<ids.size;i++)offsets[i+1]=offsets[i]+triangleCounts[i]*3;
  const cursor=offsets.slice(),grouped=new Uint32Array(indices.length);for(let i=0;i<indices.length;i+=3){const component=componentByVertex[indices[i]],offset=cursor[component];grouped.set(indices.subarray(i,i+3),offset);cursor[component]+=3;}
  const groups=Array.from({length:ids.size},(_,i)=>grouped.subarray(offsets[i],offsets[i+1]));
  return {components:ids.size,groups,retained(output){const seen=new Set();for(const index of output)seen.add(componentByVertex[index]);return seen.size;}};
}
const sumMetrics=metrics=>metrics.reduce((sum,m)=>{for(const key of ['triangles','surfaceArea','uvArea','alphaArea','flippedAlphaArea','degenerateTriangles'])sum[key]+=m[key];return sum;},{triangles:0,surfaceArea:0,uvArea:0,alphaArea:0,flippedAlphaArea:0,degenerateTriangles:0});
const quantiles=values=>{const sorted=values.slice().sort((a,b)=>a-b);return Object.fromEntries([0,.01,.1,.5,.9,.99,1].map(q=>[String(q),sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))]]));};
const histogram=(values,edges)=>edges.map((edge,i)=>({minimum:edge,maximumExclusive:edges[i+1]??null,count:values.filter(value=>value>=edge&&(edges[i+1]===undefined||value<edges[i+1])).length}));
export function componentHistograms(metrics){const edges=[0,1e-10,1e-8,1e-6,1e-5,1e-4,1e-3,1e-2,.1,1];return {count:metrics.length,totals:sumMetrics(metrics),triangleQuantiles:quantiles(metrics.map(m=>m.triangles)),triangles:histogram(metrics.map(m=>m.triangles),[0,1,2,3,4,5,9,17,33,65,129,257,1025]),surfaceAreaQuantiles:quantiles(metrics.map(m=>m.surfaceArea)),surfaceArea:histogram(metrics.map(m=>m.surfaceArea),edges),uvAreaQuantiles:quantiles(metrics.map(m=>m.uvArea)),uvArea:histogram(metrics.map(m=>m.uvArea),edges),alphaAreaQuantiles:quantiles(metrics.map(m=>m.alphaArea)),alphaArea:histogram(metrics.map(m=>m.alphaArea),edges),flippedAlphaAreaQuantiles:quantiles(metrics.map(m=>m.flippedAlphaArea)),flippedAlphaArea:histogram(metrics.map(m=>m.flippedAlphaArea),edges)};}
function localGeometry(source,indices){const remap=new Map(),globalVertices=[],localIndices=new Uint32Array(indices.length);for(let i=0;i<indices.length;i++){const global=indices[i];if(!remap.has(global)){remap.set(global,remap.size);globalVertices.push(global);}localIndices[i]=remap.get(global);}const positions=new Float32Array(globalVertices.length*3),attributes=new Float32Array(globalVertices.length*5);for(let v=0;v<globalVertices.length;v++){const old=globalVertices[v];positions.set(source.positions.subarray(old*3,old*3+3),v*3);attributes.set(source.attributes.subarray(old*5,old*5+5),v*5);}return {positions,attributes,indices:localIndices,globalVertices};}
function conservation(candidate,original){const importance=original.alphaArea+.1*original.surfaceArea;return importance>0?(Math.min(candidate.alphaArea,original.alphaArea)+.1*Math.min(candidate.surfaceArea,original.surfaceArea))/importance:1;}
const areaKeys=['surfaceArea','uvArea','alphaArea','flippedAlphaArea'];
const candidateLimits={maximumSurfaceAreaRatio:1.05,maximumUVAreaRatio:1.10,maximumAlphaAreaRelativeGrowth:.20,alphaAreaAbsoluteGrowthTolerance:'original component surfaceArea / 64 (one sample quantum)',minimumSurfaceAreaRatio:.20,minimumAlphaAreaRatio:.10};
const areaRatio=(value,original)=>original>1e-12?value/original:value<=1e-12?1:null;
function geometryAcceptable(candidate,original){return areaKeys.every(key=>Number.isFinite(candidate[key]))&&candidate.triangles>0&&candidate.degenerateTriangles<candidate.triangles&&candidate.surfaceArea>=original.surfaceArea*candidateLimits.minimumSurfaceAreaRatio&&candidate.surfaceArea<=original.surfaceArea*candidateLimits.maximumSurfaceAreaRatio+1e-14&&candidate.uvArea<=original.uvArea*candidateLimits.maximumUVAreaRatio+1e-14;}
function alphaAcceptable(candidate,original){
  // Only the verified, unchanged runtime orientation guides selection and
  // rejection. Flipped alpha coverage remains a recorded diagnostic.
  for(const key of ['alphaArea']){
    if(original[key]>1e-12&&candidate[key]<original[key]*candidateLimits.minimumAlphaAreaRatio)return false;
    const allowedGrowth=Math.max(original[key]*candidateLimits.maximumAlphaAreaRelativeGrowth,original.surfaceArea/64);
    if(!Number.isFinite(candidate[key])||candidate[key]>original[key]+allowedGrowth+1e-14)return false;
  }
  return true;
}
export function inspectLeafComponents(source,mask){
  const sourceMetrics=source.components.groups.map(indices=>metricIndices(indices,source.positions,source.uvs,mask));
  return {sourceMetrics,histogram:componentHistograms(sourceMetrics)};
}
export function prepareLeafComponents(source,mask,simplifier,inspection=inspectLeafComponents(source,mask)){
  const {sourceMetrics,histogram}=inspection,entries=[],rejectedCandidates={geometry:0,alpha:0};
  if(sourceMetrics.length!==source.components.groups.length)throw Error('Leaf inspection/component partition mismatch.');
  for(let id=0;id<source.components.groups.length;id++){
    const originalIndices=source.components.groups[id],original=sourceMetrics[id],local=localGeometry(source,originalIndices),options=[{indices:originalIndices,metrics:original,targetTriangles:original.triangles,error:0,errorLimit:0,score:1}],evaluated=new Map();
    if(original.surfaceArea>1e-12){for(const target of [2,4,6,8,12,16,24,32,48,64,96]){if(original.triangles<=target)continue;let best;
      // Rank cheap simplifier attempts first; do not alpha-sample a 48-face
      // intermediate if a later attempt reaches the requested two faces.
      const attempts=new Map();
      for(const errorLimit of [.01,.03,.1,.3,1]){
        const [reduced,error]=simplifier.simplifyWithAttributes(local.indices,local.positions,3,local.attributes,5,[1,1,1,.5,.5],null,target*3,errorLimit,[]);
        if(!reduced.length||!Number.isFinite(error))continue;
        const previous=attempts.get(reduced.length);if(!previous||error<previous.error)attempts.set(reduced.length,{reduced,error,errorLimit});
        if(reduced.length<=target*3)break;
      }
      for(const {reduced,error,errorLimit}of [...attempts.values()].sort((a,b)=>a.reduced.length-b.reduced.length||a.error-b.error)){
        const indices=Uint32Array.from(reduced,index=>local.globalVertices[index]);
        // Equal index lists recur across target/error trials; reuse their exact
        // metrics, including a cached rejection, rather than sampling twice.
        const signature=indices.join(',');let metrics=evaluated.get(signature);
        if(metrics===false)continue;
        if(!metrics){
          const geometry=metricIndices(indices,source.positions,source.uvs,null);
          if(!geometryAcceptable(geometry,original)){rejectedCandidates.geometry++;evaluated.set(signature,false);continue;}
          metrics=mask?metricIndices(indices,source.positions,source.uvs,mask):geometry;
          if(!alphaAcceptable(metrics,original)){rejectedCandidates.alpha++;evaluated.set(signature,false);continue;}
          evaluated.set(signature,metrics);
        }
        best={indices,metrics,targetTriangles:target,error,errorLimit,score:conservation(metrics,original)};break;
      }
      if(best&&!options.some(option=>option.metrics.triangles===best.metrics.triangles&&option.score>=best.score))options.push(best);
    }}
    options.sort((a,b)=>a.metrics.triangles-b.metrics.triangles||b.score-a.score);entries.push({id,original,options});
    if((id+1)%5000===0)console.log('COMPONENT_CANDIDATES '+JSON.stringify({completed:id+1,total:source.components.groups.length}));
  }
  return {entries,sourceMetrics,histogram,rejectedCandidates,candidateLimits};
}
export function chooseLeafLOD(prepared,preferredFaces,budget,options={}){
  const desiredAggregateRetention=options.desiredAggregateRetention??(preferredFaces>=4?.90:.70);
  if(!Number.isFinite(desiredAggregateRetention)||desiredAggregateRetention<0||desiredAggregateRetention>1)throw Error('Invalid desired aggregate leaf retention.');
  // Candidate lists are ordered by triangle count, then descending score.
  // Spend no budget on a preferred face count before comparing absolute area.
  const selected=prepared.entries.map(entry=>entry.options[0]);
  let triangles=selected.reduce((sum,option)=>sum+option.metrics.triangles,0);
  if(triangles>budget)throw Error('Component-preserving seed exceeds leaf budget; no components were pruned: '+JSON.stringify({triangles,budget,preferredFaces}));
  const heap=[],higher=(a,b)=>a.priority>b.priority||(a.priority===b.priority&&(a.id<b.id||(a.id===b.id&&a.extra<b.extra)));
  function push(upgrade){if(!upgrade)return;let index=heap.length;heap.push(upgrade);while(index){const parent=(index-1)>>1;if(!higher(heap[index],heap[parent]))break;[heap[index],heap[parent]]=[heap[parent],heap[index]];index=parent;}}
  function pop(){const result=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let index=0;while(true){const left=index*2+1,right=left+1;let best=index;if(left<heap.length&&higher(heap[left],heap[best]))best=left;if(right<heap.length&&higher(heap[right],heap[best]))best=right;if(best===index)break;[heap[index],heap[best]]=[heap[best],heap[index]];index=best;}}return result;}
  function bestUpgrade(entry,remaining){
    const current=selected[entry.id],importance=entry.original.alphaArea+.1*entry.original.surfaceArea;let best;
    for(const option of entry.options){const extra=option.metrics.triangles-current.metrics.triangles,gain=(option.score-current.score)*importance;if(extra<=0||extra>remaining||gain<=0)continue;const upgrade={id:entry.id,option,extra,gain,priority:gain/extra};if(!best||higher(upgrade,best))best=upgrade;}
    return best;
  }
  for(const entry of prepared.entries)push(bestUpgrade(entry,budget-triangles));
  let appliedUpgrades=0;
  while(heap.length){
    const upgrade=pop(),entry=prepared.entries[upgrade.id],remaining=budget-triangles;
    // Another component may have consumed the room for this proposal. Select
    // its best smaller fitting option rather than dropping the component.
    if(upgrade.extra>remaining){push(bestUpgrade(entry,remaining));continue;}
    selected[upgrade.id]=upgrade.option;triangles+=upgrade.extra;appliedUpgrades++;
    // Recompute this component's actual marginal gain after every upgrade;
    // seed-relative priorities must not consume the remaining area budget.
    push(bestUpgrade(entry,budget-triangles));
  }
  const indices=new Uint32Array(triangles*3);let offset=0;for(const option of selected){indices.set(option.indices,offset);offset+=option.indices.length;}
  const totals=sumMetrics(selected.map(option=>option.metrics)),original=prepared.histogram.totals,ratios=Object.fromEntries(areaKeys.map(key=>[key,areaRatio(totals[key],original[key])])),retention={},componentAreaRatioQuantiles={},componentRetainedAreaRatioQuantiles={};
  for(const key of areaKeys){
    let retainedArea=0,lossArea=0,growthArea=0;const componentRatios=[];
    for(let id=0;id<selected.length;id++){
      const before=prepared.entries[id].original[key],after=selected[id].metrics[key];retainedArea+=Math.min(before,after);lossArea+=Math.max(0,before-after);growthArea+=Math.max(0,after-before);componentRatios.push(areaRatio(after,before)??1);
    }
    retention[key]={retainedArea,retainedRatio:areaRatio(retainedArea,original[key]),lossArea,lossRatio:original[key]>1e-12?lossArea/original[key]:0,growthArea,growthRatio:original[key]>1e-12?growthArea/original[key]:growthArea>1e-12?null:0};
    componentAreaRatioQuantiles[key]=quantiles(componentRatios);componentRetainedAreaRatioQuantiles[key]=quantiles(componentRatios.map(ratio=>Math.max(0,Math.min(1,ratio))));
  }
  return {indices,metrics:{algorithm:'independent-connected-index-components, source-vertex-subset, no prune/permissive, dynamic actual-alpha-area-prioritized upgrades',seedStrategy:'minimum valid triangle count per original component; preferredFaces is a diagnostic LOD hint only',score:'(clamped actual alphaArea + .1 * clamped surfaceArea) / (original alphaArea + .1 * original surfaceArea)',appliedUpgrades,preferredFacesPerComponent:preferredFaces,budget,sourceComponents:prepared.entries.length,retainedSourceComponents:selected.filter(option=>option.indices.length).length,sourceAreas:original,areas:totals,retainedAreaRatios:ratios,clampedComponentRetention:retention,componentAreaRatioQuantiles,componentRetainedAreaRatioQuantiles,desiredAggregateRetention:{ratio:desiredAggregateRetention,diagnosticOnly:true,optimizationOrientation:'image(v), verified unchanged runtime UV0 orientation',metBy:Object.fromEntries(areaKeys.map(key=>[key,retention[key].retainedRatio>=desiredAggregateRetention]))},candidateLimits:prepared.candidateLimits,rejectedCandidates:prepared.rejectedCandidates,selectedTriangleHistogram:histogram(selected.map(option=>option.metrics.triangles),[0,1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257]),originalComponentsRetainedUnreduced:selected.filter((option,id)=>option.metrics.triangles===prepared.entries[id].original.triangles).length,maximumReportedError:selected.reduce((maximum,option)=>Math.max(maximum,option.error),0),sampleMethod:'64 uniform-area Hammersley samples per triangle; raw 16-bit mask /65535, bilinear repeat, cutoff .55; verified image(v) uses top-down PNG row v*H and guides optimization; image(1-v) is diagnostic only'}};
}
