import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const jsxDevShim = path.resolve(root, "src/shims/jsx-dev-runtime.ts");

/**
 * grok64.grok.me crashed with `(0 , z.jsxDEV) is not a function` because the
 * production chunk still called React's development JSX runtime. Production
 * React has no `jsxDEV`. Force the automatic production runtime for builds,
 * and map any leftover `react/jsx-dev-runtime` imports to a shim that aliases
 * `jsxDEV` → `jsx`.
 */
function productionJsx(): Plugin {
  return {
    name: "g64-production-jsx",
    apply: "build",
    config() {
      return {
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
        },
        oxc: {
          jsx: {
            runtime: "automatic",
            development: false,
            importSource: "react",
          },
        },
        resolve: {
          alias: {
            "react/jsx-dev-runtime": jsxDevShim,
          },
        },
      };
    },
    generateBundle(_options, bundle) {
      const leaks: string[] = [];
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        if (/from\s*["']react\/jsx-dev-runtime["']/.test(chunk.code)) {
          leaks.push(fileName);
        }
      }
      if (leaks.length) {
        throw new Error(
          `Production bundle imported react/jsx-dev-runtime (${leaks.join(", ")}). ` +
            "That is the grok64.grok.me crash: jsxDEV is not a function.",
        );
      }
    },
  };
}

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 8080,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    productionJsx(),
    tailwindcss(),
    tanstackStart({
      server: {
        build: {
          staticNodeEnv: true,
        },
      },
    }),
    viteReact({
      jsxRuntime: "automatic",
    }),
  ],
});
