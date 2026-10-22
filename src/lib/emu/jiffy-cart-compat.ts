/**
 * JiffyDOS vs freezer / fast-load cartridges — real-hardware expectations.
 * Both replace or hook KERNAL IEC paths; Grok64 mirrors documented conflicts,
 * not emulator-only bugs.
 *
 * Hardware pairing notes align with community/CMD guidance summarized on
 * https://c64os.com/buyersguide/ and freezer-cart manuals (AR, FC3, Super Snapshot).
 * Spec reference only — no C64 OS files in-tree.
 */

export type FastLoadCartKind =
  | "action-replay"
  | "final-cartridge-3"
  | "super-snapshot-5"
  | "epyx-fastload"
  | "other-fastload";

export type JiffyCompatLevel = "compatible" | "redundant" | "caution" | "incompatible";

export type JiffyCartCompat = {
  level: JiffyCompatLevel;
  title: string;
  summary: string;
  realHardware: string;
  /** Do not enable vice_jiffydos while this cart is the active CRT. */
  suppressJiffy: boolean;
  /** Show a warning if the user leaves Jiffy on (stock KERNAL toggle). */
  warnIfJiffyOn: boolean;
};

/** Hands-on matrix — stock vs Jiffy per cart family (real hardware). */
export const JIFFY_FASTLOAD_CART_MATRIX: {
  id: FastLoadCartKind;
  label: string;
  stockKernal: string;
  jiffyKernal: string;
  reference: string;
}[] = [
  {
    id: "action-replay",
    label: "Action Replay 6 (and AR 4–6 family)",
    stockKernal: "Freezer + AR fast loader work; IEC shortcuts (@$ etc.).",
    jiffyKernal:
      "AR RAM/fast loader and JiffyDOS KERNAL hooks clash — FILE NOT FOUND unless AR fast load is off (@K- or OFF). Freezer can still be used with Jiffy if fast load stays disabled.",
    reference: "1541 Ultimate manual; Lemon64 EF3/AR+Jiffy threads",
  },
  {
    id: "final-cartridge-3",
    label: "Final Cartridge III (FC3)",
    stockKernal: "FC3 fast loader + freezer/monitor; stock KERNAL otherwise.",
    jiffyKernal:
      "Common on real hardware: JiffyDOS KERNAL + FC3 cart. FC3 may win the first LOAD; Jiffy still speeds directories and non-FC3 paths. Not a defect if both are enabled.",
    reference: "Lemon64 JiffyDOS + FC3 combination posts",
  },
  {
    id: "super-snapshot-5",
    label: "Super Snapshot V5",
    stockKernal: "Snapshot fast load and freezer menu.",
    jiffyKernal:
      "Documented incompatible with third-party KERNALs (SpeedDOS, JiffyDOS). Use stock KERNAL or the cart alone — same on hardware.",
    reference: "1541 Ultimate manual (SuperSnapshot vs third-party drive kernels)",
  },
  {
    id: "epyx-fastload",
    label: "Epyx FastLoad",
    stockKernal: "Cartridge IEC fast load; KERNAL unchanged.",
    jiffyKernal:
      "No real benefit: JiffyDOS is faster; Epyx does not replace KERNAL. Harmless but redundant — loads match Jiffy-only timing.",
    reference: "Lemon64 JiffyDOS & Epyx Fastload thread",
  },
  {
    id: "other-fastload",
    label: "Other freezer / turbo carts",
    stockKernal: "Varies by cart.",
    jiffyKernal: "Assume caution until verified; many hook IEC like AR.",
    reference: "Community hardware notes",
  },
];

const DETECT: { kind: FastLoadCartKind; re: RegExp }[] = [
  {
    kind: "super-snapshot-5",
    re: /super\s*snapshot|supersnapshot|\bss[45]\b|snapshot\s*v\s*[45]/i,
  },
  { kind: "action-replay", re: /action\s*replay|actionreplay|\bar\s*[456]|\bar[456]/i },
  { kind: "final-cartridge-3", re: /final\s*cartridge\s*(iii|3|\+)/i },
  { kind: "epyx-fastload", re: /epyx|fast\s*load/i },
];

/** Classify a CRT/bin from filename or catalog title. */
export function detectFastLoadCart(name: string, title?: string | null): FastLoadCartKind | null {
  const hay = `${name} ${title ?? ""}`;
  if (!/\.(crt|bin)$/i.test(name) && !/(cart|cartridge|replay|snapshot|fast\s*load|epyx)/i.test(hay)) {
    return null;
  }
  for (const { kind, re } of DETECT) {
    if (re.test(hay)) return kind;
  }
  if (/\.(crt|bin)$/i.test(name)) return "other-fastload";
  return null;
}

export function jiffyCartCompat(cart: FastLoadCartKind, jiffyOn: boolean): JiffyCartCompat {
  switch (cart) {
    case "super-snapshot-5":
      return {
        level: "incompatible",
        title: "Super Snapshot V5 + JiffyDOS",
        summary: "Super Snapshot needs the stock C64 KERNAL. JiffyDOS is turned off while this cart is loaded.",
        realHardware:
          "Hardware manuals warn Super Snapshot against third-party KERNALs (including JiffyDOS). Use the cart alone or stock KERNAL.",
        suppressJiffy: true,
        warnIfJiffyOn: true,
      };
    case "action-replay":
      return {
        level: "caution",
        title: "Action Replay + JiffyDOS",
        summary:
          "AR fast load and JiffyDOS both hook IEC. On real hardware, disable AR fast load (@K- or OFF) or turn JiffyDOS off to avoid FILE NOT FOUND.",
        realHardware:
          "Physical AR + Jiffy ROM is a known conflict when AR’s RAM/fast loader is active; freezer features can still work with fast load disabled.",
        suppressJiffy: false,
        warnIfJiffyOn: jiffyOn,
      };
    case "final-cartridge-3":
      return {
        level: "compatible",
        title: "Final Cartridge III + JiffyDOS",
        summary: "This pairing is widely used on real C64s. FC3 may handle the first LOAD; Jiffy still helps directories and drive commands.",
        realHardware: "Not a hardware defect if both are enabled — expect FC3 fast load to take precedence on some operations.",
        suppressJiffy: false,
        warnIfJiffyOn: false,
      };
    case "epyx-fastload":
      return {
        level: "redundant",
        title: "Epyx FastLoad + JiffyDOS",
        summary: "JiffyDOS already accelerates loads; Epyx adds little. You can leave either on — timing matches Jiffy-only on many disks.",
        realHardware: "Epyx is not a KERNAL replacement; combining with Jiffy is redundant, not broken.",
        suppressJiffy: false,
        warnIfJiffyOn: jiffyOn,
      };
    default:
      return {
        level: "caution",
        title: "Fast-load cart + JiffyDOS",
        summary: "Many freezer carts patch KERNAL IEC. Test with stock KERNAL or Jiffy alone if loads fail.",
        realHardware: "Treat like Action Replay until verified.",
        suppressJiffy: false,
        warnIfJiffyOn: jiffyOn,
      };
  }
}

/** User wants Jiffy — respect cart suppress rules for the active session. */
export function resolveJiffyWant(jiffyDos: boolean, cart: FastLoadCartKind | null): boolean {
  if (!jiffyDos || !cart) return jiffyDos;
  return jiffyCartCompat(cart, true).suppressJiffy ? false : jiffyDos;
}
