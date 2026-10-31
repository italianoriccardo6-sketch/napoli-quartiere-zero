/** Public metadata only. Does not authenticate, download viewer assets or approve a license. */
import {mkdir, writeFile} from 'node:fs/promises';
const outputDirectory = process.env.NAPLES_RESEARCH_OUTPUT || 'work/naples-model-research';
const models = [
  {uid: 'cc63ef6207f9493c9a90778a3a3d84b1', expectedTitle: "Castel dell'Ovo, Naples - ITA", expectedAuthor: 'Clodian01'},
  {uid: 'dde27b393d3548fe951ce5045c4e6298', expectedTitle: "Castel dell'Ovo,castle,napoli,scan,map", expectedAuthor: 'SENSIET'},
];
await mkdir(outputDirectory, {recursive: true});
const results = [];
for (const model of models) {
  const url = `https://api.sketchfab.com/v3/models/${model.uid}`;
  const record = {model: model.uid, source: url, fetchedAt: new Date().toISOString(), expectedTitle: model.expectedTitle,
    expectedAuthor: model.expectedAuthor, approvedForDistribution: false};
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(20000), headers: {'Accept': 'application/json', 'User-Agent': 'NapoliQuartiereZero-AssetResearch/1.0'}, redirect: 'error'});
    record.httpStatus = response.status;
    if (!response.ok) throw new Error(`Public metadata endpoint returned HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 524288) throw new Error('Metadata exceeds 512 KiB limit');
    const reader = response.body.getReader();
    const parts = []; let total = 0;
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > 524288) {await reader.cancel(); throw new Error('Metadata exceeds 512 KiB limit');}
      parts.push(value);
    }
    const raw = Buffer.concat(parts.map(part => Buffer.from(part))).toString('utf8');
    const json = JSON.parse(raw);
    if (json.uid !== model.uid) throw new Error('Returned model UID differs from requested UID');
    record.title = json.name; record.author = json.user?.displayName ?? json.user?.username ?? null;
    record.modelPage = json.viewerUrl ?? `https://sketchfab.com/models/${model.uid}`;
    record.license = json.license ?? null; record.isDownloadable = json.isDownloadable ?? null;
    record.faceCount = json.faceCount ?? null; record.vertexCount = json.vertexCount ?? null;
    record.description = json.description ?? ''; record.downloadSize = null;
    record.sourceWarning = /google|earth|maps|esri|bing/i.test(record.description)
      ? 'Description mentions third-party mapping imagery. Verify original-source export rights before any use.' : null;
    record.reviewRequired = ['Confirm author and capture provenance; title alone does not prove photogrammetry.',
      'Check the exact asset license, original-source rights and any heritage-property conditions.',
      'Sketchfab Download API requires authorized user authentication; no viewer asset extraction.',
      'Obtain original authorized download before recording formats, file sizes or approving self-hosted redistribution.'];
    await writeFile(`${outputDirectory}/${model.uid}.raw.json`, JSON.stringify(json, null, 2));
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }
  results.push(record);
  console.log(`${model.uid}: ${record.error ?? `metadata recorded; distribution approval remains false`}`);
}
await writeFile(`${outputDirectory}/summary.json`, JSON.stringify({purpose: 'Public model metadata research only', results}, null, 2));

// Public, bounded research facts are also printed so the result remains readable through CI logs.
console.log('NAPLES_MODEL_RESEARCH_SUMMARY='+JSON.stringify(results.map(({model,httpStatus,title,author,license,isDownloadable,faceCount,vertexCount,description,sourceWarning,error})=>({model,httpStatus,title,author,license,isDownloadable,faceCount,vertexCount,description:description?.slice(0,1600),sourceWarning,error}))));
