#!/usr/bin/env python3
"""Snapshot street-sweeping schedules around 32nd St in North Park into data/segments.js.

Source: City of San Diego GeoSweep "Street Sweeping Route" layer (public ArcGIS
MapServer). The page itself stays fully static; re-run this to refresh data.

  python3 tools/build_data.py
"""
import json
import math
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYER = "https://webmaps.sandiego.gov/arcgis/rest/services/GeoSweep/GeoSweep_Dynamic/MapServer/13/query"

# Blocks shown on the map: Iowa St to 33rd St, University Ave to Orange/Howard Ave.
# A block is kept when its midpoint falls inside AREA; the east edge follows 33rd St, which runs at a slant.
AREA = [  # (lng, lat), clockwise from the southwest corner
    (-117.1266, 32.7483),  # Iowa St & University Ave
    (-117.1266, 32.7542),  # Iowa St & Howard Ave
    (-117.1228, 32.7542),  # 33rd St & Orange Ave
    (-117.1228, 32.7516),  # 33rd St & Polk Ave
    (-117.1221, 32.7504),  # 33rd St & Lincoln Ave
    (-117.1215, 32.7483),  # 33rd St & University Ave
]
BBOX = (min(x for x, _ in AREA), min(y for _, y in AREA), max(x for x, _ in AREA), max(y for _, y in AREA))

DAYS = {"Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6, "Sun": 0}
SIDES = {"NS": "N", "SS": "S", "ES": "E", "WS": "W"}
SIDE_OFFSET_M = 5.5  # how far each side's line is drawn from the centerline


def fetch():
    params = {
        "geometry": ",".join(map(str, BBOX)),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "OBJECTID,RD20FULL,LLOWADDR,LHIGHADDR,RLOWADDR,RHIGHADDR,XSTRT1,XSTRT2,SCHEDULE,COMMENT_",
        "f": "json",
    }
    url = LAYER + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)["features"]


def in_area(lng, lat):
    """Ray-casting point-in-polygon test against AREA."""
    inside = False
    for (x0, y0), (x1, y1) in zip(AREA, AREA[1:] + AREA[:1]):
        if (y0 > lat) != (y1 > lat) and lng < x0 + (lat - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def parse_time(s):
    m = re.fullmatch(r"(\d{1,2})(?::(\d\d))?\s*(am|pm)", s.strip().lower())
    h = int(m[1]) % 12 + (12 if m[3] == "pm" else 0)
    return f"{h:02d}:{m[2] or '00'}"


def parse_schedule(text):
    """'Posted (8am - 11am), ES Mon, WS Thu' -> {start, end, sides: {E: {...}, W: {...}}}"""
    m = re.search(r"\((\d[^)]*?)\s*-\s*([^)]*)\)", text)
    start, end = parse_time(m[1]), parse_time(m[2])
    sides = {}
    for part in text[m.end():].split(","):
        pm = re.fullmatch(r"\s*(NS|SS|ES|WS)\s+(?:(\d)\w\w\s*&\s*(\d)\w\w\s+)?(\w{3})\s*", part)
        if not pm:
            continue
        weeks = [int(pm[2]), int(pm[3])] if pm[2] else None  # None = every week
        sides[SIDES[pm[1]]] = {"day": DAYS[pm[4]], "weeks": weeks}
    return start, end, sides


def offset_line(path, side):
    """Shift a [lng, lat] path sideways toward compass side N/S/E/W."""
    lat0 = math.radians(path[0][1])
    mx, my = 111320 * math.cos(lat0), 110540  # meters per degree
    (x0, y0), (x1, y1) = path[0], path[-1]
    dx, dy = (x1 - x0) * mx, (y1 - y0) * my
    n = math.hypot(dx, dy)
    nx, ny = -dy / n, dx / n  # left-hand normal
    want = {"N": (0, 1), "S": (0, -1), "E": (1, 0), "W": (-1, 0)}[side]
    if nx * want[0] + ny * want[1] < 0:
        nx, ny = -nx, -ny
    return [[round(lat + ny * SIDE_OFFSET_M / my, 6), round(lng + nx * SIDE_OFFSET_M / mx, 6)] for lng, lat in path]


def title(s):
    s = s.title().replace(" Av", " Ave")
    return re.sub(r"(\d)(St|Nd|Rd|Th)\b", lambda m: m[1] + m[2].lower(), s)


def main():
    segments = []
    for f in fetch():
        a, path = f["attributes"], f["geometry"]["paths"][0]
        # keep only blocks whose midpoint is inside AREA (drop ones that just touch it)
        mid = [(path[0][0] + path[-1][0]) / 2, (path[0][1] + path[-1][1]) / 2]
        if not in_area(*mid):
            continue
        if not (a["SCHEDULE"] or "").startswith("Posted ("):
            print(f"skipping unposted block: {a['RD20FULL']} {a['SCHEDULE']!r}")
            continue
        start, end, sides = parse_schedule(a["SCHEDULE"])
        lo = min(a["LLOWADDR"], a["RLOWADDR"])
        hi = max(a["LHIGHADDR"], a["RHIGHADDR"])
        for side, rule in sides.items():
            segments.append({
                "id": f"{a['OBJECTID']}-{side}",
                "street": title(a["RD20FULL"]),
                "block": f"{lo}–{hi}",
                "from": title(a["XSTRT1"]),
                "to": title(a["XSTRT2"]),
                "side": side,
                "day": rule["day"],
                "weeks": rule["weeks"],
                "start": start,
                "end": end,
                "raw": a["SCHEDULE"],
                "line": offset_line(path, side),
            })
    segments.sort(key=lambda s: (s["street"], s["block"], s["side"]))
    out = {"source": "City of San Diego GeoSweep", "fetched": date.today().isoformat(), "segments": segments}
    dest = ROOT / "data" / "segments.js"
    dest.write_text("// Generated by tools/build_data.py — do not edit by hand.\nwindow.SWEEP_DATA = "
                    + json.dumps(out, indent=1, ensure_ascii=False) + ";\n")
    print(f"wrote {dest} ({len(segments)} block-sides)")


if __name__ == "__main__":
    main()
