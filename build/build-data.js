const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const RAW = path.join(__dirname, "..", "raw");
const OUT = path.join(__dirname, "..", "web", "data");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const slugFromUrl = (u) => {
  if (!u) return null;
  const m = /\/locations\/([^/]+)\/?$/.exec(u);
  return m ? m[1] : null;
};

function bucketOf(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % 64;
}

console.log("reading geojson...");
const geo = JSON.parse(fs.readFileSync(path.join(RAW, "filming-locations.geojson"), "utf8"));

console.log("reading productions...");
const prodRows = parseCsv(fs.readFileSync(path.join(RAW, "productions.csv"), "utf8"));
const head = prodRows[0];
const col = Object.fromEntries(head.map((h, i) => [h, i]));

const places = new Map();
for (const f of geo.features) {
  const p = f.properties;
  const slug = slugFromUrl(p.url);
  if (!slug || !f.geometry) continue;
  const [lng, lat] = f.geometry.coordinates;
  places.set(slug, {
    slug,
    name: p.name,
    lat,
    lng,
    iso: p.iso || "",
    country: p.country || "",
    category: p.category || "place",
    tier: p.fame_tier || "",
    rank: p.fame_rank || 0,
    count: p.productions || 0,
    setOnly: !!p.set_only,
    modelledFor: p.modelled_for || 0,
    topModelled: p.top_modelled || "",
    topProductions: p.top_productions || "",
    description: p.description || "",
    image: p.image || "",
    imageBy: p.image_by || "",
    imageLicence: p.image_licence || "",
    imageLicenceUrl: p.image_licence_url || "",
    wikipedia: p.wikipedia || "",
    wikidata: p.wikidata || "",
    sourceUrl: p.url || "",
    verified: p.verified_productions || 0,
  });
}
console.log("places:", places.size);

const titles = [];
const titleByQid = new Map();
const reverse = new Map();

for (let r = 1; r < prodRows.length; r++) {
  const row = prodRows[r];
  if (!row || row.length < 20) continue;
  const qid = row[col.qid];
  const name = row[col.name];
  if (!qid || !name) continue;

  const heroSlugs = (row[col.place_slugs] || "").split(";").map((s) => s.trim()).filter(Boolean);
  const wikiSlugs = (row[col.wiki_place_slugs] || "").split(";").map((s) => s.trim()).filter(Boolean);
  const verifiedSlugs = (row[col.verified_place_slugs] || "").split(";").map((s) => s.trim()).filter(Boolean);

  const seen = new Set();
  const slugs = [];
  for (const s of [...heroSlugs, ...wikiSlugs, ...verifiedSlugs]) {
    if (places.has(s) && !seen.has(s)) { seen.add(s); slugs.push(s); }
  }

  const t = {
    qid,
    name,
    kind: row[col.kind] || "",
    year: row[col.year] || "",
    endYear: row[col.end_year] || "",
    relation: row[col.relation] || "",
    series: row[col.series] || "",
    description: row[col.description] || "",
    wikipedia: row[col.wikipedia] || "",
    sourceUrl: row[col.url] || "",
    slugs,
  };
  titles.push(t);
  titleByQid.set(qid, t);

  for (const s of slugs) {
    if (!reverse.has(s)) reverse.set(s, []);
    reverse.get(s).push([qid, name, t.kind, t.year, t.relation]);
  }
}
console.log("titles:", titles.length);

const KIND_BIT = { film: 1, tv: 2, anime: 4, manga: 8, game: 16 };

