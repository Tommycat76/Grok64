# Publish notes

Live: https://grok64.grok.me

The August 2026 production chunk `routes-CZHgHMH9.js` crashed on load because `Bl()` called `jsxDEV` in a production bundle. Recovered source in this repo uses the automatic JSX runtime (`react-jsx`) only.

When republishing from Grok Build:

- Do **not** ship development JSX (`jsxDEV`) into production.
- Keep `tsconfig` `"jsx": "react-jsx"`.
- Auth / database stay off.

This repo now has a Vite 8 / TanStack Start `vite.config.ts` that forces Oxc production JSX (`development: false`) and a `npm run check:jsx` gate that fails if `jsxDEV` appears in `dist`. Until grok.me is republished from this tree, https://grok64.grok.me will keep showing `(0 , z.jsxDEV) is not a function`.
