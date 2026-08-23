# Publishing Grok64

## Live URL

- **https://grok64.grok.me** — primary publish slug
- Sandbox preview hosts under `*.hades-www.grok-sandbox.com` may expire

## Known publish bug (2026-08-23)

Published page crashes:

```
(0 , z.jsxDEV) is not a function
```

**Cause:** Development JSX runtime (`jsxDEV`) leaked into the production bundle.
Production must use the automatic runtime `jsx`, not `jsxDEV`.

**Fix when source workspace is available:**

1. Ensure production build sets `NODE_ENV=production` / Vite `mode: 'production'`.
2. In `tsconfig` use `"jsx": "react-jsx"` (not `react-jsxdev`).
3. Avoid importing `react/jsx-dev-runtime` in app code.
4. Clean rebuild and re-publish to `grok64.grok.me`.

## Rebuild checklist

- [ ] Cold boot: splash → power → blue READY
- [ ] Stick visible (high contrast) on black UI
- [ ] FIRE only on assigned joyport
- [ ] Boulder Dash autoplugs Port 1
- [ ] Tablet: keyboard does not cover stick
- [ ] No reboot on FIRE / port change
