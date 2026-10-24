/**
 * Drive combination matrix — smoke maps and row definitions.
 * See docs/DRIVE_COMBO_MATRIX.md (PARKED until Tom unparks).
 */

/** @typedef {"1541"|"1581"|"1571"|"sd2iec"|"cmdhd"|"none"} IecSlotToken */

/**
 * @typedef DriveComboRow
 * @property {string} id
 * @property {string} mapLabel — e.g. "1541·1541·1581·cmdhd"
 * @property {Record<8|9|10|11, IecSlotToken>} iecMap
 * @property {8|9|10|11} pairFrom
 * @property {8|9|10|11} pairTo
 * @property {"LOAD"|"COPY"|"DIR"} op
 * @property {"stock"|"jiffy"} kernal
 * @property {boolean} warp
 * @property {string} reu — e.g. "none", "2048kB"
 * @property {string} [notes]
 * @property {boolean} [parkedSkip] — harness skips until UI/models exist
 */

/** @param {string} label — dot-separated units 8·9·10·11 */
export function iecMapFromLabel(label) {
  const tokens = label.split("·").map((t) => t.trim().toLowerCase());
  if (tokens.length !== 4) throw new Error(`bad map label: ${label}`);
  const slot = (t) => {
    if (t === "1541" || t === "1581" || t === "1571" || t === "sd2iec" || t === "cmdhd" || t === "none") return t;
    throw new Error(`unknown slot token: ${t}`);
  };
  return { 8: slot(tokens[0]), 9: slot(tokens[1]), 10: slot(tokens[2]), 11: slot(tokens[3]) };
}

export function mapId(iecMap) {
  return [8, 9, 10, 11].map((u) => `${u}:${iecMap[u]}`).join("|");
}

/** First rows when matrix is unparked (docs table SM-01…SM-05). */
export const DRIVE_COMBO_SMOKE_ROWS = /** @type {DriveComboRow[]} */ ([
  {
    id: "SM-01",
    mapLabel: "1541·1541·1581·cmdhd",
    iecMap: iecMapFromLabel("1541·1541·1581·cmdhd"),
    pairFrom: 8,
    pairTo: 9,
    op: "LOAD",
    kernal: "stock",
    warp: false,
    reu: "none",
  },
  {
    id: "SM-02",
    mapLabel: "1541·1541·1581·cmdhd",
    iecMap: iecMapFromLabel("1541·1541·1581·cmdhd"),
    pairFrom: 8,
    pairTo: 9,
    op: "COPY",
    kernal: "stock",
    warp: false,
    reu: "none",
  },
  {
    id: "SM-03",
    mapLabel: "1541·1541·1581·cmdhd",
    iecMap: iecMapFromLabel("1541·1541·1581·cmdhd"),
    pairFrom: 8,
    pairTo: 11,
    op: "LOAD",
    kernal: "jiffy",
    warp: false,
    reu: "none",
    notes: "Requires uploaded CMD HD Boot ROM",
  },
  {
    id: "SM-04",
    mapLabel: "sd2iec·1541·none·none",
    iecMap: iecMapFromLabel("sd2iec·1541·none·none"),
    pairFrom: 8,
    pairTo: 9,
    op: "COPY",
    kernal: "jiffy",
    warp: false,
    reu: "none",
  },
  {
    id: "SM-05",
    mapLabel: "1541·1571·1581·none",
    iecMap: iecMapFromLabel("1541·1571·1581·none"),
    pairFrom: 8,
    pairTo: 10,
    op: "LOAD",
    kernal: "stock",
    warp: true,
    reu: "2048kB",
    parkedSkip: true,
    notes: "1571 IEC slot not in Settings UI yet — row SKIP until modeled",
  },
]);

export function rowNeedsCmdHd(row) {
  return Object.values(row.iecMap).includes("cmdhd");
}

export function rowNeeds1571(row) {
  return Object.values(row.iecMap).includes("1571");
}
