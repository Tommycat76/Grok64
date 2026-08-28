# Publish notes

Live: https://grok64.grok.me

The August 2026 production chunk `routes-CZHgHMH9.js` crashed on load because `Bl()` called `jsxDEV` in a production bundle. Recovered source in this repo uses the automatic JSX runtime (`react-jsx`) only.

When republishing:

- Keep `tsconfig` `"jsx": "react-jsx"`.
- Production builds must go through `vite.config.ts` (`g64-production-jsx`): never emit `jsxDEV`, and alias leftover `react/jsx-dev-runtime` imports to `src/shims/jsx-dev-runtime.ts`.
- Auth / database stay off.
