import {mkdir, writeFile} from 'node:fs/promises';

// The endpoint, field names/types and query operation were verified in the
// official ArcGIS REST directory. This script never downloads a raster tile.
const layer = 'https://geomaps.regione.campania.it/federated/rest/services/DG5009/CTR2020_v2/MapServer/2';
const bbox = {west:14.2410, south:40.8260, east:14.2660, north:40.8420};
const types = ['16110000', '16110300'];
const limit = 250;
const output = 'data/napoli-terrain-points';
const maxBytes = 2 * 1024 * 1024;
const licensePage = 'https://sit.regione.campania.it/carta-tecnica-regionale';
const diagnostic = {
  status:'not_started',
  usable_as_terrain:false,
  maximum_rows:limit,
  bbox_wgs84:bbox,
  returned_horizontal_crs:null,
  returned_finite_xy_extent:null,
  first_three_points:[],
};

async function requestJSON(url, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {'Accept':'application/json', 'User-Agent':'NapoliQuartiereZero/0.3 (bounded public cartographic research)'},
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from the official terrain service`);
  if (!response.body) throw new Error('Empty response body');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error('Response exceeds the 2 MiB research limit');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const json = JSON.parse(raw);
  if (json.error) throw new Error(`ArcGIS ${json.error.code ?? 'error'}: ${json.error.message ?? 'request rejected'}`);
  return {raw, json};
}

async function main() {
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/validation.json`,JSON.stringify(diagnostic,null,2)+'\n');
  const metadataURL = `${layer}?f=pjson`;
  const metadata = await requestJSON(metadataURL, 25000);
  // Keep the exact response even if its schema or a later point fails validation.
  await writeFile(`${output}/layer-metadata.json`,metadata.raw);
  diagnostic.status='metadata_received';
  const typeField = metadata.json.fields?.find(field => field.name === 'TIPO');
  if (typeField?.type !== 'esriFieldTypeString') throw new Error('Official TIPO field is absent or no longer a string');
  if (metadata.json.geometryType !== 'esriGeometryPoint' || metadata.json.hasZ !== true) {
    throw new Error('Official layer no longer declares point geometry with Z coordinates');
  }
  for (const name of ['OBJECTID', 'Descr']) {
    if (!metadata.json.fields.some(field => field.name === name)) throw new Error(`Expected official field missing: ${name}`);
  }

  const parameters = {
    f:'pjson',
    where:`TIPO IN ('${types.join("','")}')`,
    geometry:JSON.stringify({xmin:bbox.west,ymin:bbox.south,xmax:bbox.east,ymax:bbox.north,spatialReference:{wkid:4326}}),
    geometryType:'esriGeometryEnvelope',
    inSR:'4326',
    spatialRel:'esriSpatialRelIntersects',
    outFields:'OBJECTID,TIPO,Descr',
    outSR:'4326',
    returnGeometry:'true',
    returnZ:'true',
    returnM:'false',
    orderByFields:'OBJECTID ASC',
    resultOffset:'0',
    resultRecordCount:String(limit),
  };
  const queryURL = `${layer}/query?${new URLSearchParams(parameters)}`;
  await writeFile(`${output}/source.json`,JSON.stringify({
    status:'Unvalidated diagnostic response only; NOT usable as terrain.',
    provider:'Regione Campania — Sistema Informativo Territoriale',
    source_year:2020,
    retrieved_at:new Date().toISOString(),
    license:'CC-BY-4.0',
    license_url:'https://creativecommons.org/licenses/by/4.0/',
    license_declaration:licensePage,
    attribution:'Regione Campania — Dati pubblicati dal Servizio SIT, cartografia 2020',
    metadata_url:metadataURL,query_url:queryURL,query_parameters:parameters,
    bbox_wgs84:bbox,maximum_rows:limit,vertical_reference:null,vertical_units:null,
    vertical_warning:'Vertical units/datum not verified. No scene activation.',
  },null,2)+'\n');
  const result = await requestJSON(queryURL, 35000);
  await writeFile(`${output}/points.raw.json`,result.raw);
  const features = result.json.features;
  diagnostic.status='response_received_unvalidated';
  diagnostic.returned_horizontal_crs=result.json.spatialReference ?? null;
  if (Array.isArray(features)) {
    diagnostic.feature_count=features.length;
    diagnostic.first_three_points=features.slice(0,3).map(point=>({geometry:point.geometry??null,attributes:point.attributes??null}));
    const xy=features.map(point=>point.geometry).filter(g=>g && Number.isFinite(g.x) && Number.isFinite(g.y));
    if(xy.length) diagnostic.returned_finite_xy_extent={
      xmin:Math.min(...xy.map(g=>g.x)),xmax:Math.max(...xy.map(g=>g.x)),
      ymin:Math.min(...xy.map(g=>g.y)),ymax:Math.max(...xy.map(g=>g.y)),
    };
  }
  await writeFile(`${output}/validation.json`,JSON.stringify(diagnostic,null,2)+'\n');
  if (!Array.isArray(features) || features.length === 0 || features.length > limit) {
    throw new Error('The bounded query returned no points, an invalid response, or more than 250 points');
  }
  const resultSR = result.json.spatialReference;
  if (resultSR?.wkid !== 4326 && resultSR?.latestWkid !== 4326) throw new Error('Query did not declare the requested WGS84 horizontal coordinates');
  const ids = new Set();
  for (const feature of features) {
    const g = feature.geometry, a = feature.attributes;
    if (!g || ![g.x,g.y,g.z].every(Number.isFinite)) throw new Error('Point contains a missing or non-finite X, Y or Z');
    if (g.x < bbox.west-1e-7 || g.x > bbox.east+1e-7 || g.y < bbox.south-1e-7 || g.y > bbox.north+1e-7) {
      throw new Error('Point falls outside the requested small perimeter');
    }
    if (!a || !types.includes(a.TIPO) || !Number.isSafeInteger(a.OBJECTID) || ids.has(a.OBJECTID)) {
      throw new Error('Point has an invalid type/object identifier or duplicates another point');
    }
    if (a.Descr !== null && typeof a.Descr !== 'string') throw new Error('Point description has an unexpected type');
    ids.add(a.OBJECTID);
  }

  const source = {
    provider:'Regione Campania — Sistema Informativo Territoriale',
    dataset:'CTR2020_v2 — Punti, layer 2; ground/road elevation classes only',
    source_year:2020,
    publication_reference:'Decreto Dirigenziale n. 18 del 23.07.2025',
    retrieved_at:new Date().toISOString(),
    license:'CC-BY-4.0',
    license_url:'https://creativecommons.org/licenses/by/4.0/',
    license_declaration:licensePage,
    publication_url:'https://www.territorio.regione.campania.it/news-blog/cartografie-digitali-della-regione-campania',
    attribution:'Regione Campania — Dati pubblicati dal Servizio SIT, cartografia 2020',
    layer_url:layer,
    metadata_url:metadataURL,
    query_url:queryURL,
    query_parameters:parameters,
    bbox_wgs84:bbox,
    class_labels:{'16110000':'Quota Al Suolo','16110300':'Punto Quota Su Viabilità'},
    maximum_rows:limit,
    feature_count:features.length,
    truncated:result.json.exceededTransferLimit === true,
    pagination_performed:false,
    requests_performed:2,
    horizontal_crs:{query_result:'EPSG:4326',original_layer:metadata.json.extent?.spatialReference ?? null},
    vertical_reference:resultSR?.vcsWkid || resultSR?.latestVcsWkid || null,
    vertical_units:null,
    vertical_warning:'Finite Z values are preserved as returned. Vertical datum and units are not verified. No vertical transformation or gameplay-terrain activation is performed.',
    status:'Research elevation points only. This is not a raster DTM, a complete terrain, or a photorealistic city model.',
  };
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/layer-metadata.json`,metadata.raw);
  await writeFile(`${output}/points.raw.json`,result.raw);
  await writeFile(`${output}/source.json`,JSON.stringify(source,null,2)+'\n');
  await writeFile(`${output}/LICENSE-NOTICE.md`,[
    '# Punti quotati CTR 2020 — estrazione di ricerca',
    '',
    'Fonte: Regione Campania — Dati pubblicati dal Servizio SIT, cartografia 2020.',
    `La pubblicazione ufficiale dei prodotti CTR, DBT e DTM 2020 dichiara CC-BY 4.0: ${licensePage}`,
    'Licenza: https://creativecommons.org/licenses/by/4.0/ . Conservare attribuzione e indicare le modifiche.',
    'Questa estrazione seleziona soltanto punti di quota al suolo/sulla viabilità entro il perimetro dichiarato; riproietta le sole coordinate orizzontali in EPSG:4326 tramite il servizio ufficiale.',
    '',
    '**Datum verticale e unità Z non verificati. Non usare automaticamente questi punti come terreno giocabile.**',
    'Il limite di 250 righe può lasciare la selezione incompleta. Nessuna paginazione o attivazione della scena.',
    'Non si applica ai dati la licenza MIT del codice del gioco.',
    '',
  ].join('\n'));
  diagnostic.status='validated_research_points_only';
  diagnostic.vertical_reference_verified=false;
  diagnostic.vertical_units_verified=false;
  // Even validated research points are not an accepted raster/gameplay terrain.
  await writeFile(`${output}/validation.json`,JSON.stringify(diagnostic,null,2)+'\n');
  console.log(`Saved ${features.length} finite official ground/road elevation points (limit ${limit}, truncated=${source.truncated}). Vertical units/datum remain unverified; no scene activated.`);
}

main().catch(async error => {
  diagnostic.status='rejected';
  diagnostic.error=error.message;
  diagnostic.usable_as_terrain=false;
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/validation.json`,JSON.stringify(diagnostic,null,2)+'\n');
  console.error(`Terrain research extraction failed: ${error.message}`);
  console.error('Diagnostic only — NOT usable terrain:',JSON.stringify({
    returned_horizontal_crs:diagnostic.returned_horizontal_crs,
    returned_finite_xy_extent:diagnostic.returned_finite_xy_extent,
    first_three_points:diagnostic.first_three_points,
  }));
  process.exitCode=1;
});
