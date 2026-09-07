/** Short git SHA baked at build + the hashed routes bundle id from the running page. */

function gitShort(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_G64_GIT?: string } }).env;
  const raw = env?.VITE_G64_GIT;
  if (raw && raw !== "dev") return raw.slice(0, 7);
  return "dev";
}

export function routesBundleId(): string | null {
  if (typeof document === "undefined") return null;
  for (const el of document.querySelectorAll("script[src]")) {
    const src = (el as HTMLScriptElement).src || "";
    const hit = src.match(/routes-([A-Za-z0-9_-]+)/i);
    if (hit?.[1]) return hit[1];
  }
  return null;
}

export function readBuildId(): { git: string; routes: string | null; label: string } {
  const git = gitShort();
  const routes = routesBundleId();
  return {
    git,
    routes,
    label: routes ? `${git} · ${routes}` : git,
  };
}
