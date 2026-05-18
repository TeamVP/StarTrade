# StarStrat

Proprietary software. All rights reserved.

This is a [Convex](https://convex.dev/) project created with [`npm create convex`](https://www.npmjs.com/package/create-convex).

After the initial setup (<2 minutes) you'll have a working full-stack app using:

- Convex as your backend (database, server logic)
- [React](https://react.dev/) as your frontend (web page interactivity)
- [Vite](https://vitest.dev/) for optimized web hosting
- [Tailwind](https://tailwindcss.com/) for building great looking UI
- [Convex Auth](https://labs.convex.dev/auth) for authentication

## Get started

If you just cloned this codebase and didn't use `npm create convex`, run:

```
npm install
npm run dev
```

If you're reading this README on GitHub and want to use this template, run:

```
npm create convex@latest -- -t react-vite-convexauth
```

For more information on how to configure Convex Auth, check out the [Convex Auth docs](https://labs.convex.dev/auth/).

For more examples of different Convex Auth flows, check out this [example repo](https://www.convex.dev/templates/convex-auth).

## Convex Auth: JWT keys (fix `JWT_PRIVATE_KEY` errors)

Password sign-in needs **RSA keys on your Convex deployment** (not in `.env.local` alone). If sign-up/sign-in fails with `Missing environment variable JWT_PRIVATE_KEY`, run:

```bash
npm run setup:auth
```

That runs [`@convex-dev/auth`](https://labs.convex.dev/auth/setup/manual) and sets `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` on the deployment you pick (use the same dev deployment as `npx convex dev`).

For production, set `SITE_URL` to the live frontend origin that users actually sign into, such as your Vercel custom domain. Keep `http://localhost:5173` only for the local dev deployment.

For Google OAuth, also set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on the same Convex deployment. In Google Cloud, use your Convex HTTP actions URL with `/api/auth/callback/google` as the redirect URI.

For `https://www.starstrat.org/`, register these Google Cloud OAuth values:

- Authorized JavaScript origins: `https://www.starstrat.org`
- Authorized redirect URIs: `https://<your-production-convex-site>.convex.site/api/auth/callback/google`

If you also serve the apex domain, add `https://starstrat.org` as a second JavaScript origin and redirect users consistently to one canonical host.

Then restart `npm run dev`.

If `predev` already ran `setup.mjs --once` and skipped auth setup, you still need to run `npm run setup:auth` once per new machine or deployment. You can also set `JWT_PRIVATE_KEY` and `JWKS` manually under your project in the [Convex dashboard](https://dashboard.convex.dev) → **Settings** → **Environment Variables** (see the manual setup link above for key generation).

## Production deployment: Convex URL

The frontend needs the Convex **Cloud URL** at build time. For Vite deployments, set `VITE_CONVEX_URL` in your hosting provider to the `https://<deployment>.convex.cloud` URL, not the `convex.site` HTTP Actions URL.

If your deployment environment already has `CONVEX_URL`, the Vite config in this repo will also pick that up and inject it into the client build. That value should also be the Cloud URL.

Use the `https://<deployment>.convex.site` HTTP Actions URL only for auth/site configuration such as `CONVEX_SITE_URL`.

## Learn more

To learn more about developing your project with Convex, check out:

- The [Tour of Convex](https://docs.convex.dev/get-started) for a thorough introduction to Convex principles.
- The rest of [Convex docs](https://docs.convex.dev/) to learn about all Convex features.
- [Stack](https://stack.convex.dev/) for in-depth articles on advanced topics.

## Join the community

Join thousands of developers building full-stack apps with Convex:

- Join the [Convex Discord community](https://convex.dev/community) to get help in real-time.
- Follow [Convex on GitHub](https://github.com/get-convex/), star and contribute to the open-source implementation of Convex.
