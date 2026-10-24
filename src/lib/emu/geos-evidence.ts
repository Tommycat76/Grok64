/** GEOS 2.0 directory listing must show GEOS-named files on the C64 screen. */
export function geosDirectoryOnScreen(screen = ""): boolean {
  if (!screen.trim()) return false;
  if (/FILE NOT FOUND|DEVICE NOT PRESENT|\?FILE/i.test(screen)) return false;
  return (
    /"GEOS\b/i.test(screen) ||
    /\bGEOS\s+SEQ\b/i.test(screen) ||
    /\bGEOS\s+PRG\b/i.test(screen) ||
    /GEOS\s{2,}"/i.test(screen)
  );
}