for (const [slug, place] of places) {
  const listed = reverse.get(slug) || [];
  const famous = (place.topProductions || "").split("; ").filter(Boolean);
  const rank = new Map(famous.map((n, i) => [n.toLowerCase(), i]));
  const seen = new Set(listed.map((l) => l[1].toLowerCase()));
  const links = listed.slice();
  for (const n of famous) {
    if (!seen.has(n.toLowerCase())) links.push([null, n, "", "", place.setOnly ? "set in" : "filmed at"]);
  }
  links.sort((a, b) => {
    const ra = rank.has(a[1].toLowerCase()) ? rank.get(a[1].toLowerCase()) : 1e9;
    const rb = rank.has(b[1].toLowerCase()) ? rank.get(b[1].toLowerCase()) : 1e9;
    if (ra !== rb) return ra - rb;
    return (parseInt(b[3]) || 0) - (parseInt(a[3]) || 0);
  });
  place.links = links;
  let mask = 0;
  for (const l of listed) mask |= KIND_BIT[l[2]] || 0;
  place.mask = mask;
}

// ---- places-lite: what the map needs to draw dots ----
const lite = [...places.values()]
  .sort((a, b) => b.count - a.count)
  .map((p) => [p.slug, p.name, +p.lat.toFixed(4), +p.lng.toFixed(4), p.iso, p.category, p.tier, p.count, p.setOnly ? 1 : 0, p.modelledFor, p.mask]);

// ---- titles file: search + title view ----
const titlesOut = titles
  .filter((t) => t.slugs.length)
  .map((t) => [t.qid, t.name, t.kind, t.year, t.endYear, t.relation, t.slugs]);

// ---- detail buckets ----
const detailBuckets = Array.from({ length: 64 }, () => ({}));
const linkBuckets = Array.from({ length: 64 }, () => ({}));
for (const p of places.values()) {
  const b = bucketOf(p.slug);
  detailBuckets[b][p.slug] = [
    p.name, p.country, p.category, p.count, p.description,
    p.image, p.imageBy, p.imageLicence, p.imageLicenceUrl,
    p.topProductions, p.topModelled, p.modelledFor, p.wikidata, p.sourceUrl, p.verified,
  ];
  linkBuckets[b][p.slug] = p.links.slice(0, 400);
}

fs.mkdirSync(path.join(OUT, "details"), { recursive: true });
fs.mkdirSync(path.join(OUT, "links"), { recursive: true });

function writeJson(file, obj, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj);
  fs.writeFileSync(file, text);
  const gz = zlib.gzipSync(Buffer.from(text), { level: 9 });
  return { raw: text.length, gz: gz.length };
}

const stats = {};
stats.places = writeJson(path.join(OUT, "places.json"), lite);
stats.titles = writeJson(path.join(OUT, "titles.json"), titlesOut);
for (let i = 0; i < 64; i++) {
  writeJson(path.join(OUT, "details", `${i}.json`), detailBuckets[i]);
  writeJson(path.join(OUT, "links", `${i}.json`), linkBuckets[i]);
}

const kinds = {};
for (const t of titles) kinds[t.kind] = (kinds[t.kind] || 0) + 1;

const meta = {
  generated: new Date().toISOString().slice(0, 10),
  places: places.size,
  titles: titles.length,
  titlesWithPlaces: titlesOut.length,
  kinds,
  source: "Movie Scene Map (moviescenemap.com), CC0",
};
writeJson(path.join(OUT, "meta.json"), meta, true);

console.log(JSON.stringify(stats, null, 1));
console.log(JSON.stringify(meta, null, 1));

// ---- validate any curated routes ----
const routesDir = path.join(__dirname, "..", "routes");
const allRoutes = [];

function resolveStops(file, stops) {
  const missing = (stops || []).filter((x) => !places.has(x.place)).map((x) => x.place);
  const missingPhotos = (stops || []).filter((x) => x.photo && !places.has(x.photo)).map((x) => x.photo);
  if (missing.length) console.log("ROUTE " + file + ": MISSING PLACE " + missing.join(", "));
  if (missingPhotos.length) console.log("ROUTE " + file + ": MISSING PHOTO " + missingPhotos.join(", "));
  return (stops || [])
    .filter((x) => places.has(x.place))
    .map((x) => {
      const pc = places.get(x.place);
      const ph = places.get(x.photo) || pc;
      return {
        part: x.part,
        episode: x.episode,
        scene: x.scene,
        place: x.place,
        label: x.label || "",
        name: pc.name,
        country: pc.country,
        lat: +pc.lat.toFixed(4),
        lng: +pc.lng.toFixed(4),
        image: (ph.image || "").replace("width=500", "width=1200"),
        photoPlace: ph.slug,
        photoName: ph.name,
        photoBy: ph.imageBy || "",
        photoLicence: ph.imageLicence || "",
        photoLicenceUrl: ph.imageLicenceUrl || "",
      };
    });
}

