import assert from "node:assert/strict";
import { test } from "node:test";
import { isStillBasicNotGeos } from "./desktop-qa-lib.mjs";

test("rejects stock BASIC as a GEOS deskTop", () => {
  const basic = "    **** COMMODORE 64 BASIC V2 ****\n  64K RAM SYSTEM  38911 BASIC BYTES FREE\nREADY.";
  assert.equal(isStillBasicNotGeos(basic), true);
});

test("rejects JiffyDOS BASIC with typed junk as a GEOS deskTop", () => {
  const jiffy = [
    "       JIFFYDOS V6.01 (C)1989 CMD",
    " C-64 BASIC V2   38911 BASIC BYTES FREE",
    "READY.",
    "NEW",
    "READY.",
    "AD",
    "?SYNTAX  ERROR",
    "READY.",
    ' LOAD"BOOT",8,1',
    "SAVING BOOT",
    "READY.",
    "RUN",
    "READY.",
  ].join("\n");
  assert.equal(isStillBasicNotGeos(jiffy), true);
});

test("does not treat a GEOS bitmap screen dump as BASIC", () => {
  assert.equal(isStillBasicNotGeos("EDEPMSD%IEEEQMTD deskTop"), false);
  assert.equal(isStillBasicNotGeos("BOOTING GEOS ..."), false);
});
