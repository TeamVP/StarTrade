# StarTrade V1 stack and project shape

## Purpose

This document sets out the recommended frontend and supporting stack for **StarTrade V1**, based on the current project structure, the confirmed gameplay direction, and the agreed library choices.

The goal is to keep the stack narrow, modern, and practical: one strong renderer for the galaxy map, one consistent UI layer, one styling approach, and a small set of support tools that reduce future pain when the simulation becomes more complex.

## Current starting point

The current repository already appears to be organized in a sensible way for a Vite + TypeScript + Convex project, with a dedicated `convex/` folder for backend work and a normal `src/` / `public/` frontend split.[file:129]

That means the main need now is not a major restructure. It is to choose a clear V1 shape and stick to it before the codebase grows in too many directions.[file:129]

## Confirmed V1 stack

### Core frontend

- **React + TypeScript**
- **Vite**
- **Convex** for database, functions, live state, and auth

### Rendering and interface

- **PixiJS + `@pixi/react`** for the main galaxy map and any battle-space style visual overlays
- **shadcn/ui** on top of **Radix UI primitives** for interface building
- **Tailwind CSS** for styling
- **Framer Motion** for panel transitions, notifications, and interface motion
- **Lucide React** for icons

### Data, validation, and charts

- **Zod** for validation of game config, map data, and admin tools
- **Recharts** for economy, treasury, production, and battle-history graphs

### Sound, testing, and observability

- **Howler.js** for sound effects
- **Vitest** for unit and logic tests
- **React Testing Library** for component tests
- **Playwright** for end-to-end tests
- **Sentry** for runtime error monitoring
- **PostHog** for product analytics and player-flow analysis

## Why this stack is right for V1

### PixiJS for the main map

PixiJS is the right choice for the actual game surface because StarTrade needs a live, zoomable, pannable, animated star map rather than a DOM-heavy diagramming tool. The map will need system nodes, route lines, fleet travel effects, fog-of-war overlays, selection states, and likely some battlefield-style overlays later.

React should still own the application shell and control panels, but the galaxy itself should be treated as a rendered scene rather than as a pile of DOM nodes.

### shadcn/ui over raw Radix

Since either Radix UI or shadcn/ui is acceptable, the better practical choice is **shadcn/ui**.

Why:
- It is widely used in modern React/Tailwind projects.
- It is built from Radix primitives, so accessibility and interaction behavior are strong.
- It works very naturally with Tailwind.
- It gives you editable source in your own codebase, which is useful when the game UI becomes unusual.
- It does not conflict with PixiJS because the two operate in different layers: Pixi renders the map, while shadcn/ui handles panels, drawers, popovers, tooltips, forms, and dialogs.

### Tailwind for speed and consistency

Tailwind is a good fit because StarTrade will have a lot of stateful panels, mini dashboards, overlays, and utility-heavy screens. It will let you move quickly while still making it easy to define a game-wide design system for spacing, color, and typography.

### Recharts, not a heavier data-viz stack

For V1, Recharts is enough. You do not need D3 complexity just to show price history, treasury movement, fleet counts, food pressure, or battle-loss trends.

### Framer Motion for interface motion only

Framer Motion should be used for the **UI layer**, not for the galaxy renderer. Let Pixi handle map animation and let Framer Motion handle panels, lists, alerts, battle reports, hover reveals, and route-planner transitions.

## Libraries and packages to install

### Core runtime dependencies

```txt
react
react-dom
convex
@convex-dev/auth
pixi.js
@pixi/react
lucide-react
framer-motion
howler
zod
recharts
clsx
tailwind-merge
```

### UI dependencies

```txt
@radix-ui/react-dialog
@radix-ui/react-dropdown-menu
@radix-ui/react-tooltip
@radix-ui/react-tabs
@radix-ui/react-slider
@radix-ui/react-scroll-area
@radix-ui/react-select
@radix-ui/react-popover
@radix-ui/react-toast
```

If using shadcn/ui in the usual way, these will be pulled in as needed while components are added.

### Development dependencies

```txt
tailwindcss
postcss
autoprefixer
vitest
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
playwright
@playwright/test
eslint
prettier
typescript
```

### Monitoring and analytics

```txt
@sentry/react
posthog-js
```

## Suggested V1 project shape

Because the game has several overlapping subsystems, the cleanest `src/` structure is **feature-first with a few shared libraries**, not a pure component-type split.

```text
src/
  app/
    providers/
    router/
    layout/

  features/
    galaxy/
      components/
      hooks/
      pixi/
      utils/

    empire/
      components/
      hooks/
      utils/

    fleet/
      components/
      hooks/
      utils/

    combat/
      components/
      hooks/
      utils/

    economy/
      components/
      hooks/
      utils/

    trader/
      components/
      hooks/
      utils/

    admin/
      components/
      hooks/
      utils/

    replay/
      components/
      hooks/
      utils/

  components/
    ui/
    charts/
    icons/

  lib/
    convex/
    pixi/
    game/
    audio/
    time/
    rng/
    pathfinding/
    analytics/
    errors/
    format/

  config/
    balance/
    maps/
    factions/
    commodities/

  styles/
  types/
  test/
```

