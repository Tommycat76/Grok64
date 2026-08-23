# Publish notes

Live: https://grok64.grok.me

The August 2026 production chunk `routes-CZHgHMH9.js` crashed on load because `Bl()` called `jsxDEV` in a production bundle. Recovered source in this repo uses the automatic JSX runtime (`react-jsx`) only.

When republishing from Grok Build:

- Do **not** ship development JSX (`jsxDEV`) into production.
- Keep `tsconfig` `"jsx": "react-jsx"`.
- Auth / database stay off.
