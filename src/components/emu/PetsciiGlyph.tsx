import { glyphHasPixels, glyphPath, petsciiToScreen } from "@/lib/emu/petscii-glyphs";

export function PetsciiGlyph({
  petscii,
  size = 10,
  className,
}: {
  petscii: number;
  size?: number;
  className?: string;
}) {
  const screen = petsciiToScreen(petscii);
  const d = glyphPath(screen);
  if (!d || !glyphHasPixels(screen)) return null;
  return (
    <svg
      className={className ? `g64-petg ${className}` : "g64-petg"}
      viewBox="0 0 8 8"
      width={size}
      height={size}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d={d} />
    </svg>
  );
}
