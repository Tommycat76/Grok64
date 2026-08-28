import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The live grok.me bundle crashed because a production chunk called jsxDEV
// while React's production runtime leaves jsxDEV undefined.
// Force automatic (non-dev) JSX for production builds so that cannot ship.
export default defineConfig(({ command, mode }) => {
  const production = command === "build" || mode === "production";

  return {
    server: {
      host: "0.0.0.0",
      port: 8080,
    },
    resolve: {
      tsconfigPaths: true,
    },
    oxc: production
      ? {
          jsx: {
            runtime: "automatic",
            importSource: "react",
            development: false,
          },
        }
      : undefined,
    plugins: [
      tanstackStart(),
      viteReact({
        jsxRuntime: "automatic",
        jsxImportSource: "react",
      }),
      tailwindcss(),
    ],
  };
});