## What each top-level area should do

### `src/app/`
This holds application-level concerns: providers, routing, theme, auth wiring, error boundaries, and app shell composition.

### `src/features/galaxy/`
This is where the Pixi map should live. It should own the rendered galaxy stage, camera controls, node rendering, route rendering, selection logic, and map overlays.

### `src/features/empire/`
This should contain the empire dashboard, treasury panel, system list, research progress, food crisis alerts, and homeworld/collapse indicators.

### `src/features/fleet/`
Fleet launch, split, retreat, ETA display, rally controls, and fleet summaries belong here.

### `src/features/combat/`
Battle reports, collateral damage summaries, battle-resolution inspection, and combat UI fragments belong here.

### `src/features/economy/`
This is where price history charts, production summaries, stockpile displays, and later trade-facing visualizations should live.

### `src/features/trader/`
Even though trader play is V2, it is smart to reserve the feature area now so the project shape does not need a future rewrite.

### `src/features/admin/`
This should contain tools for map seeding, debug actions, forced turn stepping, scenario reset, and balance inspection.

### `src/features/replay/`
This is one of the most important non-obvious features. A replay/debug view will save a lot of pain once you start resolving combat, collateral damage, insolvency collapse, and AI decisions.

## Convex-side shape

Since Convex is handling backend state and auth, keep the backend grouped by domain just like the schema.

```text
convex/
  schema.ts

  sim/
    queries.ts
    mutations.ts
    internal.ts

  usr/
    queries.ts
    mutations.ts

  gal/
    queries.ts

  emp/
    queries.ts
    mutations.ts
    internal.ts

  flt/
    mutations.ts
    internal.ts

  eco/
    queries.ts
    internal.ts

  trd/
    queries.ts
    mutations.ts
    internal.ts

  ai/
    internal.ts

  admin/
    actions.ts
```

This matches the grouped table naming approach and keeps backend logic mentally navigable.

## Hard-to-guess support systems you should build early

These are the pieces most teams leave too late.

### 1. Deterministic RNG service
All combat, collateral damage, and any AI randomness should go through one deterministic random service.

Why it matters:
- You can reproduce battles.
- You can replay collapse chains.
- You can debug complaints like “that battle made no sense.”
- You can run fair seeded simulations in tests.

Recommended shape:
- `src/lib/rng/` on frontend for display helpers only
- Convex internal utility for authoritative seeded rolls
- Store roll outputs or roll seeds in turn events

### 2. Turn replay/debug viewer
This is not a luxury. It should exist in V1.

It should answer questions like:
- Why did this empire collapse?
- Why did this fleet lose?
- Which combat rounds damaged food versus population?
- Why did this system stop paying taxes?

Recommended shape:
- Admin/debug route in frontend
- Reads from `sim_events`, battle resolution output, and price history
- Shows step-by-step event timeline per turn

### 3. Event log serializer
Every major turn event should be serializable into a readable log object.

This should include:
- actor
- target
- event type
- turn number
- compact summary
- debug payload

If you do this cleanly early, your UI logs, replay tools, and debugging output all become much easier.

### 4. Pathfinding cache
The galaxy graph is fixed enough that route lookups should be cached aggressively.

Use it for:
- fleet ETA
- trader route planning
- info-age calculation
- nearest-node calculations
- AI target scoring

Recommended approach:
- precompute shortest paths on game boot or map seed
- cache route lengths and next hops
- expose helper functions from a shared utility layer

### 5. Time-sync helper
The 15-second turn timer needs to feel stable and fair.

You will want:
- authoritative server turn timestamp
- client drift correction
- visible countdown smoothing
- resync on reconnect / tab restore

Without this, players will see jumpy or inconsistent clocks and lose trust in the game.

### 6. Admin map seeder
Because the galaxy is fixed-map based, an admin seeder is part of the real product workflow, not just a dev convenience.

It should support:
- loading a galaxy template
- placing initial empires
- assigning homeworlds and core worlds
- setting stockpiles and treasury starting values
- reseeding a test galaxy quickly

### 7. Balance constants file
Do not bury combat, tax, food, or damage numbers across many files.

Keep tunable numbers centralized:
- turn length
- defender multiplier
- tax per population
- starvation factor
- homeworld bonus
- collateral damage chance
- commodity base prices
- charter rates

Recommended shape:
- `src/config/balance/` for shared typing and client-readable constants
- Convex-side mirrored constants or a generated shared module for server authority

