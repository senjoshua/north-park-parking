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

  // Per-browser storage for the theme choice and parking spot. Wrapped because it can throw
  // (private browsing, blocked site data); the page works without it.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
  };

  // Theme: an explicit choice is stored as <html data-theme>; otherwise follow the device setting
  const root = document.documentElement;
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : systemDark.matches);

  const CAR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 11.2 6.7 7.4A2.2 2.2 0 0 1 8.7 6h6.6a2.2 2.2 0 0 1 2 1.4l1.5 3.8"/><path d="M4.5 11.2h15a1.8 1.8 0 0 1 1.8 1.8v3.2a.9.9 0 0 1-.9.9H3.6a.9.9 0 0 1-.9-.9V13a1.8 1.8 0 0 1 1.8-1.8z"/><path d="M6.5 17.1v1.4M17.5 17.1v1.4"/><circle cx="7" cy="14.2" r=".6"/><circle cx="17" cy="14.2" r=".6"/></svg>`;

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
  // the block side the user parked on, saved in this browser only
  let parkedId = segById.has(store.get("parkedSide")) ? store.get("parkedSide") : null;

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
  // quarter-step zooms so the whole area fits snugly in the strip of map visible above the phone sheet
  const map = L.map("map", { zoomControl: false, zoomSnap: 0.25, renderer: L.canvas({ tolerance: touch ? 14 : 6 }) });
  L.control.zoom({ position: "topright" }).addTo(map);
  // ---------- basemap ----------
  // OpenFreeMap "Positron" vector tiles: free, no key, and no house-number labels. The style is
  // recolored to match the page theme. If WebGL or the style can't load, fall back to raster tiles.
  const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
  const PALETTES = {
    dark: { land: "#1a1b26", park: "#1d2630", water: "#23304f", building: "#1f2131", road: "#2c3049",
            major: "#363b58", casing: "#1a1b26", rail: "#2c3049", label: "#6b7199" },  // Tokyo Night
    light: { land: "#e9eaf0", park: "#dbe8e1", water: "#c8d5f0", building: "#e1e3ec", road: "#ffffff",
             major: "#ffffff", casing: "#cfd3e3", rail: "#cfd3e3", label: "#6172b0" }, // Tokyo Night Day
  };

  // Returns a recolored copy of the OpenFreeMap style for the current theme
  function themeStyle(source) {
    const style = structuredClone(source);
    const BASE = PALETTES[isDark() ? "dark" : "light"];
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

  let baseStyle = null;
  let glLayer = null;
  function restyleBasemap() {
    if (glLayer && baseStyle) glLayer.getMaplibreMap().setStyle(themeStyle(baseStyle));
  }

  function addBasemap() {
    const canvas = document.createElement("canvas");
    const webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    if (!webgl || !L.maplibreGL) return addRasterBasemap();
    fetch(OPENFREEMAP_STYLE)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((style) => {
        baseStyle = style;
        glLayer = L.maplibreGL({
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
  if (isPhone()) map.attributionControl.setPosition("topright"); // bottom of the map is under the sheet

  // ---------- phone bottom sheet ----------
  // On phones the panel is a sheet over a full-screen map. It rests at one of three heights
  // (collapsed to the day picker, half, nearly full); drag or tap the handle to move it.
  const panel = $("panel");
  const grab = $("sheet-grab");
  let sheetH = null;
  const brandBottom = () => document.querySelector(".brand").getBoundingClientRect().bottom;
  function snaps() {
    return [document.querySelector(".sheet-top").offsetHeight, Math.round(innerHeight * 0.5), Math.round(innerHeight - brandBottom() - 10)];
  }
  function setSheet(h, animate = true) {
    if (!isPhone()) { panel.style.height = ""; sheetH = null; return; }
    const [min, , max] = snaps();
    sheetH = Math.round(Math.max(min, Math.min(max, h)));
    panel.classList.toggle("dragging", !animate);
    panel.style.height = `${sheetH}px`;
  }
  const nearestSnap = (h) => snaps().reduce((best, x, i, s) => (Math.abs(x - h) < Math.abs(s[best] - h) ? i : best), 0);

  let drag = null;
  grab.addEventListener("pointerdown", (e) => {
    if (!isPhone()) return;
    drag = { y: e.clientY, h: panel.offsetHeight, moved: false };
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 5) drag.moved = true;
    if (drag.moved) setSheet(drag.h + dy, false);
  });
  function endDrag(e) {
    if (!drag) return;
    const start = nearestSnap(drag.h);
    const dy = drag.y - e.clientY;
    let target;
    if (!drag.moved) target = start === 0 ? 1 : 0; // a tap opens a collapsed sheet, otherwise collapses it
    else {
      target = nearestSnap(panel.offsetHeight);
      // a short flick still moves one step in the direction dragged
      if (target === start && Math.abs(dy) > 40) target = Math.max(0, Math.min(2, start + Math.sign(dy)));
    }
    drag = null;
    setSheet(snaps()[target]);
  }
  grab.addEventListener("pointerup", endDrag);
  grab.addEventListener("pointercancel", endDrag);
  addEventListener("resize", () => setSheet(sheetH ?? snaps()[1], false));

  // The part of the map not hidden by the floating title bar or the sheet
  function mapPadding(extraTop = 0) {
    if (!isPhone()) return { paddingTopLeft: [30, 30 + extraTop], paddingBottomRight: [30, 30] };
    return { paddingTopLeft: [16, brandBottom() + 10 + extraTop], paddingBottomRight: [16, (sheetH ?? 0) + 16] };
  }

  setSheet(snaps()[1], false);
  const allBounds = L.featureGroup([...lines.values()]).getBounds();
  map.fitBounds(allBounds, mapPadding(isPhone() ? 28 : 0)); // phones: leave room for the map key


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

  let carMarker = null;
  function placeCarMarker() {
    if (carMarker) carMarker.remove();
    carMarker = null;
    if (!parkedId) return;
    carMarker = L.marker(lines.get(parkedId).getCenter(), {
      icon: L.divIcon({ className: "", html: `<div class="car-pin" title="Your car">${CAR_SVG}</div>`, iconSize: [34, 34] }),
      keyboard: false,
      zIndexOffset: 1000,
      bubblingMouseEvents: false,
    }).on("click", () => select(parkedId)).addTo(map);
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

  function renderCar() {
    const el = $("my-car");
    el.hidden = !parkedId;
    if (!parkedId) return;
    const s = segById.get(parkedId);
    const now = laNow();
    const next = upcoming(s, 1)[0];
    const inWindow = sweptOn(s, now.day) && now.minutes >= minutes(s.start) && now.minutes < minutes(s.end);
    const soon = next != null && next - now.day <= 1;
    let when = next != null ? `Next sweeping ${fmtDate(next)}, ${fmtWindow(s)}` : "";
    if (inWindow) when = `Sweeping now until ${SweepSign.fmtTime(s.end)} — move your car`;
    else if (soon) when = `Sweeping ${relDay(next).toLowerCase()}, ${fmtWindow(s)} — move your car`;
    el.className = `car-card${inWindow || soon ? " alert" : ""}`;
    el.innerHTML = `<div class="car-icon">${CAR_SVG}</div>
      <div>
        <div class="car-title">Your car</div>
        <div class="car-where">${s.street} · ${SIDE_NAME[s.side]}</div>
        <div class="car-meta">${s.block} block · ${blockLabel(s)}</div>
        <div class="car-when">${when}</div>
      </div>
      <div class="car-actions">
        <button class="btn" type="button" data-act="view">View spot</button>
        <button class="btn ghost" type="button" data-act="clear">Moved my car</button>
      </div>`;
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
    const parkedHere = parkedId === s.id;
    $("d-park").innerHTML = parkedHere ? "Parked here · Clear" : `${CAR_SVG}Park here`;
    $("d-park").classList.toggle("ghost", parkedHere);
    $("d-raw").textContent = `City listing: “${s.raw}”`;
  }

  function render() {
    renderDays();
    renderCar();
    renderList();
    styleLines();
    $("list-view").hidden = !!selectedId;
    $("detail-view").hidden = !selectedId;
    if (selectedId) renderDetail();
    placeSignMarker();
    placeCarMarker();
  }

  function select(id) {
    selectedId = id && segById.has(id) ? id : null;
    const hash = selectedId ? `#${selectedId}` : " ";
    if (location.hash !== hash.trim()) history.replaceState(null, "", hash);
    render();
    if (selectedId) {
      revealPanel();
      // keep the side (and the sign drawn above it) in the visible part of the map
      map.panInside(lines.get(selectedId).getCenter(), mapPadding(isPhone() ? 90 : 110));
    }
  }

  // Show the top of the panel; on phones, open the sheet to half so the map stays visible
  function revealPanel() {
    panel.scrollTo({ top: 0, behavior: "smooth" });
    if (isPhone()) setSheet(snaps()[1]);
  }

  function setParked(id) {
    parkedId = id;
    store.set("parkedSide", id);
    render();
  }

  // ---------- light / dark ----------
  function syncThemeUI() {
    const dark = isDark();
    const btn = $("theme-toggle");
    btn.dataset.mode = dark ? "dark" : "light";
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.title = btn.getAttribute("aria-label");
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", css("--panel")));
  }
  function applyTheme() {
    syncThemeUI();
    restyleBasemap();
    render(); // line colors are read from the CSS variables
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
  $("d-park").addEventListener("click", () => setParked(parkedId === selectedId ? null : selectedId));
  $("my-car").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "view") select(parkedId);
    if (act === "clear") setParked(null);
  });
  $("theme-toggle").addEventListener("click", () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    store.set("theme", root.dataset.theme);
    applyTheme();
  });
  systemDark.addEventListener("change", () => { if (!root.dataset.theme) applyTheme(); });
  map.on("click", () => select(null));
  addEventListener("hashchange", () => select(location.hash.slice(1)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && selectedId) select(null); });

  const [fy, fm, fd] = DATA.fetched.split("-").map(Number);
  $("fetched").textContent = `${MONTHS[fm - 1]} ${fd}, ${fy}`;
  syncThemeUI();
  buildDays();
  select(location.hash.slice(1));
})();