if (fs.existsSync(routesDir)) {
  for (const f of fs.readdirSync(routesDir).filter((x) => x.endsWith(".json"))) {
    const route = JSON.parse(fs.readFileSync(path.join(routesDir, f), "utf8"));
    const tracks = {};

    if (route.tracks) {
      for (const key of Object.keys(route.tracks)) {
        const t = route.tracks[key];
        tracks[key] = { label: t.label || key, stops: resolveStops(f + " [" + key + "]", t.stops) };
      }
    } else {
      tracks.filmed = { label: "Where it was filmed", stops: resolveStops(f, route.stops) };
    }

    const counts = Object.keys(tracks).map((k) => k + ":" + tracks[k].stops.length).join(" ");
    console.log("ROUTE " + f + ": ok (" + counts + ")");

    allRoutes.push({
      id: route.id,
      title: route.title,
      subtitle: route.subtitle || "",
      curated: !!route.curated,
      kind: route.kind || "",
      aliases: route.aliases || [],
      note: route.note || "",
      sources: route.sources || [],
      tracks,
    });
  }
}
writeJson(path.join(OUT, "routes.json"), allRoutes);

// ---- private, local-only photos (web/data/private is gitignored, never published) ----
const LOCAL = process.argv.includes("--local");
const PRIVATE_SRC = path.join(__dirname, "..", "private");
const PRIVATE_OUT = path.join(OUT, "private");
const manifest = {};

if (LOCAL && fs.existsSync(PRIVATE_SRC)) {
  for (const dir of fs.readdirSync(PRIVATE_SRC, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const routeId = dir.name;
    const route = allRoutes.find((r) => r.id === routeId);
    if (!route) {
      console.log("PRIVATE " + routeId + ": no such route");
      continue;
    }

    const map = {};
    const copy = (srcPath, relPath, track, n) => {
      const trackDef = route.tracks[track];
      if (!trackDef) { console.log("PRIVATE " + routeId + ": no track " + track); return; }
      if (n < 1 || n > trackDef.stops.length) {
        console.log("PRIVATE " + routeId + "/" + relPath + ": stop out of range");
        return;
      }
      fs.mkdirSync(path.dirname(path.join(PRIVATE_OUT, relPath)), { recursive: true });
      fs.copyFileSync(srcPath, path.join(PRIVATE_OUT, relPath));
      map[track + ":" + n] = "private/" + relPath;
    };

    for (const entry of fs.readdirSync(path.join(PRIVATE_SRC, routeId), { withFileTypes: true })) {
      const firstTrack = Object.keys(route.tracks)[0];
      if (entry.isDirectory()) continue;
      const m = /^(\d{1,2})\.(jpg|jpeg|png|webp|avif)$/i.exec(entry.name);
      if (!m) continue;
      copy(
        path.join(PRIVATE_SRC, routeId, entry.name),
        routeId + "/" + entry.name,
        firstTrack,
        parseInt(m[1], 10)
      );
    }

    for (const track of Object.keys(route.tracks)) {
      const td = path.join(PRIVATE_SRC, routeId, track);
      if (!fs.existsSync(td)) continue;
      for (const file of fs.readdirSync(td)) {
        const m = /^(\d{1,2})\.(jpg|jpeg|png|webp|avif)$/i.exec(file);
        if (!m) continue;
        copy(path.join(td, file), routeId + "/" + track + "/" + file, track, parseInt(m[1], 10));
      }
    }

    manifest[routeId] = map;
    console.log("PRIVATE " + routeId + ": " + Object.keys(map).length + " photos");
  }
}
writeJson(path.join(OUT, "private", "manifest.json"), manifest);