### 8. Asset pipeline
You do not need a huge art pipeline yet, but you do need consistency.

V1 should establish:
- star icon set or rendering rules
- system badge style
- faction color tokens
- fleet marker styles
- ownership ring styles
- alert icon states
- sound naming conventions

Otherwise visual language becomes inconsistent very quickly.

## Recommended UI approach

### Use shadcn/ui for these parts
- dialogs
- sheets
- tabs
- dropdown menus
- tooltips
- sliders
- toasts
- scroll areas
- command palette

### Use custom components for these parts
- galaxy HUD
- system detail panel
- fleet launch strip
- battle report cards
- event timeline
- replay inspector
- star-system mini badges

The reason is simple: generic components are fine for common interactions, but the actual game surfaces should feel specific to StarTrade.

## Recommended Tailwind shape

Create a small game design system early.

Suggested token groups:
- background / panel / panel-muted / panel-strong
- empire colors
- alert colors
- map overlay colors
- typography scale for HUD, panel, and micro labels
- spacing scale for game UI density

Also define a consistent z-index ladder for:
- map
- selection overlays
- HUD
- drawers
- modal dialogs
- toasts

## Sound suggestions for V1

Use sound sparingly.

Good candidates:
- turn tick / turn rollover
- fleet arrival
- battle start
- battle won / lost
- food crisis alert
- empire collapse alert
- trader sale success later in V2

Use Howler.js as a thin playback layer, not as a system that drives game logic.

## Testing strategy

### Vitest
Use for:
- battle formulas
- collateral damage rules
- tax calculation
- collapse logic
- route ETA logic
- price calculation
- solvency checks

### React Testing Library
Use for:
- system panel behavior
- fleet launch controls
- alerts
- replay panel rendering
- route planner behavior later

### Playwright
Use for:
- join game flow
- empire turn flow
- fleet launch flow
- battle result display
- reconnect behavior
- pause budget behavior

The main point is that the **game rules** need tests earlier than the map polish does.

## Analytics and logging suggestions

### Sentry
Use Sentry for:
- runtime frontend errors
- rendering crashes
- failed data assumptions
- production exceptions from strange state combinations

### PostHog
Use PostHog for:
- first-session drop-off
- time to first fleet launch
- time to first conquest
- use of pause feature
- average session length
- repeated confusion points in panels or onboarding

### Internal event logging
Beyond Sentry and PostHog, keep your own structured gameplay event stream. This is essential for replay and debugging, not just product analytics.

## Auth and player model

Since Convex Auth is part of the chosen stack, use it as the single auth layer for StarTrade V1.

Suggested model:
- one authenticated `user`
- that user may join a game as an empire player, trader, or observer depending on game phase and permissions
- role bindings live per game, not globally
- auth identity should stay separate from in-game empire identity

That separation matters because one account may play different roles in different galaxies.

## V1 implementation checklist (living document)

Use this as the source of truth for **what is in the repo today** versus **what full V1 still needs**. Last aligned with the codebase **May 2026**.

### Done (shipped in repo)

**Convex / simulation**

- [x] Grouped schema (`sim_*`, `gal_*`, `emp_*`, `flt_*`, `eco_*`, `trd_*`, `usr_*`) plus Convex Auth tables
- [x] Indexes for typical reads (games, systems and links by game, fleets by game, events by game/turn, orders by game/turn)
- [x] Domain-shaped function modules under `convex/` (`sim`, `gal`, `emp`, `flt`, `eco`, `trd`, `usr`, `admin`, `ai`, …)
- [x] Admin seed: placeholder galaxy (systems, empires, holdings, hyperlanes, **two starter fleets**)
- [x] **Playable manual loop:** `createGame` → seed → **`startGame`** → issue fleet **move** orders for **current turn** → **`stepTurn`** (`resolveTurn`: arrivals, applied orders, treasury stub, `eco_market_snapshots`, `sim_turns` / `sim_events`)
- [x] Bidirectional link checks for fleet moves (`convex/gal/linkUtils.ts`)
- [x] Query for **pending move orders** on a turn (`flt/queries.listPendingMoveOrdersForTurn`) for UI preview lines

**Auth & ops**

- [x] Convex Auth (password provider), `auth.config.ts`, `http.ts` routes
- [x] **`JWT_PRIVATE_KEY` / `JWKS` / `SITE_URL`:** documented fix via `npm run setup:auth` and README (deployment env vars, not Vite-only)

**Frontend**

