/* Scene Map - clean viewer for the Movie Scene Map CC0 dataset */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);

  const MIDDOT = "\u00b7", DASH = "\u2014", EN = "\u2013", LQ = "\u201c", RQ = "\u201d";
  const ARROW_L = "\u2190", ARROW_R = "\u2192", ELLIPSIS = "\u2026";

  const KIND_LABEL = { film: "Film", tv: "TV", anime: "Anime", manga: "Manga", game: "Game" };
  const relLabel = (r) => (r === "set in" ? "Set in" : "Filmed at");

  let map;
  let places = [];
  let placeBySlug = new Map();
  let titles = [];
  let titleByQid = new Map();
  let titleIndex = [];
  let placeIndex = [];
  let routeIndex = [];
  let routes = [];
  let filters = new Set(["film", "tv", "anime", "manga", "game"]);
  let current = null;
  let routeState = null;
  let titlesReady = false;
  let activeResult = -1;
  let searchResults = [];
  let pendingHash = null;
  let privateManifest = {};

  const norm = (s) => (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const bucketOf = (slug) => {
    let h = 0;
    for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
    return h % 64;
  };

  const bucketCache = new Map();
  async function getBucket(kind, slug) {
    const b = bucketOf(slug);
    const key = kind + b;
    if (!bucketCache.has(key)) {
      bucketCache.set(key, fetch(`data/${kind}/${b}.json`).then((r) => r.json()).catch(() => ({})));
    }
    return (await bucketCache.get(key))[slug] || null;
  }

  const ISO = { US: "USA", GB: "UK", JP: "Japan", IT: "Italy", FR: "France", EG: "Egypt", CN: "China", IN: "India", PK: "Pakistan", CH: "Switzerland", AT: "Austria", ES: "Spain", DE: "Germany", KR: "South Korea", BR: "Brazil", AR: "Argentina", RU: "Russia", TR: "Turkey", HK: "Hong Kong", SG: "Singapore", AE: "UAE", SA: "Saudi Arabia", GR: "Greece", VA: "Vatican City", NP: "Nepal", MX: "Mexico", CA: "Canada", AU: "Australia" };
  const countryName = (iso) => ISO[iso] || iso || "";

  /* ---------------- data ---------------- */
  async function load() {
    const [pl, rt, pm] = await Promise.all([
      fetch("data/places.json").then((r) => r.json()),
      fetch("data/routes.json").then((r) => r.json()).catch(() => []),
      fetch("data/private/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    places = pl;
    routes = rt;
    privateManifest = pm || {};
    for (const p of places) placeBySlug.set(p[0], p);
    initMap();

    placeIndex = places.map((p) => ({ kind: "place", id: p[0], name: p[1], n: norm(p[1]), sub: placeSub(p), score: p[7] }));
    routeIndex = routes.map((r) => ({
      kind: "route", kindFor: r.kind || "", id: r.id, name: r.title, n: norm(r.title),
      sub: "Guided route", score: 60,
    }));


    $("#search").placeholder = "Loading titles" + ELLIPSIS;

    fetch("data/titles.json").then((r) => r.json()).then((ts) => {
      titles = ts;
      for (const t of titles) titleByQid.set(t[0], t);
      titleIndex = titles.map((t) => ({
        kind: "title", kindFor: t[2], id: t[0], name: t[1], n: norm(t[1]),
        sub: [KIND_LABEL[t[2]] || t[2], t[3]].filter(Boolean).join(" " + MIDDOT + " "),
        score: t[2] === "film" ? 3 : t[2] === "tv" ? 2 : 1,
      }));
      titlesReady = true;
      $("#search").placeholder = "Film, show, anime, game or place";
      const q = $("#search").value.trim();
      if (q) runSearch(q);
      if (pendingHash) { const h = pendingHash; pendingHash = null; applyHash(h); }
    });

    parseHash();
  }

  function placeSub(p) {
    const parts = [p[4] ? countryName(p[4]) : "", p[9] > 0 ? "fiction modelled here" : ""].filter(Boolean);
    return parts.join(" " + MIDDOT + " ");
  }

  /* ---------------- map ---------------- */
  const emptyFC = () => ({ type: "FeatureCollection", features: [] });

  const pendingSrc = {};
  function setSrc(id, data) {
    pendingSrc[id] = data;
    const s = map && map.getSource(id);
    if (s && s.setData) s.setData(data);
  }

  function flushSrc() {
    for (const id of Object.keys(pendingSrc)) {
      const s = map.getSource(id);
      if (s && s.setData) s.setData(pendingSrc[id]);
    }
  }

  const panelW = () => (panel && !panel.hidden && window.innerWidth > 760 ? 400 : 0);
  const mapPad = (base = 80) => ({ top: base, bottom: base, left: base, right: base + panelW() });

  let baseHidden = false;
  function setBaseVisible(on) {
    baseHidden = !on;
    if (!map || !map.getLayer("points")) return;
    const v = on ? "visible" : "none";
    for (const id of ["points", "clusters", "cluster-count"]) map.setLayoutProperty(id, "visibility", v);
  }

  function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [12, 26],
      zoom: 1.9,
      minZoom: 1.2,
      maxZoom: 16,
      attributionControl: false,
      dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => {
      map.addSource("places", { type: "geojson", data: placesGeoJSON(), cluster: true, clusterMaxZoom: 7, clusterRadius: 42 });

      map.addLayer({
        id: "clusters", type: "circle", source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#c2410c",
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 60, 22, 200, 27],
        },
      });
      map.addLayer({
        id: "cluster-count", type: "symbol", source: "places",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 11, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "points", type: "circle", source: "places",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["case", ["==", ["get", "set"], 1], "#6d28d9", "#c2410c"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2.6, 6, 4, 11, 6.5],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 8, 1.6],
          "circle-opacity": 0.95,
        },
      });

      map.addSource("sel", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "sel-ring", type: "circle", source: "sel",
        paint: { "circle-color": "transparent", "circle-stroke-color": "#1b1a18", "circle-stroke-width": 2, "circle-radius": 12 },
      });

      map.addSource("tpts", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "tpts", type: "circle", source: "tpts",
        paint: { "circle-color": "#ffffff", "circle-stroke-color": "#c2410c", "circle-stroke-width": 2.5, "circle-radius": 6.5 },
      });

      map.addSource("rline", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "rline", type: "line", source: "rline",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1b1a18", "line-width": 1.6, "line-dasharray": [2, 2], "line-opacity": 0.45 },
      });

      map.addSource("rstops", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "rstops", type: "circle", source: "rstops",
        paint: { "circle-color": "#ffffff", "circle-stroke-color": "#1b1a18", "circle-stroke-width": 2, "circle-radius": 8 },
      });
      map.addLayer({
        id: "rstops-n", type: "symbol", source: "rstops",
        layout: { "text-field": ["get", "n"], "text-size": 9, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#1b1a18" },
      });
      map.addLayer({
        id: "rstops-on", type: "circle", source: "rstops",
        filter: ["==", ["get", "on"], 1],
        paint: { "circle-color": "#c2410c", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-radius": 11 },
      });

      applyFilter();
      flushSrc();
      if (baseHidden) setBaseVisible(false);

      map.on("click", "points", (e) => openPlace(e.features[0].properties.slug));
      map.on("click", "tpts", (e) => openPlace(e.features[0].properties.slug));
      map.on("click", "rstops", (e) => { if (routeState) goStep(+e.features[0].properties.n - 1); });
      map.on("click", "clusters", (e) => {
        const f = e.features[0];
        map.getSource("places").getClusterExpansionZoom(f.properties.cluster_id).then((z) => {
          map.easeTo({ center: f.geometry.coordinates, zoom: z });
        });
      });
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["points", "tpts", "rstops", "clusters"] });
        if (hits.length) return;
        const near = nearestPlace(e.lngLat.lng, e.lngLat.lat, 40);
        if (near) openPlace(near[0], { near: true });
      });

      for (const l of ["points", "tpts", "clusters", "rstops"]) {
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
    });
  }

  function placesGeoJSON() {
    return {
      type: "FeatureCollection",
      features: places.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p[3], p[2]] },
        properties: {
          slug: p[0], name: p[1], set: p[8], mask: p[10],
          f_film: p[10] & 1 ? 1 : 0, f_tv: p[10] & 2 ? 1 : 0, f_anime: p[10] & 4 ? 1 : 0,
          f_manga: p[10] & 8 ? 1 : 0, f_game: p[10] & 16 ? 1 : 0,
        },
      })),
    };
  }

  function applyFilter() {
    if (!map || !map.getLayer("points")) return;
    if (filters.size === 0 || filters.size === 5) {
      map.setFilter("points", ["!", ["has", "point_count"]]);
      return;
    }
    const tests = [...filters].map((k) => ["==", ["get", "f_" + k], 1]);
    map.setFilter("points", ["all", ["!", ["has", "point_count"]], ["any", ...tests]]);
  }

  function nearestPlace(lng, lat, km) {
    let best = null, bestD = Infinity;
    const kx = Math.cos((lat * Math.PI) / 180);
    for (const p of places) {
      const dx = (p[3] - lng) * kx, dy = p[2] - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return null;
    return Math.sqrt(bestD) * 111 <= km ? best : null;
  }

  /* ---------------- search ---------------- */
  const resultsEl = $("#results");
  const inputEl = $("#search");

  function runSearch(q) {
    activeResult = -1;
    if (!q) { hideResults(); return; }
    const nq = norm(q);
    const out = [];

    const score = (item) => {
      const n = item.n;
      if (n === nq) return 1000;
      if (n.startsWith(nq)) return 700;
      if (n.includes(" " + nq)) return 500;
      if (n.includes(nq)) return 260;
      return 0;
    };

    for (const it of routeIndex) {
      const sc = score(it);
      if (sc && (!it.kindFor || filters.has(it.kindFor))) out.push({ it, s: sc + 150 });
    }
    for (const it of titleIndex) {
      const s = score(it);
      if (s && filters.has(it.kindFor)) out.push({ it, s: s + (it.score || 0) });
    }
    for (const it of placeIndex) {
      let s = score(it);
      if (s && it.n === nq) s += 5;
      if (s) out.push({ it, s: s + Math.min(120, Math.log10((it.score || 0) + 1) * 40) });
    }

    out.sort((a, b) => b.s - a.s || a.it.name.length - b.it.name.length);
    searchResults = out.slice(0, 24).map((x) => x.it);
    renderResults(searchResults, q);
  }

  function renderResults(items, q) {
    if (!items.length) {
      resultsEl.innerHTML = `<div class="empty">Nothing found for ${LQ}${esc(q)}${RQ}.</div>`;
      resultsEl.hidden = false;
      return;
    }
    const groups = { route: [], title: [], place: [] };
    for (const it of items) (groups[it.kind] || groups.place).push(it);

    const first = items[0] ? items[0].kind : "title";
    const order = first === "route" ? ["route", "title", "place"] : first === "place" ? ["place", "title", "route"] : ["title", "route", "place"];
    const heads = { route: "Guided routes", title: "Films, shows, anime, games", place: "Places" };

    let html = "";
    for (const k of order) {
      if (!groups[k].length) continue;
      html += `<div class="grp">${heads[k]}</div>`;
      for (const it of groups[k]) html += rowHtml(it);
    }
    resultsEl.innerHTML = html;
    resultsEl.hidden = false;
  }

  function rowHtml(it) {
    const t = it.kind === "title" ? titleByQid.get(it.id) : null;
    const pill = it.kind === "route" ? `<span class="pill set">Route</span>` : t ? `<span class="pill">${esc(KIND_LABEL[t[2]] || t[2])}</span>` : "";
    const idx = searchResults.indexOf(it);
    return `<button class="r" data-i="${idx}" role="option">
      <span class="txt"><span class="nm">${esc(it.name)}</span><span class="sub">${esc(it.sub)}</span></span>
      ${pill}</button>`;
  }

  function hideResults() { resultsEl.hidden = true; activeResult = -1; }

  inputEl.addEventListener("input", (e) => runSearch(e.target.value.trim()));
  inputEl.addEventListener("focus", () => { if (inputEl.value.trim()) runSearch(inputEl.value.trim()); });
  inputEl.addEventListener("keydown", (e) => {
    if (resultsEl.hidden) return;
    const rows = [...resultsEl.querySelectorAll(".r")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      activeResult = (activeResult + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      rows.forEach((r, i) => r.classList.toggle("active", i === activeResult));
      rows[activeResult]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = rows[activeResult] || rows[0];
      if (pick) pick.click();
    } else if (e.key === "Escape") hideResults();
  });

  resultsEl.addEventListener("click", (e) => {
    const row = e.target.closest(".r");
    if (!row) return;
    const it = searchResults[+row.dataset.i];
    hideResults();
    inputEl.blur();
    if (it.kind === "route") openRoute(it.id);
    else if (it.kind === "title") openTitle(it.id);
    else openPlace(it.id);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".searchwrap")) hideResults();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== inputEl) {
      e.preventDefault(); inputEl.focus(); inputEl.select();
    }
    if (e.key === "Escape") {
      if (!resultsEl.hidden) hideResults();
      else if (current) closePanel();
    }
    if (routeState && document.activeElement !== inputEl) {
      if (e.key === "ArrowRight") { e.preventDefault(); goStep(routeState.step + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goStep(routeState.step - 1); }
    }
  });

  /* ---------------- panel ---------------- */
  const panel = $("#panel");
  const body = $("#panelbody");

  function openPanel() {
    panel.hidden = false;
    document.body.classList.add("panel-open");
    $("#hint").style.display = "none";
  }

  function closePanel() {
    panel.hidden = true;
    document.body.classList.remove("panel-open");
    current = null;
    routeState = null;
    setSrc("sel", emptyFC());
    setSrc("rline", emptyFC());
    setSrc("rstops", emptyFC());
    setSrc("tpts", emptyFC());
    setBaseVisible(true);
    history.replaceState(null, "", location.pathname);
  }
  $("#close").addEventListener("click", closePanel);

  async function openPlace(slug, opts = {}) {
    const p = placeBySlug.get(slug);
    if (!p) return;
    current = { type: "place", id: slug };
    routeState = null;
    openPanel();
    history.replaceState(null, "", "#p=" + encodeURIComponent(slug));
    setBaseVisible(true);
    if (!opts.keepMap) map.flyTo({ center: [p[3], p[2]], zoom: Math.max(map.getZoom(), 8), duration: 700, offset: [-panelW() / 2, 0] });
    setSrc("sel", pointFC([p[3], p[2]]));
    setSrc("rline", emptyFC());
    setSrc("rstops", emptyFC());
    setSrc("tpts", emptyFC());

    body.innerHTML = `<div class="pad"><p class="eyebrow">Loading${ELLIPSIS}</p></div>`;

    const [det, links] = await Promise.all([getBucket("details", slug), getBucket("links", slug)]);
    if (!current || current.id !== slug) return;
    body.innerHTML = placeHtml(p, det, links, !!opts.near);
  }

  function placeHtml(p, det, links, near) {
    const [slug, name, lat, lng, iso, cat, tier, count, setOnly] = p;
    const d = det || [];
    const image = d[5] || "";
    const imageBy = d[6] || "", lic = d[7] || "", licUrl = d[8] || "";
    const desc = d[4] || "";
    const topModelled = d[10] || "";
    const verified = d[14] || 0;

    const rows = (links || []).slice();
    const total = Math.max(count || 0, rows.length);
    const famous = (d[9] || "").split("; ").filter(Boolean);
    const fame = new Map(famous.map((n, i) => [norm(n), i]));
    rows.sort((a, b) => {
      const ra = fame.has(norm(a[1])) ? fame.get(norm(a[1])) : 1e9;
      const rb = fame.has(norm(b[1])) ? fame.get(norm(b[1])) : 1e9;
      if (ra !== rb) return ra - rb;
      return (parseInt(b[3]) || 0) - (parseInt(a[3]) || 0);
    });
    const filmed = rows.filter((r) => r[4] !== "set in");
    const setIn = rows.filter((r) => r[4] === "set in");

    const list = (arr, cap, label) => {
      if (!arr.length) return "";
      const shown = arr.slice(0, cap);
      return `<h2>${label} <span style="color:#c9c4bb">${arr.length}</span></h2>
        <div class="scroller">${shown.map((r) => r[0]
          ? `<button class="row" data-title="${esc(r[0])}">
              <span class="rn">${esc(r[1])}</span>
              <span class="ry">${esc(KIND_LABEL[r[2]] || r[2])}${r[3] ? " " + MIDDOT + " " + esc(r[3]) : ""}</span>
            </button>`
          : `<button class="row" data-name="${esc(r[1])}">
              <span class="rn">${esc(r[1])}</span>
              <span class="ry">search</span>
            </button>`).join("")}</div>`;
    };

    return `
      ${image ? `<div class="hero" style="background-image:url('${esc(image)}')"></div>` : ""}
      <div class="pad">
        ${near ? `<p class="eyebrow" style="color:#c2410c">Closest place to your click</p>` : ""}
        <p class="eyebrow">${esc(cat)}${iso ? " " + MIDDOT + " " + esc(countryName(iso)) : ""}${tier ? " " + MIDDOT + " " + esc(tier) : ""}</p>
        <h1>${esc(name)}</h1>
        <div class="meta">
          ${total ? `<span class="pill">${total} production${total === 1 ? "" : "s"}</span>` : `<span class="pill">No productions recorded</span>`}
          ${setOnly ? `<span class="pill set">Fictional settings only</span>` : ""}
          ${verified ? `<span class="pill">${verified} verified</span>` : ""}
        </div>
        ${desc ? `<p class="desc">${esc(desc)}</p>` : ""}
        ${list(filmed, 40, "Filmed here")}
        ${list(setIn, 40, "Set here")}
        ${topModelled ? `<h2>Fiction modelled on this place</h2><div class="tags">${topModelled.split("; ").map((n) => `<span class="pill set">${esc(n)}</span>`).join("")}</div>` : ""}
        <div class="note">
          ${image ? `Photo: ${esc(imageBy || "Wikimedia Commons")}${lic ? " " + MIDDOT + " " + esc(lic) : ""}${licUrl ? " " + MIDDOT + ` <a href="${esc(licUrl)}" target="_blank" rel="noopener">licence</a>` : ""}<br>` : ""}
          <a href="${esc(d[12] || "#")}" target="_blank" rel="noopener">Source on Movie Scene Map</a>
        </div>
      </div>`;
  }

  function openTitle(qid, opts = {}) {
    const t = titleByQid.get(qid);
    if (!t) return;
    current = { type: "title", id: qid };
    routeState = null;
    openPanel();
    history.replaceState(null, "", "#t=" + encodeURIComponent(qid));

    const pts = t[6].map((s) => placeBySlug.get(s)).filter(Boolean)
      .sort((a, b) => b[7] - a[7]);

    setSrc("tpts", {
      type: "FeatureCollection",
      features: pts.map((p) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [p[3], p[2]] },
        properties: { slug: p[0], name: p[1] },
      })),
    });
    setSrc("rline", emptyFC());
    setSrc("rstops", emptyFC());
    setSrc("sel", emptyFC());

    if (pts.length && !opts.keepMap) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p[3], p[2]]));
      setBaseVisible(false);
      map.fitBounds(b, { padding: mapPad(90), maxZoom: 8, duration: 800 });
    }

    const route = routeForTitle(t);
    body.innerHTML = `<div class="pad">
      <p class="eyebrow">${esc(KIND_LABEL[t[2]] || t[2])}${t[3] ? " " + MIDDOT + " " + esc(t[3]) : ""}${t[4] && t[4] !== t[3] ? EN + esc(t[4]) : ""}</p>
      <h1>${esc(t[1])}</h1>
      <div class="meta"><span class="pill ${t[5] === "set in" ? "set" : ""}">${relLabel(t[5])} ${pts.length} place${pts.length === 1 ? "" : "s"}</span></div>
      ${route ? `<div style="margin-top:16px"><button class="btn primary" data-route="${esc(route.id)}">View in order ${ARROW_R}</button></div>` : ""}
      <h2>${t[5] === "set in" ? "Where it is set" : "Where it was filmed"}</h2>
      <div class="scroller">${pts.map((p) => `
        <button class="row" data-place="${esc(p[0])}">
          <span class="rn">${esc(p[1])}</span>
          <span class="ry">${esc(p[4] ? countryName(p[4]) : "")}</span>
        </button>`).join("")}</div>
      ${t[7] ? `<p class="desc">${esc(t[7])}</p>` : ""}
      ${route ? "" : `<div class="note">No hand-built route for this title yet. Routes are added by hand, one show at a time ${DASH} the dataset has no episode or scene order.</div>`}
    </div>`;
  }

  function routeForTitle(t) {
    const n = norm(t[1]);
    return routes.find((r) => (!r.kind || r.kind === t[2]) && (norm(r.title) === n || (r.aliases || []).some((a) => norm(a) === n)));
  }

  function computeSteps(stops, mode) {
    if (mode === "scene") return stops.map((s, i) => ({ part: s.part, episode: s.episode, parts: [s], scene: s.scene, idx: i }));
    const steps = [];
    let cur = null;
    stops.forEach((s, i) => {
      if (cur && cur.part === s.part && cur.episode === s.episode) cur.parts.push(s);
      else { cur = { part: s.part, episode: s.episode, parts: [s], scene: s.scene, idx: i }; steps.push(cur); }
    });
    return steps;
  }

  function defaultTrack(route) {
    if (route.tracks.story && route.tracks.story.stops.length >= 2) return "story";
    return Object.keys(route.tracks)[0];
  }

  function currentStops() {
    return routeState.route.tracks[routeState.track].stops;
  }

  function writeRouteHash() {
    history.replaceState(null, "", `#r=${routeState.route.id}&t=${routeState.track}&s=${routeState.step + 1}&m=${routeState.mode}`);
  }

  function openRoute(rid, mode, track) {
    const route = routes.find((r) => r.id === rid);
    if (!route) return;
    current = { type: "route", id: rid };
    const tr = track && route.tracks[track] ? track : defaultTrack(route);
    routeState = { route, track: tr, mode: mode === "episode" ? "episode" : "scene", step: 0 };
    routeState.steps = computeSteps(currentStops(), routeState.mode);
    openPanel();
    writeRouteHash();
    mapFillRoute();
    renderRoute();
  }

  function mapFillRoute() {
    const pts = currentStops();
    const b = new maplibregl.LngLatBounds();
    pts.forEach((s) => b.extend([s.lng, s.lat]));
    setBaseVisible(false);
    map.fitBounds(b, { padding: mapPad(90), maxZoom: 6, duration: 900 });
    setSrc("rline", {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: pts.map((s) => [s.lng, s.lat]) }, properties: {} }],
    });
  }

  function goStep(i) {
    if (!routeState) return;
    i = Math.max(0, Math.min(routeState.steps.length - 1, i));
    routeState.step = i;
    const preload = (j) => {
      const st = routeState.steps[j];
      if (st && st.parts[0] && st.parts[0].image) { const im = new Image(); im.src = st.parts[0].image; }
    };
    preload(i + 1); preload(i - 1);
    const p = routeState.steps[i].parts[0];
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 6), duration: 800, offset: [-panelW() / 2, 0] });
    writeRouteHash();
    renderRoute();
  }

  function renderRoute() {
    const { route, steps, step, mode } = routeState;
    const s = steps[step];
    const p = s.parts[0];

    setSrc("rstops", {
      type: "FeatureCollection",
      features: steps.map((st, i) => {
        const q = st.parts[0];
        return { type: "Feature", geometry: { type: "Point", coordinates: [q.lng, q.lat] }, properties: { n: String(i + 1), on: i === step ? 1 : 0 } };
      }),
    });
    setSrc("sel", pointFC([p.lng, p.lat]));

    const also = s.parts.length > 1 ? s.parts.slice(1).map((x) => x.name) : [];
    const pad = (n) => String(n).padStart(2, "0");
    const localFile = (privateManifest[route.id] || {})[routeState.track + ":" + String((s.idx || 0) + 1)];
    const heroSrc = localFile ? "data/" + localFile : p.image;
    const credit = localFile
      ? "Your own copy"
      : [p.photoName ? p.photoName : "", p.photoBy ? "photo " + p.photoBy : "", p.photoLicence || ""].filter(Boolean).join(" " + MIDDOT + " ");

    body.innerHTML = `
      ${heroSrc ? `<button class="route-hero" data-place="${esc(p.photoPlace || p.place)}" style="background-image:url('${esc(heroSrc)}')" aria-label="Open ${esc(p.photoName || p.name)}">${credit ? `<span class="route-credit">${esc(credit)}</span>` : ""}</button>` : ""}
      <div class="pad">
      <p class="eyebrow">${route.curated ? "Hand-built route" : "Route"}</p>
      <h1 style="font-size:20px">${esc(route.title)}</h1>
      ${route.subtitle ? `<div class="meta" style="font-size:12.5px">${esc(route.subtitle)}</div>` : ""}

      <div class="segs">
        ${Object.keys(route.tracks).length > 1
          ? `<div class="seg">${Object.keys(route.tracks).map((k) => `<button data-track="${k}" class="${routeState.track === k ? "on" : ""}">${esc(route.tracks[k].label)}</button>`).join("")}</div>`
          : ""}
        ${steps.length > 1 ? `<div class="seg">
          <button data-mode="scene" class="${mode === "scene" ? "on" : ""}">Scene</button>
          <button data-mode="episode" class="${mode === "episode" ? "on" : ""}">Episode</button>
        </div>` : ""}
      </div>

      <div class="counter">${pad(step + 1)} / ${pad(steps.length)}</div>
      <div class="stop-part">${esc(s.part || "")}</div>
      <div class="stop-ep">${esc(s.episode || "")}</div>
      <span class="stop-scene">${esc(s.scene || "")}</span>

      <div class="stop-place">
        ${localFile && p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" title="${esc(p.photoName || "")}">` : ""}
        <div>
          <div class="nm">${esc(p.label || p.name)}</div>
          <div class="ct">${p.label ? "Pinned at " + esc(p.name) : esc(p.country || "")}${also.length ? " " + MIDDOT + " also " + esc(also.join(", ")) : ""}</div>
          ${localFile && p.photoName ? `<div class="ct" style="font-size:10px;opacity:.75">Real place: ${esc(p.photoName)}${p.photoLicence ? " " + MIDDOT + " " + esc(p.photoLicence) : ""}</div>` : ""}
        </div>
      </div>

      <div class="nav">
        <button class="btn" data-step="${step - 1}" ${step === 0 ? "disabled" : ""}>${ARROW_L} Previous</button>
        <button class="btn primary" data-step="${step + 1}" ${step === steps.length - 1 ? "disabled" : ""}>Next ${ARROW_R}</button>
      </div>

      <div class="dots">
        ${steps.map((_, i) => `<button data-step="${i}" class="${i === step ? "on" : ""}" aria-label="Stop ${i + 1}">${i + 1}</button>`).join("")}
      </div>

      <div class="note">
        ${esc(route.note || "")}
        <br><button class="more" data-place="${esc(p.place)}">Open ${esc(p.name)}</button>
      </div>
    </div>`;
  }

  function pointFC(coord) {
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: coord }, properties: {} }] };
  }

  /* ---------------- panel events ---------------- */
  body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-title],[data-name],[data-place],[data-route],[data-step],[data-mode],[data-track]");
    if (!t) return;
    if (t.dataset.track) {
      if (!routeState) return;
      routeState.track = t.dataset.track;
      routeState.steps = computeSteps(currentStops(), routeState.mode);
      routeState.step = 0;
      mapFillRoute();
      writeRouteHash();
      renderRoute();
      return;
    }
    if (t.dataset.name) {
      inputEl.value = t.dataset.name;
      runSearch(t.dataset.name);
      inputEl.focus();
      return;
    }
    if (t.dataset.title) return openTitle(t.dataset.title);
    if (t.dataset.place) return openPlace(t.dataset.place);
    if (t.dataset.route) return openRoute(t.dataset.route, "scene");
    if (t.dataset.mode) {
      if (!routeState) return;
      routeState.mode = t.dataset.mode;
      routeState.steps = computeSteps(routeState.route, routeState.mode);
      goStep(0);
      return;
    }
    if (t.dataset.step !== undefined) return goStep(+t.dataset.step);
  });

  /* ---------------- hash ---------------- */
  function parseHash() {
    const h = location.hash.replace(/^#/, "");
    if (!h) return;
    if (/\bt=/.test(h) && !titlesReady) { pendingHash = h; return; }
    applyHash(h);
  }

  function applyHash(h) {
    const q = new URLSearchParams(h);
    if (q.get("p")) openPlace(q.get("p"));
    else if (q.get("t")) openTitle(q.get("t"));
    else if (q.get("r")) {
      const route = routes.find((r) => r.id === q.get("r"));
      if (!route) return;
      openRoute(route.id, q.get("m") === "episode" ? "episode" : "scene", q.get("t") || undefined);
      const s = parseInt(q.get("s") || "1", 10);
      if (s > 1) goStep(s - 1);
    }
  }

  window.addEventListener("hashchange", () => parseHash());

  /* ---------------- misc UI ---------------- */
  document.querySelectorAll(".hint button").forEach((b) => b.addEventListener("click", () => {
    inputEl.value = b.dataset.q;
    runSearch(b.dataset.q);
    inputEl.focus();
  }));

  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-kind]");
    if (!b) return;
    const k = b.dataset.kind;
    if (filters.has(k)) { filters.delete(k); b.classList.remove("on"); }
    else { filters.add(k); b.classList.add("on"); }
    if (filters.size === 0) { filters.add(k); b.classList.add("on"); }
    applyFilter();
    if (inputEl.value.trim()) runSearch(inputEl.value.trim());
  });

  load();
})();
