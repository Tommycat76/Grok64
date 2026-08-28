import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import appCss from "../styles.css?url";

const APP_NAME = "Grok64";

function RootError({ error }: { error: Error }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div style={{ fontFamily: "Figtree, system-ui, sans-serif", background: "#0a0a0b", color: "#f2f2f3", minHeight: "100dvh", padding: "2rem" }}>
          <p style={{ fontFamily: "Archivo, system-ui, sans-serif", fontWeight: 700 }}>Grok64</p>
          <p>The emulator hit a snag. Reload the page to try again.</p>
          <pre style={{ color: "#a1a1aa", whiteSpace: "pre-wrap" }}>{error.message}</pre>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  errorComponent: RootError,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "theme-color", content: "#0a0a0b" },
      {
        name: "description",
        content: "Phone-and-tablet Commodore 64 emulator. VICE WASM, reSID, 1541 true-drive.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
