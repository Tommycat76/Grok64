import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const {
  geosFamilyDesktopOk,
  isGeosFamilyDiskName,
  isWheelsDiskName,
  reuForGeosFamilyDisk,
  WHEELS_BOOT_REU,
} = await server.ssrLoadModule("/src/lib/emu/geos-boot.ts");
await server.close();

describe("geos-boot", () => {
  it("detects Wheels disks", () => {
    assert.equal(isWheelsDiskName("Wheels64_v4.4.d64"), true);
    assert.equal(isWheelsDiskName("GEOS64_2.0.d64"), false);
  });

  it("detects GEOS family", () => {
    assert.equal(isGeosFamilyDiskName("GEOS64_2.0.d64"), true);
    assert.equal(isGeosFamilyDiskName("Wheels64.d64"), true);
    assert.equal(isGeosFamilyDiskName("paradroid.d64"), false);
  });

  it("bumps REU for Wheels", () => {
    assert.equal(reuForGeosFamilyDisk("Wheels64.d64", "none"), WHEELS_BOOT_REU);
    assert.equal(reuForGeosFamilyDisk("Wheels64.d64", "512kB"), "512kB");
    assert.equal(reuForGeosFamilyDisk("GEOS64_2.0.d64", "none"), "none");
  });

  it("desktop heuristics", () => {
    assert.equal(geosFamilyDesktopOk("GEOS DISK DIRECTORY", "GEOS64_2.0.d64"), true);
    assert.equal(geosFamilyDesktopOk("WHEELS DASHBOARD", "Wheels64.d64"), true);
    assert.equal(geosFamilyDesktopOk("FILE NOT FOUND", "Wheels64.d64"), false);
    assert.equal(geosFamilyDesktopOk("NO REU PRESENT", "Wheels64.d64"), false);
  });
});
