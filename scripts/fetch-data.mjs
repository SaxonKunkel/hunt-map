// One-time download of public land layers into public/data/*.geojson.
// Run with:  npm run fetch-data
// Re-run once a year or so to pick up boundary changes.
//
// Sources (all free, public):
//  - Missouri Dept. of Conservation, MDC_Administrative_Areas FeatureServer
//  - USGS PAD-US 4.1 (Protected Areas Database of the US), Fee layer, Missouri federal land
//  - MapLibre demo font glyphs (so area labels work offline)

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data');
const fontDir = join(root, 'public', 'fonts');

const MDC = 'https://gisblue.mdc.mo.gov/arcgis/rest/services/Discover_Nature/MDC_Administrative_Areas/FeatureServer';
const PADUS = 'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0';

// ~3 m simplification and 6-decimal precision (~10 cm) keeps files small but accurate enough for hunting.
const SIMPLIFY_DEG = 0.00003;
const UA = { 'User-Agent': 'mo-hunt-map data script (personal, non-commercial)' };

async function post(url, params) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json;
    } catch (err) {
      if (attempt === 4) throw err;
      console.warn(`  retry ${attempt} after error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// Download every feature matching `where`, in chunks of object IDs (works on any ArcGIS server).
async function fetchLayer(layerUrl, where, chunk = 200) {
  const ids = (await post(`${layerUrl}/query`, { where, returnIdsOnly: 'true', f: 'json' })).objectIds || [];
  ids.sort((a, b) => a - b);
  console.log(`  ${ids.length} features`);
  const features = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const page = await post(`${layerUrl}/query`, {
      objectIds: ids.slice(i, i + chunk).join(','),
      outFields: '*',
      outSR: '4326',
      maxAllowableOffset: String(SIMPLIFY_DEG),
      geometryPrecision: '6',
      f: 'geojson',
    });
    features.push(...page.features);
    process.stdout.write(`  ${Math.min(i + chunk, ids.length)}/${ids.length}\r`);
  }
  process.stdout.write('\n');
  return features.filter((f) => f.geometry);
}

const round = (n) => (n == null || isNaN(n) ? null : Math.round(Number(n) * 10) / 10);

// Every layer is normalized to the same small set of properties the app reads.
function normalize(features, fn) {
  return {
    type: 'FeatureCollection',
    features: features.map((f, i) => ({ type: 'Feature', id: i + 1, geometry: f.geometry, properties: fn(f.properties) })),
  };
}

async function save(name, fc) {
  const file = join(outDir, `${name}.geojson`);
  await writeFile(file, JSON.stringify(fc));
  const kb = Math.round((await stat(file)).size / 1024);
  console.log(`  saved ${name}.geojson (${fc.features.length} features, ${kb} KB)`);
}

const PADUS_MANAGERS = {
  USFS: 'U.S. Forest Service',
  USACE: 'U.S. Army Corps of Engineers',
  FWS: 'U.S. Fish & Wildlife Service',
  NPS: 'National Park Service',
  DOD: 'Dept. of Defense',
  ARMY: 'U.S. Army',
  BLM: 'Bureau of Land Management',
  OTHF: 'Other Federal',
};
const ACCESS = { OA: 'Open access', RA: 'Restricted access', XA: 'Closed to public', UK: 'Unknown access' };

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(fontDir, { recursive: true });

  console.log('MDC Conservation Areas');
  const ca = await fetchLayer(`${MDC}/5`, "Public_Site='Y'");
  await save('mdc-conservation-areas', normalize(ca, (p) => ({
    name: p.OFF_Name || p.Area_Name,
    label: p.Area_Name,
    acres: round(p.Acreage ?? p.Acres_GIS),
    kind: 'Conservation Area',
    owner: 'Missouri Dept. of Conservation',
    county: p.County,
    link: p.Sum_Link,
    regs: p.Reg_Link,
    map: p.Map_Link,
  })));

  console.log('MDC Natural Areas');
  const na = await fetchLayer(`${MDC}/3`, '1=1');
  await save('mdc-natural-areas', normalize(na, (p) => ({
    name: p.Area_Name,
    label: p.Name,
    acres: round(p.Acres ?? p.NOM_Acres),
    kind: 'Natural Area',
    owner: p.Owner,
    county: p.County,
  })));

  console.log('MDC MRAP Lands');
  const mrap = await fetchLayer(`${MDC}/1`, '1=1');
  await save('mdc-mrap', normalize(mrap, (p) => ({
    name: p.Area_Name,
    label: p.Area_Name,
    acres: round(p.Acres),
    kind: 'MRAP (private land, public access)',
    access: p.Access_Typ,
    county: p.County,
    map: p.Map_Link,
  })));

  console.log('PAD-US federal land in Missouri');
  const fed = await fetchLayer(PADUS, "State_Nm='MO' AND Mang_Type='FED'", 100);
  await save('federal', normalize(fed, (p) => ({
    name: p.Unit_Nm,
    label: p.Unit_Nm,
    acres: round(p.GIS_Acres),
    kind: 'Federal land',
    manager: p.Mang_Name,
    owner: PADUS_MANAGERS[p.Mang_Name] || p.Mang_Name,
    access: ACCESS[p.Pub_Access] || p.Pub_Access,
  })));

  console.log('Label fonts (for offline labels)');
  const font = 'Open Sans Semibold';
  await mkdir(join(fontDir, font), { recursive: true });
  for (const range of ['0-255', '256-511', '8192-8447']) {
    const res = await fetch(`https://demotiles.maplibre.org/font/${encodeURIComponent(font)}/${range}.pbf`, { headers: UA });
    if (!res.ok) throw new Error(`font ${range}: HTTP ${res.status}`);
    await writeFile(join(fontDir, font, `${range}.pbf`), Buffer.from(await res.arrayBuffer()));
  }
  console.log('  saved glyphs');

  await writeFile(join(outDir, 'meta.json'), JSON.stringify({ fetched: new Date().toISOString().slice(0, 10) }));
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
