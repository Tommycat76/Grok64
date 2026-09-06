/** Resolve a public/ asset for the current Vite base (./ on static dist). */
export function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const clean = path.replace(/^\//, "");
  let rel: string;
  if (base === "/" || base === "") rel = `/${clean}`;
  else {
    const joined = `${base}${clean}`;
    rel = joined.startsWith("./") ? joined : `./${clean}`;
  }
  if (typeof window !== "undefined") {
    try {
      return new URL(rel, window.location.href).href;
    } catch {
      /* fall through */
    }
  }
  return rel;
}