- [x] Vite + React + TypeScript + Tailwind (`@tailwindcss/vite`)
- [x] Routing: `/`, `/fleet`, `/combat`, `/economy`, `/sign-in` with authenticated shell + **TopNav**
- [x] Providers: `ConvexAuthProvider`, optional Sentry/PostHog bootstrap (`AnalyticsProvider`)
- [x] Lightweight UI layer: `Button`, `Card`, `cn` (`clsx` + `tailwind-merge`) — **not** a full shadcn CLI install yet
- [x] **Galaxy:** PixiJS + `@pixi/react` **v8** (`extend({ Graphics })`, `pixiGraphics`), live systems/links from Convex, empire colors on stars
- [x] **Fleets on map (idle):** markers outside the system ring; **select + drag** to a linked system queues a move order; **dashed lines** for pending moves (in-flight drag preview + server-backed pending list)
- [x] Sidebar: turn controls (`start` / `step`), empire snapshot, **event log** (recent `sim_events`), admin create/seed panel
- [x] Fleet screen: form-based orders with neighbor-safe targeting

**Supporting stubs (structure only)**

- [x] `src/config/balance/constants.ts`, sample map keys, `src/lib/{rng,time,pathfinding,audio}` helpers as placeholders
- [x] Feature folders (`features/*`) and types aligned with the recommended tree

**Delivery**

- [x] Source hosted on GitHub (`TeamVP/StarTrade`) with an initial commit describing the playable slice

---

### Still to do (toward full V1 PRD)

Prioritize in roughly this order unless product cuts scope.

**Core gameplay & rules**

- [ ] **Automated 15s turn clock** (cron / scheduler + pause rules per PRD), not only manual **Step turn**
- [ ] **Combat:** battle resolution, casualties, collateral to systems/stockpiles, persisted battle outputs and UI on `/combat`
- [ ] **Economy:** production, consumption, stockpiles, prices driven by simulation rules (not only stub snapshots); **Recharts** on `/economy`
- [ ] **Information / fog:** observation aging, visibility rules per PRD
- [ ] **Empire collapse / succession** and AI opponents (`ai/` beyond stub)
- [ ] **Convex-side deterministic RNG** for rolls; replay ties rolls to events

**UX / UI**

- [ ] **System detail panel** (emphasis, stockpiles, alerts) and clearer **first-session onboarding**
- [ ] **Full shadcn/ui** install and shared component library per stack doc (dialogs, sheets, toasts, etc.)
- [ ] **Framer Motion** on primary panels and notifications
- [ ] **Replay / debug viewer** beyond a flat event list (filter by turn, actor, drill-down payloads)

**Backend polish**

- [ ] **Replace or merge duplicate move orders** same fleet / same turn if design calls for “latest wins”
- [ ] **Role model:** assign `empire` (and later `observer` / `trader`) per game; tighten mutations beyond “admin can do everything”
- [ ] **Pathfinding / ETA:** precomputed routes or cached shortest paths for AI and UI ETAs
- [ ] **Admin:** full reseed/reset, scenario templates, optional `admin/actions` parity with mutations

**Quality**

- [ ] **Vitest:** rules (tax, combat, starvation, turn transitions)
- [ ] **RTL:** panels and forms
- [ ] **Playwright:** sign-in → seed → order → step turn
- [ ] **Sentry + PostHog** wired with meaningful events and error boundaries in production builds

**Observability / assets**

- [ ] Howler-backed **SFX** for key beats (turn tick, arrival, battle, alerts)
- [ ] **Art/UI tokens** (faction colors, fleet markers, alerts) documented and applied consistently

---

### How to use this with phased roadmap

The **Recommended implementation order** section below is still the *intent*. This checklist tracks **concrete repo progress** against that intent and against **`2026_May--StarTrade_v1_PRD.md`**. Update checkboxes when merging meaningful slices, not for every small refactor.

## Recommended implementation order

### Phase 1 — foundation
- Convex schema and grouped function layout
- Convex Auth wiring
- Tailwind setup
- shadcn/ui setup
- PixiJS stage integration
- map seed loading
- shared design tokens

### Phase 2 — core V1 play loop
- galaxy map rendering
- system selection
- empire overview panel
- fleet launch and movement
- turn clock sync
- event log foundation

### Phase 3 — combat and economy
- battle resolution output
- collateral damage summaries
- production and stockpile panels
- treasury and tax indicators
- replay/debug viewer first version

### Phase 4 — hardening
- tests for rules and state transitions
- Sentry and PostHog integration
- admin seeding tools
- asset cleanup and UI consistency pass

## Short recommendation summary

If the goal is a strong V1 without drifting into framework sprawl, the best shape is:

- **React + TypeScript + Vite** for the app shell
- **Convex + Convex Auth** for state, backend logic, and identity
- **PixiJS + `@pixi/react`** for the galaxy play surface
- **shadcn/ui + Tailwind** for the interface layer
- **Recharts + Framer Motion + Lucide + Howler + Zod** as focused support tools
- strong early investment in **deterministic RNG, replay/debug, event serialization, pathfinding cache, time sync, map seeding, balance constants, and an asset pipeline**

That gives StarTrade a practical V1 foundation that is game-shaped rather than generic dashboard-shaped.
