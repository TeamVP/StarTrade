# StarStrat

Proprietary software. All rights reserved.

StarStrat is a Convex + React strategy game project focused on short-turn empire play, scalable per-game simulation, and a shared official/community mission and automation catalog.

## Repository

- Primary GitHub repository: `https://github.com/TeamVP/Starstrat`
- Visibility: private
- Local default publish target: `starstrat/main`

## Current scope

- empire-first gameplay with `conquest_core` as the published free mode
- future-gated trader support through `trader_economy`
- admin tooling for missions, strategies, moderation, and metadata convergence
- publisher tooling for community missions and automation strategies

## Local development

```bash
npm install
npm run dev
```

Useful validation commands:

```bash
npx tsc --noEmit -p tsconfig.app.json --pretty false
npx tsc --noEmit -p convex/tsconfig.json --pretty false
npx convex dev --once
```

## Auth setup

Password sign-in requires RSA keys on the active Convex deployment. On a new machine or deployment, run:

```bash
npm run setup:auth
```

That configures `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` for the selected Convex deployment.

For Google OAuth, also set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on the same Convex deployment, and register your Convex HTTP actions callback URL:

- Authorized JavaScript origins: `https://www.starstrat.org`
- Authorized redirect URIs: `https://<your-production-convex-site>.convex.site/api/auth/callback/google`

If you also serve the apex domain, add `https://starstrat.org` as an additional origin and keep one canonical host for sign-in redirects.

## Deployment notes

- Set `VITE_CONVEX_URL` to the Convex Cloud URL: `https://<deployment>.convex.cloud`
- Use the `convex.site` URL only for HTTP actions and auth callback configuration
- `CONVEX_URL` can also be used as the source for the client build if your hosting environment already provides it

## Key docs

- `docs/2026_May--Per_Game_Scheduler_and_Scalable_Core_Game_Plan_v2.md`
- `docs/Turn_System.md`
- `docs/State_Machine.md`
- `docs/Database_Scalability_May_2026.md`
