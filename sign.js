// Flat vector street-sweeping sign (SVG), in the style of map-app road sign icons.
(function () {
  const FONT = "Overpass, 'Arial Narrow', sans-serif"; // Overpass is derived from the US highway sign alphabet
  const W = 240;
  const H = 260;
  const BODY = { top: 92, bottom: H - 16, width: 196 }; // text area below the header

  const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const ORD = ["", "1st", "2nd", "3rd", "4th", "5th"];

  function fmtTime(hhmm) {
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`;
  }

  function signLines(seg) {
    const time = `${fmtTime(seg.start)} - ${fmtTime(seg.end)}`;
    if (!seg.weeks) return ["EVERY", DAY_NAMES[seg.day], time];
    return [seg.weeks.map((w) => ORD[w]).join(" & "), DAY_NAMES[seg.day], "EVERY MONTH", time];
  }

  // Rough text width so long lines can be squeezed with textLength instead of overflowing
  const measurer = document.createElement("canvas").getContext("2d");
  function textWidth(text, size) {
    measurer.font = `800 ${size}px ${FONT}`;
    return measurer.measureText(text).width;
  }

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function signSVG(seg) {
    const lines = signLines(seg);
    const slot = (BODY.bottom - BODY.top) / lines.length;
    const size = Math.min(34, slot * 0.78);
    const body = lines
      .map((text, i) => {
        const y = BODY.top + slot * (i + 0.5) + size * 0.36;
        const fit = textWidth(text, size) > BODY.width ? ` textLength="${BODY.width}" lengthAdjust="spacingAndGlyphs"` : "";
        return `<text x="${W / 2}" y="${y.toFixed(1)}" font-size="${size.toFixed(1)}"${fit}>${esc(text)}</text>`;
      })
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Street sweeping, no parking: ${esc(lines.join(" "))}">
      <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="#fff" stroke="#c9cdd3" stroke-width="2"/>
      <rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="13" fill="none" stroke="#111" stroke-width="4"/>
      <line x1="9" y1="80" x2="${W - 9}" y2="80" stroke="#111" stroke-width="4"/>
      <line x1="80" y1="9" x2="80" y2="80" stroke="#111" stroke-width="4"/>
      <g transform="translate(45 45)">
        <circle r="26" fill="#fff" stroke="#d62d2d" stroke-width="6"/>
        <text y="12" font-size="36" fill="#111" text-anchor="middle" font-family="${FONT}" font-weight="800">P</text>
        <line x1="-18" y1="-18" x2="18" y2="18" stroke="#d62d2d" stroke-width="6"/>
      </g>
      <g fill="#111" font-family="${FONT}" font-weight="800" text-anchor="middle">
        <text x="${(80 + W - 9) / 2}" y="41" font-size="23" letter-spacing=".5">STREET</text>
        <text x="${(80 + W - 9) / 2}" y="68" font-size="23" textLength="128" lengthAdjust="spacingAndGlyphs">SWEEPING</text>
        ${body}
      </g>
    </svg>`;
  }

  const fontReady = document.fonts ? document.fonts.load(`800 30px Overpass`).catch(() => {}) : Promise.resolve();

  // Render into an element; re-render once the web font is in so squeezed lines measure correctly
  function renderSign(el, seg) {
    el.innerHTML = signSVG(seg);
    fontReady.then(() => { if (el.dataset.seg === seg.id) el.innerHTML = signSVG(seg); });
    el.dataset.seg = seg.id;
  }

  window.SweepSign = { signSVG, renderSign, signLines, fmtTime };
})();
