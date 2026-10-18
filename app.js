(function () {
  const DATA = window.SWEEP_DATA;
  const TZ = "America/Los_Angeles";
  const DAYS_AHEAD = 21;

  const SIDE_NAME = { N: "North side", S: "South side", E: "East side", W: "West side" };
  const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ORD = ["", "1st", "2nd", "3rd", "4th", "5th"];

  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- dates (all in San Diego time, as integer day numbers) ----------
  // A "day number" is days since 1970-01-01, so weekday/date math never touches local time zones.
  function laNow() {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ, year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", hourCycle: "h23",
      }).formatToParts(new Date()).map((x) => [x.type, +x.value])
    );
    return { day: Date.UTC(p.year, p.month - 1, p.day) / 864e5, minutes: p.hour * 60 + p.minute };
  }
  const weekday = (dn) => (dn + 4) % 7; // 1970-01-01 was a Thursday
  const dateOf = (dn) => new Date(dn * 864e5);
  const minutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  function sweptOn(seg, dn) {
    if (weekday(dn) !== seg.day) return false;
    return !seg.weeks || seg.weeks.includes(Math.ceil(dateOf(dn).getUTCDate() / 7));
  }

  // Upcoming sweeps starting today; today's only counts if the window hasn't ended
  function upcoming(seg, count) {
    const now = laNow();
    const out = [];
    for (let dn = now.day; out.length < count && dn < now.day + 120; dn++) {
      if (!sweptOn(seg, dn)) continue;
      if (dn === now.day && now.minutes >= minutes(seg.end)) continue;
      out.push(dn);
    }
    return out;
  }

  function fmtDate(dn, long) {
    const d = dateOf(dn);
    return `${(long ? DOW_LONG : DOW)[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  function relDay(dn) {
    const diff = dn - laNow().day;
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff < 7) return DOW_LONG[weekday(dn)];
    return `in ${diff} days`;
  }
  const fmtWindow = (seg) => `${SweepSign.fmtTime(seg.start)}–${SweepSign.fmtTime(seg.end)}`;
  // "Lincoln Ave → Polk Ave", or just "Boundary St" when the city lists the same cross street at both ends
  const blockLabel = (b) => (b.from === b.to ? `At ${b.from}` : `${b.from} → ${b.to}`);
  function ruleText(seg) {
    const day = DOW[seg.day];
    return seg.weeks ? `${seg.weeks.map((w) => ORD[w]).join(" & ")} ${day}` : `Every ${day}`;
  }

  // ---------- state ----------
  const segById = new Map(DATA.segments.map((s) => [s.id, s]));
  let selectedDay = laNow().day;
  let selectedId = null;

  // group block-sides into blocks, and blocks into streets
  const blocks = [];
  for (const s of DATA.segments) {
    let b = blocks.find((x) => x.street === s.street && x.block === s.block);
    if (!b) blocks.push((b = { street: s.street, block: s.block, from: s.from, to: s.to, sides: [] }));
    b.sides.push(s);
  }
  const sideOrder = "WENS";
  blocks.forEach((b) => b.sides.sort((a, c) => sideOrder.indexOf(a.side) - sideOrder.indexOf(c.side)));
  const blockNum = (b) => parseInt(b.block, 10);
  blocks.sort((a, b) => a.street.localeCompare(b.street, "en", { numeric: true }) || blockNum(a) - blockNum(b));

  // ---------- map ----------
  const touch = matchMedia("(pointer: coarse)").matches;
  const isPhone = () => matchMedia("(max-width: 800px)").matches;
  // a wider hit area on touch screens so a fingertip can pick one side of the street
  const map = L.map("map", { zoomControl: false, renderer: L.canvas({ tolerance: touch ? 14 : 6 }) });
  L.control.zoom({ position: "topright" }).addTo(map);
  // ---------- basemap ----------
  // OpenFreeMap "Positron" vector tiles: free, no key, and no house-number labels. The style is
  // recolored to match the page theme. If WebGL or the style can't load, fall back to raster tiles.
  const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
  const BASE = matchMedia("(prefers-color-scheme: dark)").matches
    ? { land: "#1a1b26", park: "#1d2630", water: "#23304f", building: "#1f2131", road: "#2c3049",
        major: "#363b58", casing: "#1a1b26", rail: "#2c3049", label: "#6b7199" }   // Tokyo Night
    : { land: "#e9eaf0", park: "#dbe8e1", water: "#c8d5f0", building: "#e1e3ec", road: "#ffffff",
        major: "#ffffff", casing: "#cfd3e3", rail: "#cfd3e3", label: "#6172b0" };  // Tokyo Night Day

  function themeStyle(style) {
    for (const l of style.layers) {
      const id = l.id;
      const p = (l.paint ||= {});
      if (l.type === "background" || id === "landuse_residential") p[`${l.type}-color`] = BASE.land;
      else if (id === "water") p["fill-color"] = BASE.water;
      else if (id === "waterway") p["line-color"] = BASE.water;
      else if (id === "park" || id.startsWith("landcover")) p["fill-color"] = BASE.park;
      else if (id === "building") Object.assign(p, { "fill-color": BASE.building, "fill-outline-color": BASE.building });
      else if (l.type === "line" && id.includes("casing")) p["line-color"] = BASE.casing;
      else if (l.type === "line" && id.startsWith("railway")) p["line-color"] = BASE.rail;
      else if (l.type === "line" && /motorway|major/.test(id)) p["line-color"] = BASE.major;
      else if (l.type === "line") p["line-color"] = BASE.road;
      else if (l.type === "symbol") Object.assign(p, { "text-color": BASE.label, "text-halo-color": BASE.land });
    }
    return style;
  }

  // Raster fallback from two keyless providers; a tile that fails is retried from the next one.
  // OSM is first on a real website (it serves an "Access blocked" image to file:// pages, which
  // send no Referer), and Esri is first when opened from disk (its server throttles at times).
  // Muted with a CSS filter on .basemap so the colored sides stand out.
  function addRasterBasemap() {
    const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
    const providers = location.protocol === "file:" ? [ESRI, OSM] : [OSM, ESRI];
    const FallbackTiles = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement("img");
        tile.alt = "";
        tile.setAttribute("role", "presentation");
        let i = 0;
        const urlFor = (tpl) => L.Util.template(tpl, { ...coords, z: this._getZoomForUrl() });
        tile.onload = () => done(null, tile);
        tile.onerror = (e) => (++i < providers.length ? (tile.src = urlFor(providers[i])) : done(e, tile));
        tile.src = urlFor(providers[0]);
        return tile;
      },
    });
    new FallbackTiles("", {
      maxZoom: 19,
      className: "basemap",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; Esri',
    }).addTo(map);
  }

  function addBasemap() {
    const canvas = document.createElement("canvas");
    const webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    if (!webgl || !L.maplibreGL) return addRasterBasemap();
    fetch(OPENFREEMAP_STYLE)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((style) => {
        L.maplibreGL({
          style: themeStyle(style),
          attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
      })
      .catch(addRasterBasemap);
  }
  addBasemap();

  const lines = new Map();
  for (const s of DATA.segments) {
    const line = L.polyline(s.line, { weight: 5, lineCap: "round", opacity: 0.9 });
    if (!touch) line.bindTooltip("", { sticky: true, className: "side-tip", direction: "top", offset: [0, -8] });
    line.on("click", (e) => { L.DomEvent.stop(e); select(s.id); })
      .on("mouseover", () => hover(s.id, true))
      .on("mouseout", () => hover(s.id, false))
      .addTo(map);
    lines.set(s.id, line);
  }
  map.fitBounds(L.featureGroup([...lines.values()]).getBounds(), { padding: isPhone() ? [8, 8] : [30, 30] });
  if (isPhone() && map.getZoom() < 16) map.setZoom(16); // close enough to tell the two sides of a street apart


  let signMarker = null;
  function placeSignMarker() {
    if (signMarker) signMarker.remove();
    signMarker = null;
    if (!selectedId) return;
    const s = segById.get(selectedId);
    const w = isPhone() ? 70 : 92;
    signMarker = L.marker(lines.get(selectedId).getCenter(), {
      icon: L.divIcon({ className: "map-sign", html: SweepSign.signSVG(s), iconSize: [w, w * 1.08], iconAnchor: [w / 2, w * 1.08 + 10] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
  }

  function styleLines() {
    for (const [id, line] of lines) {
      const s = segById.get(id);
      const swept = sweptOn(s, selectedDay);
      const sel = id === selectedId;
      line.setStyle({
        color: swept ? css("--swept") : css("--ok"),
        weight: sel ? 9 : 5,
        opacity: selectedId && !sel ? 0.45 : 0.9,
      });
      if (!touch) line.setTooltipContent(
        `<strong>${s.street}</strong> · ${SIDE_NAME[s.side]}<br>${ruleText(s)}, ${fmtWindow(s)}`
      );
      if (sel) line.bringToFront();
    }
  }

  function hover(id, on) {
    const line = lines.get(id);
    if (id !== selectedId) line.setStyle({ weight: on ? 8 : 5 });
    document.querySelectorAll(`.side[data-id="${id}"]`).forEach((el) => el.classList.toggle("hover", on));
  }

  // ---------- side panel ----------
  function sideButton(s) {
    const swept = sweptOn(s, selectedDay);
    const next = upcoming(s, 1)[0];
    const nextText = swept ? "Swept this day" : next != null ? `Next: ${relDay(next)}` : "";
    return `<button class="side${swept ? " swept" : ""}" data-id="${s.id}" type="button"
      aria-label="${s.street}, ${SIDE_NAME[s.side]}: ${ruleText(s)}, ${fmtWindow(s)}">
      <span class="label">${SIDE_NAME[s.side]}</span>
      <span class="rule">${ruleText(s)}</span>
      <span class="rule">${fmtWindow(s)}</span>
      <span class="next">${nextText}</span>
    </button>`;
  }
  function blockCard(b) {
    return `<div class="block">
      <div class="block-head">
        <span class="block-name">${blockLabel(b)}</span>
        <span class="block-range">${b.block}</span>
      </div>
      <div class="sides">${b.sides.map(sideButton).join("")}</div>
    </div>`;
  }

  const sweptCount = (dn) => DATA.segments.filter((s) => sweptOn(s, dn)).length;

  function buildDays() {
    const today = laNow().day;
    let html = "";
    for (let dn = today; dn < today + DAYS_AHEAD; dn++) {
      const count = sweptCount(dn);
      html += `<button class="day${count ? " has-sweep" : ""}" role="option" data-day="${dn}" type="button"
        aria-label="${fmtDate(dn, true)}: ${count ? `${count} street sides swept` : "no sweeping"}">
        <span class="dow">${dn === today ? "Today" : DOW[weekday(dn)]}</span>
        <span class="num">${dateOf(dn).getUTCDate()}</span><span class="dot"></span></button>`;
    }
    $("day-strip").innerHTML = html;
  }

  function renderDays() {
    const today = laNow().day;
    document.querySelectorAll(".day").forEach((el) => el.setAttribute("aria-selected", +el.dataset.day === selectedDay));
    const count = sweptCount(selectedDay);
    $("day-title").textContent = selectedDay === today ? `Today, ${fmtDate(selectedDay).split(", ")[1]}` : fmtDate(selectedDay, true);
    let summary = `${count} of ${DATA.segments.length} sides swept`;
    if (!count) {
      let next = selectedDay + 1;
      while (!sweptCount(next) && next < selectedDay + 31) next++;
      summary = `No sweeping · next ${next - selectedDay === 1 ? "tomorrow" : DOW_LONG[weekday(next)]}`;
    }
    $("day-summary").textContent = summary;
  }

  function renderList() {
    let html = "";
    let street = null;
    for (const b of blocks) {
      if (b.street !== street) {
        html += `${street ? "</div></div>" : ""}<div class="street-group"><h4>${b.street}</h4><div class="street-card">`;
        street = b.street;
      }
      html += blockCard(b);
    }
    $("street-list").innerHTML = html + "</div></div>";
  }

  function renderDetail() {
    const s = segById.get(selectedId);
    $("d-street").textContent = `${s.street} · ${SIDE_NAME[s.side]}`;
    $("d-block").textContent = `${s.block} block · ${s.from} to ${s.to}`;
    SweepSign.renderSign($("sign"), s);

    const now = laNow();
    const next = upcoming(s, 6);
    const status = $("d-status");
    const inWindow = sweptOn(s, now.day) && now.minutes >= minutes(s.start) && now.minutes < minutes(s.end);
    if (inWindow) {
      status.className = "status-line now";
      status.textContent = `Sweeping now — until ${SweepSign.fmtTime(s.end)}`;
    } else if (next[0] - now.day <= 1) {
      status.className = "status-line swept";
      status.textContent = `${relDay(next[0])}, ${fmtWindow(s)} — move your car`;
    } else {
      status.className = "status-line";
      status.textContent = `Clear until ${fmtDate(next[0])}`;
    }
    $("d-upcoming").innerHTML = next
      .map((dn) => `<li><span>${fmtDate(dn, true)}</span><span class="rel">${relDay(dn)} · ${fmtWindow(s)}</span></li>`)
      .join("");
    const other = DATA.segments.find((x) => x.street === s.street && x.block === s.block && x.side === OPPOSITE[s.side]);
    $("d-other").hidden = !other;
    if (other) {
      $("d-other").textContent = `${SIDE_NAME[other.side]} →`;
      $("d-other").onclick = () => select(other.id);
    }
    $("d-raw").textContent = `City listing: “${s.raw}”`;
  }

  function render() {
    renderDays();
    renderList();
    styleLines();
    $("list-view").hidden = !!selectedId;
    $("detail-view").hidden = !selectedId;
    if (selectedId) renderDetail();
    placeSignMarker();
  }

  function select(id) {
    selectedId = id && segById.has(id) ? id : null;
    const hash = selectedId ? `#${selectedId}` : " ";
    if (location.hash !== hash.trim()) history.replaceState(null, "", hash);
    render();
    if (selectedId) {
      const line = lines.get(selectedId);
      if (!map.getBounds().contains(line.getBounds())) map.panTo(line.getCenter());
      revealPanel();
    }
  }

  // Bring the top of the panel into view: on phones, scroll it up to sit just under the pinned map
  function revealPanel() {
    const panel = $("panel");
    if (!isPhone()) return panel.scrollTo({ top: 0, behavior: "smooth" });
    const mapH = document.querySelector(".map-wrap").offsetHeight;
    const top = panel.getBoundingClientRect().top + scrollY - mapH + 16;
    scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  // ---------- events ----------
  $("day-strip").addEventListener("click", (e) => {
    const btn = e.target.closest(".day");
    if (!btn) return;
    selectedDay = +btn.dataset.day;
    render();
  });
  $("list-view").addEventListener("click", (e) => {
    const btn = e.target.closest(".side");
    if (btn) select(btn.dataset.id);
  });
  $("list-view").addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".side");
    if (btn) hover(btn.dataset.id, true);
  });
  $("list-view").addEventListener("mouseout", (e) => {
    const btn = e.target.closest(".side");
    if (btn) hover(btn.dataset.id, false);
  });
  $("back").addEventListener("click", () => { select(null); revealPanel(); });
  map.on("click", () => select(null));
  addEventListener("hashchange", () => select(location.hash.slice(1)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && selectedId) select(null); });

  const [fy, fm, fd] = DATA.fetched.split("-").map(Number);
  $("fetched").textContent = `${MONTHS[fm - 1]} ${fd}, ${fy}`;
  buildDays();
  select(location.hash.slice(1));
})();
