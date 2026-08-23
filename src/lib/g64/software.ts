export interface BundledTitle {
  id: string;
  name: string;
  kind: string;
  path: string;
  blurb: string;
  tag: string;
}

export const BUNDLED: BundledTitle[] = [
  {
    id: "raster-sid",
    name: "Raster + SID",
    kind: "prg",
    path: "/software/raster-sid.prg",
    blurb: "VIC-II raster bars and a reSID arpeggio. Demo path.",
    tag: "demo",
  },
  {
    id: "byte-hopper",
    name: "Byte Hopper",
    kind: "prg",
    path: "/software/byte-hopper.prg",
    blurb: "Dodge falling bytes. Press FIRE to start, stick to move, fire to retry.",
    tag: "game",
  },
  {
    id: "diagnostics",
    name: "Diagnostics",
    kind: "prg",
    path: "/software/diagnostics.prg",
    blurb: "VIC, SID and CIA smoke test. Fire or any key to exit.",
    tag: "utility",
  },
  {
    id: "ports",
    name: "Port Check",
    kind: "prg",
    path: "/software/ports.prg",
    blurb: "Fire test. Green = port 2, yellow = port 1, white = both.",
    tag: "utility",
  },
  {
    id: "ready",
    name: "BASIC READY",
    kind: "d64",
    path: "/software/blank.d64",
    blurb: "KERNAL cold start with a writable work disk. Banner, 38911 bytes free, READY.",
    tag: "utility",
  },
  {
    id: "workbench",
    name: "Grok64 Workbench",
    kind: "d64",
    path: "/software/grok64-workbench.d64",
    blurb: "1541 disk with every bundled title. Banner, then VICE loads the first file and RUNs.",
    tag: "disk",
  },
  {
    id: "cart",
    name: "Grok64 Cartridge",
    kind: "crt",
    path: "/software/grok64.crt",
    blurb: "8K CBM80 cart in the expansion port.",
    tag: "cart",
  },
  {
    id: "tape",
    name: "Raster SID (tape)",
    kind: "t64",
    path: "/software/raster-sid.t64",
    blurb: "Same demo on a T64 tape image.",
    tag: "tape",
  },
];

export const HVSC_STARTERS = [
  "MUSICIANS/H/Hubbard_Rob/Commando.sid",
  "MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid",
  "MUSICIANS/H/Hubbard_Rob/International_Karate.sid",
  "MUSICIANS/H/Hubbard_Rob/Sanxion.sid",
  "MUSICIANS/H/Hubbard_Rob/Delta.sid",
  "MUSICIANS/G/Galway_Martin/Wizball.sid",
  "MUSICIANS/G/Galway_Martin/Comic_Bakery.sid",
  "MUSICIANS/G/Galway_Martin/Ocean_Loader_1.sid",
  "MUSICIANS/G/Galway_Martin/Green_Beret.sid",
  "MUSICIANS/G/Galway_Martin/Parallax.sid",
  "MUSICIANS/T/Tel_Jeroen/Cybernoid.sid",
  "MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid",
  "MUSICIANS/T/Tel_Jeroen/Turbo_Outrun.sid",
  "MUSICIANS/T/Tel_Jeroen/Myth.sid",
  "MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid",
  "MUSICIANS/H/Huelsbeck_Chris/R-Type.sid",
  "MUSICIANS/F/Follin_Tim/Ghouls_n_Ghosts.sid",
  "MUSICIANS/F/Follin_Tim/Bionic_Commando.sid",
  "MUSICIANS/D/Daglish_Ben/Last_Ninja.sid",
];
