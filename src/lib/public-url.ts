/** Resolve a public/ asset for the current Vite base (./ on static dist). */
export function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const clean = path.replace(/^\//, "");
  if (base === "/" || base === "") return `/${clean}`;
  const joined = `${base}${clean}`;
  return joined.startsWith("./") ? joined : `./${clean}`;
}
