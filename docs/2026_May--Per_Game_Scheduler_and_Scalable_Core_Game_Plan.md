# Per-Game Scheduler and Scalable Core Game Plan

Deprecated for active planning. Keep this document for historical review and prior design context, but use [2026_May--Per_Game_Scheduler_and_Scalable_Core_Game_Plan_v2.md](2026_May--Per_Game_Scheduler_and_Scalable_Core_Game_Plan_v2.md) as the working plan.

This document proposes the next architectural step for StarStrat after the current staged-turn controller work.

It complements the existing turn documents:

- `docs/State_Machine.md` remains the authoritative turn-state model.
- `docs/Turn_System.md` remains the running work log for the current implementation.
- `docs/Database_Scalability_May_2026.md` explains why retention and data volume are now primary concerns.

This document answers a broader question:

How should StarStrat be structured so that every new game can run at 10 second turns, with no intentional idle gap between turns, without one bad or heavy game degrading the rest of the deployment?

It also proposes a simplification path away from an empire-centric runtime model and toward a game-actor-centric core game that can scale before trader complexity is added back.

## Executive Summary

The next durable architecture should make four shifts.

### 1. Replace deployment-wide turn polling with per-game scheduled wake-ups

The current once-per-second global sweep is acceptable as a recovery mechanism, but it should stop being the primary runtime driver.

Each running game should own its own scheduled wake-ups for:

- preparation lead start
- turn boundary commit
- recovery only if the expected wake-up was missed

That isolates games from one another and removes most of the shared scheduler pressure created by a deployment-wide poll loop.

### 2. Treat post-turn and post-game cleanup as background work only

A turn should only do the minimum necessary to:

- compute the next turn
- commit the visible turn flip
- schedule follow-up work

Everything else should be handed off to bounded background mutations or actions:

- historical preparation cleanup
- result writing when not needed immediately for the next turn
- event compaction
- finished-game cleanup
- optional transcript export

The visible game loop must not depend on cleanup finishing.

### 3. Reduce data generation, not just data retention

Retention cleanup matters, but it is not enough on its own.

The engine should stop producing high-volume rows unless they are required by the active game mode or by an explicit observability/debug policy.

Examples:

- a conquest-only game should not generate trader simulation data at all
- per-turn economic history should be opt-in or compacted into rollups
- event streams should distinguish player-visible history from debugging exhaust

### 4. Move from empire-centric runtime identity to game-actor-centric runtime identity

The current runtime is centered on `emp_states` and references to `empireId` across many tables. That made sense while “empire” was the main gameplay identity, but it now creates extra schema complexity, indirection, and migration cost.

The simpler long-term model is:

- a game has game actors
- a game actor is either a human-controlled or NPC-controlled runtime actor
- a game actor has a strategy
- a game actor may have a display label, color, and flavor identity
- results are written in terms of the game-actor snapshot that played the game

In that model, “empire” becomes a presentation label and summary concept, not the root runtime identity.

## Problems With the Current Model

The current design has improved substantially, but it still has structural weaknesses.

### Shared scheduler pressure

The current primary driver is still deployment-wide polling.

Even after adding exact wake-up attempts, the `tickRunningGames` cron remains a shared loop over running games. When one game hits an expensive path or generates repeated retries, the deployment accumulates cron backlog and all running games experience more noise and more contention.

### Turn-critical work still sits too close to maintenance work

Recent fixes moved heavy cleanup out of `commitPreparedTurn`, but the architecture still allows follow-up work to sit close to the gameplay-critical path. The correct invariant should be stronger:

- if a job is not required to open the next visible turn, it is background work

### The data model is too expensive for a "core conquest" game

The current table set is broad because it supports:

- conquest
- background traders
- trader identities
- battle history
- economic snapshots
- long-lived event streams
- staged diff logs

That is too much live structure for the simplest version of the game. A scalable core mode should support fast conquest play without paying trader/economy-history costs.

### Runtime identity is split across too many concepts

Today the runtime has overlapping identity concepts:

- `users`
- `usr_profiles`
- `usr_game_roles`
- `emp_states`
- `emp_npc_players`
- `emp_results`
- `sim_game_results`

That makes it harder to reason about ownership, results, and cleanup. The runtime should be centered on the actual actors in a game, not on a separate empire object graph that most tables point at indirectly.

## Architectural Direction

## A. Per-Game Scheduled Turn Driver

### Goal

The primary runtime should become event-driven per game, not sweep-driven per deployment.

### New rule

Every game owns its next wake-ups.

At any moment, each running game should have at most two important future schedule targets:

- the next preparation wake-up
- the next boundary wake-up

These should be scheduled directly when:

- a game starts
- a turn opens
- a game resumes from pause
- a late commit resets the next boundary
- a current wake-up realizes it arrived too early or too late and needs to re-arm

### Recovery path only

A cron should still exist, but only as a coarse safety sweep.

The cron should no longer attempt to progress every running game every second.

Instead it should do bounded recovery work like:

- find games whose scheduled wake-up appears overdue
- find games stuck in `preparing` or `prepared` longer than allowed
- find games missing a scheduled boundary token
- re-arm or recover those specific games

Recommended cadence for the recovery cron:

- every 15 to 30 seconds, not every 1 second

That is frequent enough for recovery, while removing the deployment-wide constant churn.

### Required runtime primitive

The system needs a per-game wake-up lease or generation token.

Without this, old scheduled jobs can still arrive after the game advanced and cause noisy overlap.

Recommended fields on `sim_games` or a dedicated runtime table:

- `nextPreparationWakeAt`
- `nextBoundaryWakeAt`
- `schedulerGeneration`
- `activeResolutionLeaseId`
- `lastWakeScheduledAt`
- `lastWakeObservedAt`

Each scheduled job should carry the expected generation/lease. If the generation does not match when the job runs, it should no-op immediately.

That is the clean architectural version of the stale-job fix already applied.

### Why this helps 10 second turns

With exact per-game wake-ups:

- games no longer wait behind a global sweep
- the wake-up happens at the right instant for that game
- commit can happen immediately when the staged turn is ready
- no idle gap needs to be inserted between turns just to compensate for scheduler lag

This is the necessary foundation for truly continuous 10 second turns.

### Recommended operational model for smooth 10 second turns

The runtime should not wait until the visible turn boundary to start thinking about the next turn.

Instead, each visible turn should run as a prepare-ahead pipeline.

For visible turn $T$:

- clients render the already-committed presentation for turn $T$
- the server accepts player and strategy orders for turn $T + 1$
- at a configured cutoff before the next boundary, the server locks new inputs for turn $T + 1$
- the server resolves and prepares turn $T + 1$ during the remainder of the visible window for turn $T$
- before the boundary, the server publishes the authoritative turn-$T + 1$ package that clients will render as soon as the boundary arrives
- at the boundary, clients switch immediately to rendering turn $T + 1$

That means the visible turn and the server's computation window overlap by design.

For game start, there should be an initial warm-up window before turn 1 begins:

- players submit early orders
- the server validates and prepares turn 1
- clients receive the turn-1 package
- turn 1 animation and sound start exactly when the visible clock begins

This makes the core timing model explicit:

- `turnDurationMs`: total visible turn length
- `orderCutoffLeadMs`: how long before the boundary new orders stop affecting the upcoming turn
- `preparationBudgetMs`: target time budget for resolving the next turn before the boundary
- `presentationLeadMs`: minimum time before the boundary by which the next turn package should be published when things are healthy

The boundary must remain server-authoritative, but the rendering should feel continuous because the next turn has already been prepared and distributed.

### Client contract for precomputed turns

The client should be built around a server-authoritative but presentation-friendly model.

Client rules:

- submit human orders immediately on input, rather than waiting for the end of the visible turn
- submit strategy-generated orders as soon as they are computed
- treat valid human orders as overrides of strategy orders for the same unit or intent
- keep rendering the current committed turn while also caching the prepared package for the next turn
- at the boundary, swap to the prepared next-turn package immediately if it is already present
- if the package arrives late or a client reconnects, fetch the latest committed turn snapshot and catch up from server state

This lets the client keep a local model that converges to eventual consistency without making the client authoritative.

The right mental model is:

- server owns truth
- client owns interpolation, animation, audio scheduling, and graceful catch-up
- every visible turn boundary is driven by an authoritative committed turn package, not by client prediction alone

## B. Strict Separation Between Turn-Critical Work and Background Work

### Turn-critical work

Only these should remain on the critical turn path:

- begin or resume preparation
- resolve staged phases for the current turn
- finalize staged preparation
- commit the prepared turn
- schedule the next preparation/boundary wake-ups

### UI-critical outputs are part of commit, not cleanup

The client cannot wait on background jobs for the data needed to render the next visible turn.

The turn commit path therefore must produce a compact authoritative turn package that is sufficient for immediate client presentation.

That package should contain only what the client needs to begin the next visible turn, for example:

- committed state deltas needed by the game view
- battle and movement outcomes needed for animation
- soundscape cues or timing metadata
- scoreboard/resource deltas needed for turn-open HUD state

By contrast, the following should stay in background work:

- long-form history rows
- admin/debug transcripts
- compaction and export jobs
- durable summary enrichment not needed by the live player view

This is the line that prevents "eventual consistency" from degrading the live turn loop.

### Background work

Everything below should be fire-and-forget follow-up:

- pruning old `sim_turn_preparations`
- pruning old `sim_turn_preparation_ops`
- finished-game result compaction
- optional result enrichment
- event compaction
- historical export
- cleanup of live game payload after finalization
- leaderboard rollups
- diagnostics snapshots

### Required invariant

A background mutation may fail repeatedly without blocking the visible turn loop.

If a background job fails, the game should still continue to resolve new turns.

### Bounded background pattern

Every background worker should:

- process a bounded batch
- reschedule itself if more work remains
- never scan unbounded historical data in one mutation

This pattern is already correct for large deletes in Convex and should become the default operational design.

## C. Reduce Data Generation at the Source

Cleanup helps after the fact. The larger win is to stop writing unnecessary rows.

### Recommended mode architecture: registry-driven composition

The best fit for StarStrat is not a fully generic plugin framework, but it is also not scattered `if mode then ...` checks across every resolver.

The practical middle ground is a registry-driven phase and capability model.

Recommended shape:

- define each phase as a module with a stable key and a narrow interface
- define each game mode in terms of capabilities and active phase keys
- persist the chosen mode/capability set on the game at creation time
- have the turn controller iterate the active phase list for that game rather than branching inline throughout the engine

Each phase module should be responsible for the operations that belong to it, for example:

- whether it participates in preparation
- whether it emits player-visible presentation data
- whether it writes any optional observability rows

For this application, that gives the right balance:

- the conquest core stays lean
- trader and economy behavior are additive modules
- the main turn controller remains understandable
- mode-specific code is localized instead of smeared across the codebase

So the recommendation is: use a registry-driven composition model inside the existing staged-turn architecture, not a broad "if-driven" engine and not an overengineered plugin platform.

### Data classes

The runtime should explicitly classify data into four lifetimes.

#### 1. Live state

Needed to play the game right now.

Examples:

- game runtime state
- game-actor state
- systems
- fleets
- colony ships
- active battles
- active orders

#### 2. Turn-working state

Needed only to resolve the current or immediately upcoming turn.

Examples:

- preparation envelope
- staged ops
- active resolution lease
- turn-local command snapshots

#### 3. Short-lived observability

Helpful for UI/admin/debugging, but disposable.

Examples:

- event transcript
- economic snapshots
- delivered trader history
- historical turn rows past the recent window

#### 4. Durable results

What must remain after the game is over.

Examples:

- game result summary
- game-actor result rows
- optional strategy summary rows

### Concrete data-reduction moves

#### Traderless conquest mode

Introduce a per-game feature set on `sim_games`, for example:

- `mode = conquest_core`
- `mode = conquest_plus`
- `mode = trader_economy`

In `conquest_core`:

- do not create `eco_bg_traders`
- do not create `sim_trader_identities`
- skip trade delivery/spawn phases entirely
- do not write trader-side events

That immediately removes a major source of row growth for the version of the game you want to scale first.

#### Event policy split

Split events into categories.

Examples:

- `player_visible`
- `admin_debug`
- `discardable_runtime`

Then define per-mode retention rules.

For example:

- conquest core keeps only player-visible events for the last N turns
- debug games keep full transcripts temporarily
- official finished games collapse to summary rows only

#### Replace some per-turn history with rolling aggregates

Instead of writing new history rows every turn for all subsystems, maintain rolling counters or short windows where possible.

Examples:

- keep recent economic scarcity streaks on the system row instead of writing every economic snapshot forever
- keep recent battle summary on the system row plus an optional battle transcript only when needed
- keep recent order count / dispatch metrics on the game-actor row for admin diagnostics

#### Make transcript generation optional

A game should not automatically generate full forensic history unless the mode or retention policy asks for it.

Debug-rich transcript generation should be a deliberate choice, not the default for every mission game.

## D. Game-Actor-Centric Runtime Model

Your instinct is directionally right: the engine should care about players and NPC players, not about a separate empire identity being the root concept.

The clean runtime model is a `game actor` model.

### Recommendation

Do not think in terms of “delete every notion of empire overnight.”

Instead:

- replace empire as the root runtime identity
- use `gameActorId` as the runtime ownership key
- keep empire labeling as a presentation snapshot
- avoid bare `actorId` for runtime ownership because it becomes ambiguous as the codebase grows
- migrate tables from `empireId` to `gameActorId`

That gives the simplification benefit without losing color/name/faction flavor.

If the team still prefers the more neutral word `participant` in product docs, that is acceptable. In code and schema, though, `gameActorId` is the clearer choice because it stays distinct from `userId` while leaving room for future actor kinds.

It is also important to separate actors from controllers:

- actors own simulation state
- controllers issue commands for one or more actors

That keeps runtime ownership separate from auth and membership concerns.

### Proposed runtime entity

Add a new table such as `sim_game_actors`.

Suggested shape:

- `gameId`
- `slotNumber`
- `actorKind`: `empire`, `trader`, or another runtime role kind
- `controllerKind`: `human` or `npc`
- `controllerUserId`: nullable for NPCs
- `npcPlayerKey`: nullable for humans
- `displayNameSnapshot`
- `factionLabelSnapshot`
- `colorHex`
- `strategyProfileId`: nullable
- `strategyJsonSnapshot`
- `strategyFingerprint`
- `status`: `active`, `eliminated`, `resigned`
- `eliminatedAtTurn`
- `homeSystemId`
- runtime stats needed for play

### What changes conceptually

Current model:

- user controls empire
- NPC catalog seeds empire
- results refer to empire and then back to user/NPC

Proposed model:

- game has game-actor slots
- each slot is occupied by a human or NPC-controlled game actor
- systems, fleets, and score all belong to the game actor
- empire/faction naming is a snapshot on the game-actor row, not a separate root table

### Why this is simpler

- one actor identity in the runtime
- one join path for ownership
- easier durable results
- easier mission seeding
- easier feature flags by game-actor type
- no need to infer “who really played this empire” later

### What remains profile-driven

A human player can still have profile-owned presentation and strategy data:

- preferred faction labels
- preferred colors
- strategy roster
- preferred default opening strategy

When they join a game, the game snapshots the relevant values into the game-actor row.

That is important: the live game should not constantly dereference mutable profile data during runtime.

### NPC roster model

The existing `emp_npc_players` table already points in the right direction.

For a game start, you should be able to say:

- here are N slots
- fill human reservations first
- fill remaining slots from the active NPC roster

That produces a uniform game-actor list regardless of controller type.

### Mission/single-player implications

For mission games, the scenario should describe game-actor slots, not empires.

For example:

- one slot reserved for the human player
- remaining slots filled by selected NPC catalog entries
- optional fixed colors or faction labels
- optional strategy constraints

That is much cleaner than seeding a separate empire identity layer and then binding users to it afterward.

## E. Conquest-First Product Strategy

The platform should optimize first for a robust empire conquest game that scales.

Trader gameplay can come back as an expansion of the core runtime, not as a mandatory cost paid by every game.

### Recommended product tiers

#### Tier 1: Core conquest

Includes:

- map
- systems
- fleets
- battles
- colony ships
- NPC expansion and military AI
- game-actor strategies

Excludes:

- background traders
- trader identities
- trader-specific events and leaderboards
- full economic market transcript tables

This should be the scaling target for 10 second turns.

#### Tier 2: Conquest plus economy

Adds:

- selective economy simulation
- compact supply/demand modeling
- minimal economic diagnostics

Still excludes full trader actor simulation.

#### Tier 3: Trader game

Adds:

- trader-side players or trader subsystem
- trade routes, trader identity, voyage history
- trader-specific results and leaderboards

This should be treated as an additive mode with its own scalability budget, not as the baseline runtime for all games.

## F. Suggested Migration Plan

This should be done in slices, not as one rewrite.

However, the identity migration should be a versioned structural break, not a long-lived mixed-key runtime.

Recommended rule:

- existing V1 games finish on `empireId`
- newly created V2 games start on `gameActorId`
- avoid dual-writing live ownership across empire and game-actor tables except where a temporary bridge is strictly required

### Slice 1. Per-game scheduler ownership

Goal:

- make exact per-game wake-ups primary
- reduce cron to recovery only

Work:

- add wake-up generation token / lease model
- add per-game next wake metadata
- schedule wake-ups on game start, turn open, and resume
- convert cron from turn driver to recovery sweep

Success condition:

- a healthy game can advance without depending on the global 1 second cron loop

### Slice 2. Background-only maintenance contract

Goal:

- ensure no cleanup can block the visible turn loop

Work:

- audit post-commit and post-finish paths
- move all non-critical work behind bounded scheduled mutations/actions
- add explicit backlog fields for cleanup progress

Success condition:

- a game can continue advancing even if result-writing or cleanup is temporarily failing

### Slice 3. Game mode feature flags

Goal:

- stop generating trader/economy transcript data for conquest-first games

Work:

- add mode/feature flags to `sim_games`
- guard trade phases and trade-table writes behind those flags
- make conquest-core the default for new scaling tests and single-player missions unless trader gameplay is specifically requested

Success condition:

- conquest-core games stop creating trader-side tables entirely

### Slice 4. Game-actor V2 schema introduction

Goal:

- introduce the V2 runtime identity for newly created games

Work:

- add `runtimeVersion` or equivalent version marker on `sim_games`
- introduce `sim_game_actors`
- snapshot human/NPC controller info at game creation/start for V2 games
- make result writing and reads work from game-actor snapshots
- keep V1 game creation and runtime paths intact until active V1 games age out

Success condition:

- new V2 games can resolve game actors through game-actor rows without empire indirection

### Slice 5. Game-actor-first V2 runtime migration

Goal:

- migrate major V2 ownership tables away from `empireId`

Likely order:

- roles/results
- systems/fleets/orders/routes
- battle ownership
- strategy/invalidation logic

Success condition:

- V2 games can operate primarily on `gameActorId` while V1 games continue untouched

### Slice 6. Empire concept reduction

Goal:

- demote empire from root runtime model to label/snapshot model

Work:

- remove or shrink `emp_states`
- preserve faction label, color, and flavor as game-actor snapshot fields
- migrate durable results and UI summaries away from needing live empire rows

Success condition:

- empire is presentation, not ownership

## G. Open Questions

### 1. What should the runtime actor be called?

Recommendation:

- use `gameActorId` in code and schema
- reserve `userId` for account identity
- use "participant" only as optional prose when a neutral word is useful

### 2. Should results remain game-actor-based only, or also expose faction labels?

Recommendation:

- results should be keyed by game actor
- faction/empire label should be a snapshot field on the result row

### 3. Should missions still reference map-native factions?

Recommendation:

- missions should reference slot templates and flavor labels, not runtime empire rows

### 4. Do we need full per-turn event history for finished official games?

Recommendation:

- no, not by default
- keep compact summary plus optional exported transcript for debug/featured games

### 5. Should exact wake-ups be actions or mutations?

Recommendation:

- prefer internal mutations for cheap go/no-go gate checks and state transitions
- only use actions when crossing runtimes or doing non-transactional side work

### 6. How do we prevent duplicate scheduled wake-ups?

Recommendation:

- generation token plus lease ID on `sim_games`
- every scheduled call validates token before doing work

### 7. What should the recovery cron scan?

Recommendation:

Only games that appear abnormal, for example:

- overdue wake-up timestamp
- stuck `preparing`
- stuck `prepared`
- missing next boundary schedule
- cleanup backlog older than threshold

## H. Immediate Recommended Next Implementation Target

The first recommended slices are no longer hypothetical. The scheduler ownership work and the first mode-gating work are now in place.

What remains is to finish the next thin vertical slice without reopening broad schema churn.

- finish conquest-core mode gating across the remaining economy and transcript-producing surfaces
- move phase selection toward a registry-driven mode/capability list instead of ad hoc branching
- keep shrinking the live turn package to only the presentation-critical payload the client needs immediately

That keeps momentum on the two highest-value goals already underway:

- isolate healthy games from deployment-wide scheduler churn
- stop conquest-first games from paying trader/economy costs they do not use

The game-actor migration should still wait until those mode and runtime boundaries are cleaner.

## I. Current Implementation Status

As of May 2026, the plan is partly implemented.

### What has been built so far

- per-game wake metadata on `sim_games`, including generation-based wake ownership
- scheduled wake re-arming on game start, resume, and post-commit turn advance
- stale scheduled wake jobs that no-op cleanly instead of throwing when the generation no longer matches
- recovery-only cron behavior instead of a once-per-second deployment-wide turn driver
- bounded post-commit cleanup handoff so heavy maintenance is no longer on the visible turn commit path
- a shared committed turn presentation package for the live client, replacing several stitched live timeline reads
- admin and running-game UI visibility for game mode and wake scheduling metadata
- initial game mode support with `conquest_core`, `conquest_plus`, and `trader_economy`
- backend trade-phase gating so `conquest_core` skips trader-side turn phases
- frontend trader-screen and galaxy-screen gating so `conquest_core` no longer subscribes to trader data there
- frontend economy-screen gating so `conquest_core` no longer opens the trader-market admin inspector
- backend query guards so public trader/economy queries fast-return empty results for non-trader modes
- backend admin query guards so non-trader games skip heavy economy snapshot reads entirely
- backend trader mutation guards so admin trader actions are rejected for non-trader modes
- mode-aware admin settings reads/writes so non-trader games stop persisting or surfacing trader tuning as if that subsystem were active
- balance and god-mode admin panels now hide trader-only controls for non-trader games while preserving combat and non-trader tuning
- database health/admin observability now skips trader-table pressure sampling for non-trader games and labels those tables as disabled instead of live load
- a shared frontend game-mode helper now drives trader-mode checks in the main galaxy, trader, economy, and admin settings screens instead of repeating raw mode literals everywhere
- history UI now hides trader-only categories and legend entries for non-trader games so the event browser matches the active runtime mode
- a shared backend game-mode contract now owns trader capability checks and the initial active-resolution-phase list instead of duplicating raw mode logic across `sim`, `eco`, and `admin`
- staged turn preparation now honors the same mode contract as live turn resolution, so non-trader games skip trader work during prepare-ahead execution as well
- live turn resolution and staged turn preparation now derive their main next-phase handoffs from the shared backend game-mode contract for the movement-through-garrisons pipeline instead of hard-coding every phase hop in `sim/internal`
- admin home navigation now hides trader-only live and catalog links for non-trader games instead of advertising routes whose runtime is intentionally disabled
- trader charter query and acceptance mutation paths now honor the backend game-mode contract, so non-trader games no longer treat trader charters as a live subsystem
- admin economy, admin traders, and player economy route entry points now redirect away from trader-only pages in non-trader modes instead of leaving those deep links as valid destinations
- the admin trader-NPC catalog route now also redirects away in non-trader modes so trader-only admin catalog pages match the guarded landing and live routes
- central game seeding now skips trader-identity creation for non-trader modes, so conquest games stop populating `sim_trader_identities` during map setup in the first place
- the current repo state has been revalidated with a clean `npx convex dev` startup after the latest mode-routing and mode-aware seeding changes
- admin database health now exposes legacy trader-side row counts for non-trader games, and admins can purge those leftover trader tables in bounded batches from the DB screen
- generic sim event feeds now suppress legacy trader event types for non-trader modes, so history/replay/combat-style recent-event queries stop surfacing `bg_trader_*` events in conquest games
- the `/admin/db` legacy trader cleanup path now also counts and purges leftover trader-only `sim_events` rows (`bg_trader_*`) for non-trader games, closing the loop between hidden legacy events and actual data cleanup
- trader-only live resolution jobs (`traderSetup`, `tradeSpawn`) are now mode-guarded the same way as `trade`, so stale scheduler jobs or legacy phase rows advance harmlessly instead of reviving trader runtime work in non-trader games
- the shared mode registry now has direct unit-test coverage proving conquest modes skip trader-only phases while trader-economy mode preserves them, giving the controller cleanup a narrow regression harness
- staged turn preparation now derives the between-`npc` and pre-`garrisons` phase run from a shared mode helper instead of a hard-coded `if (nextPhaseAfterNpc === "trade")` branch, reducing live/staged controller drift
- the current repo state has now also been revalidated after the latest controller-alignment work with a passing `npx vitest run convex/sim/gameMode.test.ts`, backend/frontend typechecks, and `npx convex dev` reaching `Convex functions ready!`
- the deprecated fallback `resolveTurn` path now also honors the shared mode contract for trader runtime work, reducing one more remaining controller branch that could reintroduce trader-side behavior in non-trader games if invoked
- scheduler-entry/controller start now uses a shared initial resolution-phase constant from the game-mode contract instead of repeating the first phase name as a raw literal across `beginTurnResolution` and staged preparation startup
- internal phase parsing and the first live resolver entrypoint now also use that shared initial-phase constant, further shrinking raw phase-name drift at the start of the split pipeline
- live and staged controller code now also shares an internal helper for “advance from phase X to the next mode-driven phase”, reducing another layer of repeated `nextTurnResolutionPhase(...)` wiring across the split resolver pipeline
- turn-resolution phase parsing/fallback now also lives in the shared game-mode contract instead of a private parser inside `sim/internal`, and the phase regression test covers invalid or missing stored values too
- phase ordering comparison now also lives in the shared game-mode contract, so both staged and live phase loaders use the same behind/at/ahead rule when validating the current resolver step
- the latest controller-centralization pass has now been revalidated with a passing `npx vitest run convex/sim/gameMode.test.ts`, clean backend/frontend typechecks, and `npx convex dev` reaching `Convex functions ready!`
- `/admin/db` now separates active `sim_events` pressure from legacy trader-only `bg_trader_*` rows for non-trader games, so admin observability no longer double-reports those legacy trader events in both the main and legacy sections
- backend trader event-type classification is now centralized, so generic sim event filtering, legacy trader-event counting, and legacy trader-event purge all use the same shared `bg_trader_*` policy instead of duplicated literal lists
- the history UI now also reuses that shared trader event-type policy for its trader-category taxonomy and labels, reducing one more place where frontend/backend `bg_trader_*` handling could drift apart
- trader event emitters now also use shared canonical event constants, so event creation, labels, filtering, and legacy cleanup all reference the same backend `bg_trader_*` keys
- the turn presentation package now also precomputes the previous-turn combat replay event subset for the galaxy map, moving one more client-facing presentation decision onto the server boundary instead of leaving it as raw event filtering in the viewport
- the turn presentation package now also precomputes the recent soundscape event subset, and both backend filtering and frontend soundscape classification reuse the same shared soundscape event taxonomy instead of maintaining separate event-type lists
- the timeline snapshot inside the turn presentation package now also carries authoritative turn-interaction booleans (`isTurnBusy`, `isTurnClockActive`, `acceptingOrders`), so the main panels no longer have to re-derive those edge-case semantics independently from raw `turnState` and `gameStatus`
- current turn-work labeling is now also computed server-side via a shared `turnWorkLabel`, so the turn panel and the running-games dashboard no longer independently format `prepared` versus phase/state labels from raw resolver fields
- the first explicit V1/V2 runtime boundary now exists on `sim_games` via `runtimeVersion`, with new games defaulting to `v1_empire` and existing admin/running-game views surfacing that marker instead of leaving runtime generation implicit
- the first `sim_game_actors` schema slice now exists, and `v2_game_actor` games seed initial actor snapshot rows at `startGame` from the current empire/controller state while V1 games continue to run untouched on `empireId`
- the first V2 read seam now also exists in user/admin role lookups: `getMyGameMembership` and `listGamePlayersForAdmin` attach actor snapshot identity for `v2_game_actor` games while preserving legacy `empireId` fields for V1 consumers
- the admin create-game flow now also exposes `runtimeVersion`, so V2 game-actor games can be created intentionally from the app UI instead of only by manual mutation input
- the empire roster query now also carries bridged actor metadata for `v2_game_actor` games, and the empire panel surfaces actor slot/display identity while still using legacy `empireId` selection underneath
- the first narrow V2 write seam now also exists: `emp.mutations.updateEmpireMeta` can resolve `gameActorId` back through `legacyEmpireId`, and the empire editor/profile flow now uses actor identity when available instead of always posting raw `empireId`
- the live strategic-slider controls now also run through the actor seam for V2 games: `getMyStrategicSliders` returns actor metadata, `patchStrategicSlider` can validate an optional `gameActorId`, and the in-game empire panel now identifies which V2 actor the posture controls are editing when actor metadata is present
- fleet move orders and manual garrison-route edits now also run through the actor seam for V2 games: the fleet mutations can validate an optional `gameActorId`, and both the fleet screen and galaxy map now pass actor identity from game membership when present
- fleet and manual garrison-route reads now also carry bridged actor metadata for V2 games, and the fleet screen surfaces actor slot/display identity in its fleet and route lists while the underlying fleet/runtime ownership still remains keyed by `empireId`
- the galaxy fleet cards at the selected system now also surface that bridged V2 actor identity, so fleet presentation is no longer limited to empire-name-only labels on the map-side ownership panel
- selected-system ownership summaries in the galaxy view now also prefer actor-aware owner labels for V2 games, so colony ownership hints and the main owner field no longer have to describe V2 worlds purely through legacy empire names
- player-facing galaxy overlays now also show an actor-aware ownership summary for V2 games, so start/resign flow messaging can identify the current actor plus its bridged system/fleet counts instead of speaking only in generic empire terms
- fleet orders and garrison routes now also persist an optional direct `gameActorId` for V2 games, so the first operational runtime tables can carry actor ownership explicitly while execution still falls back to `empireId`
- pending move-order reads now also expose actor metadata for V2 games and prefer the stored `gameActorId` when present, extending that first operational seam to adjacent map/runtime reads instead of leaving it write-only
- colony ships now also persist an optional direct `gameActorId` for V2 games, colony-ship actions validate that actor when provided, and colony-ship reads plus selected-system galaxy labels now surface actor metadata instead of staying empire-only
- Priority stars now also persist an optional direct `gameActorId` for V2 games, the priority-star mutation validates that actor when provided, and priority-star reads now carry actor metadata instead of remaining empire-only markers
- actor-only V2 players now also resolve their effective control through `sim_game_actors` when `usr_game_roles.empireId` is absent across fleet routes/orders, colony ships, Priority stars, production sliders, empire economy policy, strategic sliders, and player-owned automation/standing-order profile flows, so those player-scoped reads and mutations no longer fail solely on the missing bridged empire seat binding
- `emp_system_holdings` now also persists an optional direct `gameActorId` for V2 games, actor seeding backfills those holding rows at game start, ownership reconciliation keeps them aligned on later captures/colonization, and the admin economy view now surfaces holding actor identity
- the economy snapshot now also exposes direct V2 system owner-actor metadata, and the player economy screen uses that owner metadata when filtering the focused empire's systems and selected system details, including the player-route case where membership has a V2 actor id but no bridged `empireId`, so player-facing economy ownership no longer depends on inferring V2 ownership from holdings or on the legacy empire bridge for player scope
- `gal_systems` now also persists an optional direct `ownerGameActorId` for V2 games, actor seeding backfills owned systems at game start, colonization/battle/claim/abandon flows keep that owner actor aligned, and the shared systems query now carries direct owner-actor metadata for galaxy presentation
- trader/economy reads now also derive owner labels from direct system actor ownership for V2 games, so trader route details and trader spawn-system inspection no longer have to describe system ownership only through legacy empire identity
- fleet routing screens now also use those shared actor-aware system owner labels for move targets, standing-route origin/destination picks, and saved route summaries, and the Fleet screen now also prefers actor ownership when filtering visible fleets, visible standing routes, and owned systems for V2 players, including the player-home wrapper case where actor membership exists but the bridged `empireId` is absent, so that player-facing fleet view no longer treats ownership as empire-only state or fall back to an unscoped fleet list
- the empire snapshot panel now also prefers actor-aware identity in its main header/roster labels, resolves concrete homeworld names from the shared systems query, and now also counts owned stars from actor ownership for V2 when available, so that player-facing empire summaries no longer present V2 seats only as legacy empire-name rows with anonymous star counts
- the player-home snapshot path now also preserves V2 actor focus through end-of-game cleanup by latching `actorId` alongside `empireId`, and `EmpirePanel` can now resolve its focused snapshot by actor before falling back to the bridged empire row, so that one more player-home summary seam no longer disappears as soon as the legacy empire id drops out
- the player-home empire page now also filters the editable empire roster by V2 actor identity when membership exposes a `gameActorId`, falling back to bridged `empireId` only when actor metadata is absent so that one more player-facing empire-management surface no longer depends solely on the legacy empire bridge
- the combat screen now also prefers actor-aware empire labels in its perspective picker and active-battle summaries, and the player combat route now stays in player-scoped mode when membership exposes only a V2 actor id, so one more player-facing event/combat surface no longer reduces V2 participants to legacy empire-name-only labels or drop actor-only memberships into the generic shared-view fallback
- the galaxy soundscape ownership path now also prefers V2 actor identity for recent-event classification by carrying actor-aware fleet, colony-ship, and system ownership maps into the audio layer, while still falling back to legacy empire ids when actor metadata is absent
- the paginated history event feed now also attaches actor-aware and system-aware display labels at the backend query boundary, and the History screen prefers those labels in its event meta rows so V2 event actors no longer read as generic empire-era type markers
- the shared recent-event feed now also attaches those actor-aware and system-aware display labels at the backend query boundary, and the replay/combat recent-event surfaces prefer them in their event rows so more player-facing event views stop rendering V2 actors as raw ids or generic type markers
- the remaining turn-scoped event queries now also reuse that same backend event-presentation enrichment, so the live turn package and per-turn event feeds stay aligned with history/recent-event labeling instead of leaving one last raw-event boundary in place
- the main galaxy viewport now also prefers V2 actor ownership for player-side fleet selection, including map-marker taps and star-panel fleet cards, owned-system and fleet counts, idle colony-ship filtering and selection, selected colony-ship controls, colony-route drag eligibility and route-prefix validation, standing-route editing, colony-ship dispatch ownership validation, colony-slider and route hint messaging, Priority star scope, lobby start-overlay gating, homeworld auto-focus, and the player-home ownership summary/resign overlay path, so those player-perspective map affordances no longer depend only on bridged empire ownership or fall back to spectator-style summary behavior when only actor identity remains
- the latest polish pass has now also been revalidated with clean backend/frontend typechecks, `npx vitest run convex/col/colonyShip.test.ts`, `npx convex dev --once` reaching `Convex functions ready! (5.39s)`, and `npx convex dev` reaching `Convex functions ready! (5.49s)` after the latest actor-backed control sweep

### What should be working now

- a healthy running game can advance from per-game scheduled wakes without relying on the old once-per-second cron as its primary driver
- stale wake jobs and stale phase-resolution jobs should no longer create noisy overlap failures when a game has already advanced
- turn commits should stay lighter because historical preparation cleanup and finalization-adjacent maintenance are no longer required inline
- the live client should consume one shared turn presentation package for turn timing and recent presentation data instead of stitching multiple timeline sources itself
- new games can be created with an explicit mode, and `conquest_core` should avoid trader-side turn work plus the trader UI, trader queries, trader admin mutations, and trader-market admin screens already gated off
- non-trader games should now also stop exposing trader tuning controls through the admin balance and god-mode settings surfaces
- non-trader games should now stop reporting trader table pressure in the admin database-health view as if those tables were part of the active runtime
- non-trader games should now stop advertising trader-only history filters in the player event browser
- non-trader games should now skip trader-side staged preparation work, not just the live resolution phase and UI/admin surfaces
- the main live resolver and staged prepare-ahead pipeline should now skip directly over trader-only handoff steps in non-trader modes by consulting the shared mode phase sequence instead of bespoke per-phase string targets
- non-trader games should now stop advertising trader-only admin home links and stop serving trader-charter query/mutation behavior as if trader gameplay were active
- non-trader games should now also bounce direct admin/player route entries away from trader-only economy and traders pages instead of relying solely on in-screen disabled states
- non-trader games should now also reject direct entry to the trader-only admin NPC catalog page instead of leaving it as a dead-end route
- newly seeded non-trader games should now avoid trader roster rows at creation time instead of carrying dormant trader identities behind the disabled runtime
- `npx convex dev` and `npx convex dev --once` should complete cleanly in the current repo state, and `npx convex dev` now reaches `Convex functions ready!` after the latest implementation pass
- older non-trader games that still carry legacy trader rows should now be inspectable and cleanable from `/admin/db` without custom terminal scripts
- non-trader games should now also stop surfacing legacy trader events through generic sim event feeds like history, replay, combat, and turn-presentation recent events
- older non-trader games should now also expose any remaining trader-only event rows in `/admin/db`, and the same purge action should retire those rows in bounded batches
- history, recent-event, turn-scoped, replay, combat, and turn-presentation event consumers should now all receive the same actor-aware and system-aware event presentation labels from the backend query boundary instead of mixing enriched and raw event rows
- actor-only V2 players should now also retain player-scoped access to standing routes, colony ships, Priority stars, production sliders, empire economy settings, strategic sliders, and automation profile flows even when the legacy `usr_game_roles.empireId` bridge is absent, because those reads and mutations now resolve control through the active `sim_game_actors` row
- actor-only V2 players should now also keep the correct shared membership state (`empireId`, `empireName`, `isEmpirePlayer`, `isSpectator`) instead of being reported as spectators solely because the legacy role bridge is absent
- actor-only V2 human players should now also remain classified as human-controlled in resign/finalization paths and end-of-game standings instead of being misattributed as NPC-controlled solely because the legacy role `empireId` bridge is absent
- durable V2 finalization results should now also prefer `sim_game_actors` snapshot/controller metadata for `userId`, `playerName`, `npcPlayerKey`, controller kind, and strategy fingerprinting instead of relying only on mutable legacy `emp_states` fields at write time
- durable result read surfaces should now also receive one shared controller label from the backend for finished-game winners and placements, so results/history/turn-summary screens stop rebuilding human-vs-NPC display names independently from raw result rows
- durable result read surfaces should now also expose actor snapshot metadata (`actorId`, `actorSlotNumber`, `actorLabel`) for V2 finished-game winners and placements, so post-game UI can show actor-native identity instead of only legacy empire naming
- campaign lobby progression/history summaries should now also use a shared backend-owned winner display label that folds in actor/controller metadata, so finished mission cards no longer collapse V2 winners back to raw empire names only
- aggregate user and NPC leaderboards should now also retain the latest actor snapshot (`actorSlotNumber`, `actorLabel`) for each ranked row, so the results screen can show recent V2 faction identity instead of only user/NPC totals
- stale or legacy queued trader-phase resolution jobs should now no-op forward for non-trader modes instead of executing trader setup or trader spawn side effects
- `npx vitest run convex/sim/gameMode.test.ts` should now pass and explicitly verify that non-trader modes hop from `npc` to `garrisons`/`finalize` without trader phases
- staged preparation should now follow that same shared phase sequence when deciding whether to run `trade`, `traderSetup`, and `tradeSpawn` work before `garrisons`
- the latest backend/runtime slice should now continue to typecheck cleanly on `convex/tsconfig.json`, and `npx convex dev` should still come up cleanly to `Convex functions ready!`; unrelated frontend diagnostics remain in a few existing UI files and are not part of this Convex migration slice
- even the deprecated fallback turn resolver should now skip background trader runtime work for non-trader modes instead of unconditionally applying trader behavior
- the initial resolution-phase entrypoint for both live and staged controllers should now come from the shared mode contract, and `npx vitest run convex/sim/gameMode.test.ts` should cover that contract explicitly
- the default/fallback parsing of stored turn resolution phases should now also resolve through that same shared initial-phase constant instead of a separate raw literal
- the per-phase live resolvers and staged handoff logic should now use the same internal “advance to next phase” helper rather than each spelling the next-phase lookup inline
- parsing persisted `resolutionPhase` values should now also be centralized in the shared mode contract, with the current test suite covering valid and invalid fallback behavior
- phase-order checks between current and expected resolver steps should now also be centralized in the shared mode contract, with the regression test covering basic ordering expectations
- the current backend/runtime state should now again validate cleanly across `convex/tsconfig.json` and `npx convex dev`; separate frontend diagnostics still remain outside this backend ownership migration pass
- non-trader games viewed in `/admin/db` should now report active `sim_events` separately from legacy trader event leftovers, making the sampled runtime pressure cards match the legacy cleanup section more accurately
- future backend trader event-type additions should now only need one shared policy update to keep event filtering and legacy cleanup behavior in sync
- future trader event-type additions should now also flow through to the history screen taxonomy from that shared policy instead of requiring a separate frontend literal update
- future trader event-type additions should now also update admin/manual trader event emitters through the same shared constants instead of introducing new raw event-type strings in mutation code
- the authoritative live turn package is still only partially complete, but the server now owns at least one exact presentation subset (`previousTurnCombatEvents`) instead of returning only raw event buckets for the map to interpret locally
- the authoritative live turn package now owns both `previousTurnCombatEvents` and `recentSoundscapeEvents`, which reduces one more source of client-side event taxonomy drift while leaving broader HUD/package tightening still to do
- the authoritative live turn package and `listEventsByTurn` now also carry the same actor-aware and system-aware event presentation metadata as history and recent events, reducing another remaining source of raw-event interpretation drift at the query boundary
- the authoritative live turn package now also owns a small but real piece of turn HUD state via shared interaction booleans, reducing another source of panel-by-panel drift while the larger HUD/open-turn payload is still pending
- the server now also owns a shared turn-work label across the live turn package and running-games progress query, which removes another thin but recurring client formatting seam from the current-turn status surfaces
- the repo now also has a concrete V2 migration seam at game creation time because `sim_games.runtimeVersion` is explicit and observable, even though all newly created games still intentionally default to the V1 empire runtime for now
- the repo now also has the first concrete V2 actor table and start-time snapshot seeding path, so the next V2 step is to build a real creation/runtime split on top of seeded game actors rather than starting from a blank schema boundary
- the repo now also has the first actor-aware read seam above raw runtime tables, because membership/admin player queries can now surface `sim_game_actors` identity in V2, and the shared player membership contract now resolves actor-only empire seats back onto their bridged `empireId`/`empireName` instead of reporting them as spectator-state, without forcing the rest of the client off `empireId` yet
- the repo now also exposes that V2 seam through the admin create-game UI and game list, which makes actor-runtime testing and seeded V2 fixture creation possible without terminal-only mutation calls
- the repo now also exposes actor metadata through the shared empire roster query used by galaxy/empire surfaces, which creates a broader actor-first read path without forcing immediate ownership rewrites across those screens
- the repo now also carries actor display-name snapshots through the shared player membership seam, so player-preview routing labels and cleanup-sensitive end-of-game labels can prefer actor-native identity instead of falling back to faction-label-only membership state
- the main galaxy player-ownership summary now also prefers those membership actor display-name snapshots for the local owner label, keeping the player-home/map overlay identity path aligned with the richer shared membership contract
- the repo now also carries actor display-name snapshots through the shared admin/player roster seam used by combat perspective selection, so live player selectors can prefer actor-native identity there too instead of falling back to faction-label-only actor metadata
- the repo now also has its first actor-aware write bridge above the runtime tables, because empire metadata and strategy edits can target V2 actor identity while still landing on legacy empire rows underneath
- the repo now also has its first actor-aware live-game interaction seam, because strategic posture edits in the running empire panel can travel through `gameActorId` validation in V2, strategic-slider reads plus player-owned automation/standing-order profile reads and writes can still resolve the player's empire through actor-backed legacy lookup while now also carrying actor display-name snapshots for player-facing live labels, shared production/economy access helpers now also honor that actor-backed control when the legacy role binding is absent, actor-only resign/retry cleanup now hands the bridged empire row back to NPC control correctly, and finalization now also maps actor-only V2 human seats back onto their bridged empire for standings/result attribution, while the underlying runtime state still patches the bridged empire row beneath that seam
- the repo now also has its first actor-aware fleet interaction seam, because move orders, manual standing-route edits, and player-scoped standing-route reads can resolve V2 control through `gameActorId` and actor-backed legacy empire lookup while the live fleet and route rows still remain keyed by bridged `empireId`
- the repo now also exposes actor identity on shared fleet and route reads, which gives the fleet UI a broader actor-first presentation path without yet migrating the underlying runtime tables off `empireId`
- the repo now also surfaces actor identity in both the fleet screen and the galaxy system fleet panel, which broadens actor-first ownership presentation before true V2 runtime ownership migration lands
- the repo now also uses actor-aware owner labels in the selected-system galaxy summary, which extends the actor-first presentation path from fleets into colony ownership messaging without changing the underlying runtime keys yet
- the repo now also uses actor-aware ownership summaries in the main galaxy overlays, which extends that presentation path from local system panels into player-facing map flow messaging while the counts still derive from bridged `empireId`
- the repo now also stores direct actor ids on manual fleet-order and garrison-route rows for V2 games, and route reads prefer that stored actor identity before falling back to legacy empire lookup
- the fleet-order and manual-route mutation path now also resolves direct actor control server-side from the active membership plus owned fleet/system rows, so V2 writes can stamp `gameActorId` even when the client only carries the bridged empire context and direct actor ownership already exists underneath
- the repo now also stores direct actor ids on V2 fleet rows, backfills seeded fleets when actor snapshots are created at game start, preserves actor ownership on split and garrison-created fleets, and shared fleet reads now prefer that stored fleet actor identity before falling back to legacy empire lookup
- the repo now also exposes actor metadata on pending move-order reads for V2 games, preferring stored `gameActorId` from the order row before falling back to legacy empire lookup through the fleet owner bridge
- the repo now also stores direct actor ids on V2 colony-ship rows, validates actor identity on colony-ship actions, resolves player-scoped colony-ship reads and control through actor-backed legacy empire lookup when `usr_game_roles.empireId` is absent, and surfaces actor-aware colony-ship labels in the galaxy-selected system panel
- the colony-ship mutation path now also resolves direct actor control server-side from the active membership plus owned ship/system rows, so dispatch and colonize can keep using `gameActorId` ownership even when older V2 ship rows or clients still arrive through bridged empire context
- the repo now also stores direct actor ids on V2 Priority star rows, validates actor identity on Priority star writes, and carries actor metadata on Priority star reads while the underlying strategy/runtime logic still consumes bridged `empireId`
- the Priority star mutation path now also resolves direct actor control server-side for V2 memberships, so those writes can stamp `gameActorId` even when the client only carries bridged empire context and direct actor ownership already exists underneath
- the repo now also stores direct actor ids on V2 `emp_system_holdings` rows, backfills them when actor snapshots are created, keeps them aligned through holding reconciliation, and surfaces holding actor labels in the admin economy inspector
- the repo now also exposes direct V2 system owner-actor metadata from the economy snapshot and uses it in the player economy screen's ownership filtering, so focused economy systems and selected-system detail now follow actor identity before falling back to bridged empire ownership
- the repo now also stores direct owner actor ids on V2 `gal_systems` rows, backfills them when actor snapshots are created, keeps them aligned through colonization and combat ownership changes, and exposes owner actor metadata from the shared systems query that drives galaxy presentation
- the repo now also uses that direct V2 system owner metadata in trader/economy reads, so trader route cards and spawn-form system details can show actor-aware owner labels without re-deriving ownership purely from legacy empire names
- the repo now also uses shared V2 system owner metadata in the fleet screen, so move-order targets, route selectors, route summaries, and player-visible fleet/route/system filtering can surface or gate from actor-aware ownership instead of plain system names or legacy-only ownership assumptions
- the repo now also uses actor-aware identity, actor-owned star counts, and resolved homeworld names in the empire snapshot panel, so the player-facing empire roster/header no longer reduces V2 seats to plain empire-name rows plus recalculated anonymous star counts from bridged empire ownership alone
- the repo now also enriches paginated history events with actor-aware and system-aware display labels, so the player event browser can describe V2 actors and owned systems from the backend query boundary instead of rendering only raw event actor/target types
- the repo now also enriches shared recent-event queries with the same actor-aware and system-aware display labels, so replay and combat recent-event surfaces can consume backend-owned event presentation metadata instead of interpreting raw event actor/target ids locally
- the repo now also uses actor-aware empire labels in the combat screen, so perspective selection and active-battle summaries can identify V2 participants without falling back to plain legacy empire names
- the shared active-battle query now also derives V2 side labels and mothership counts from stored fleet and colony-ship actor ownership before falling back to legacy empire grouping, so battle summaries move one more runtime seam off bridged `empireId`
- sim battle event production now also emits actor-side payload ids (`attackerGameActorId`, `defenderGameActorId`, related side arrays, and winner actor ids) from the participating fleet rows themselves, so new combat history starts with actor-first side metadata instead of only legacy empire ids
- the shared event-presentation query boundary now also consumes those battle actor payload ids for history/replay/combat event rows, so battle meta labels can show attacker-versus-defender actor identity instead of only attacker-versus-system or legacy empire-only metadata
- the repo now also uses actor-aware ownership identity in galaxy soundscape playback, so V2 recent-event bells can classify listener-owned versus foreign events from actor ownership first and only fall back to bridged empire identity when necessary
- the repo now also uses actor-aware ownership checks in the main galaxy viewport for player-owned map affordances, so V2 fleet selection, selected colony-ship and standing-route controls, homeworld focus, and ownership summary counts now prefer actor identity before falling back to bridged empire ownership
- shared live ownership helpers now also carry `controlledGameActorId` alongside bridged `controlledEmpireId`, galaxy production/emphasis and food-import write checks prefer direct `gal_systems.ownerGameActorId` ownership when present, and empire-tax writes can now validate an optional `gameActorId` target end-to-end from the economy screen instead of relying only on the bridged empire seat
- the admin economy snapshot now also carries actor metadata on empire rows themselves, so actor-scoped economy views can resolve the focused V2 seat from `actorId` instead of depending on raw empire rows plus legacy-only selection
- the dedicated player economy route now also uses a player-scoped backend snapshot instead of the admin-only economy inspector contract, so empire-seat players can open their own economy page with actor-aware V2 seat resolution, owned-system filtering, market data, and tax controls without hitting an admin-only `forbidden` path
- the fleet standing-route write helper now also revalidates origin ownership against direct `gal_systems.ownerGameActorId` when a V2 route is issued with `gameActorId`, so the lower insert/update path no longer falls back to an empire-only ownership check after actor-aware fleet/system access has already been resolved above it
- battle ownership handoff now also prefers direct participant fleet actor ids when updating `gal_systems.ownerGameActorId` and `emp_system_holdings` for contested wins, defender swaps, and unopposed inhabited claims, so those runtime ownership writes no longer immediately re-derive actor identity from `legacyEmpireId` when the winning fleet already carries `gameActorId`
- shared runtime ownership cleanup now also clears stale actor ownership when the current resolved actor is absent: `reconcileSystemHolding` removes outdated `emp_system_holdings.gameActorId`, garrison fleet merges clear outdated `flt_fleets.gameActorId`, and colonization now patches `gal_systems.ownerGameActorId` from the authoritative resolved winner actor id (or clears it) instead of leaving old actor ownership behind
- startup actor seeding now also backfills direct `gameActorId` ownership onto existing V2 colony ships, Priority stars, and manual garrison routes, and it clears stale actor ids on the already-backed-filled holdings/systems/fleets when the current empire-to-actor map no longer matches, so one more group of runtime rows stops depending on legacy empire-only ownership after actor snapshots are created
- NPC strategy/runtime route maintenance now keeps strategy-managed `flt_garrison_routes` aligned with direct actor ownership on both insert and patch, garrison-route cancellation history now emits `game_actor` actors when a direct route actor is known, shared sim-event history/replay label resolution understands `game_actor` actor/target types, and colony-ship completion events now target the resolved V2 actor instead of only the legacy empire id when the new ship row is created with direct actor ownership
- battle/system runtime event writes now also stay actor-first instead of collapsing back to legacy empire ids: battle reinforcement, battle start, battle round resolution, battle-continues, defender handoff, unopposed system claims, conquered/held system results, collapse, and game-finished history now emit `game_actor` actors whenever the direct participant/winner actor id is already on the fleet or cheaply resolvable in the same flow
- automated garrison-route execution now also validates origin ownership actor-first: when a V2 `flt_garrison_routes` row already carries `gameActorId`, `applyGarrisonRoutes` checks `gal_systems.ownerGameActorId` before falling back to legacy empire ownership, so runtime route invalidation/cancellation no longer relies only on `ownerEmpireId`
- the repo now also treats durable post-game reads as actor-aware result seams, because finished-game winner and placement queries now carry shared controller labels plus actor snapshot metadata including actor display-name snapshots, finished-game surfaces and campaign lobby summaries now render backend-owned actor-aware winner labels that prefer those display-name snapshots over faction-label-only fallbacks, and user/NPC/strategy aggregate leaderboards now retain representative latest actor/controller context so recent V2 faction identity survives past live cleanup instead of collapsing back to raw empire/user/NPC/strategy totals
- the latest polished backend/runtime state has now been revalidated with clean `npx tsc --noEmit -p convex/tsconfig.json --pretty false`, `npx convex dev --once` reaching `Convex functions ready! (5.71s)`, and `npx convex dev` reaching `Convex functions ready! (5.19s)` with no startup errors before clean termination; separate pre-existing frontend diagnostics still remain in a few UI files and were left out of this Convex-focused pass

### What still needs to be built

- finish moving the remaining turn-controller branches and scheduling hooks onto registry-driven phase and capability composition so game modes are declared centrally instead of guarded piecemeal
- broader conquest-core suppression for remaining economy transcript, legacy redirect/nav, and debug/admin surfaces that still assume trader-side data exists outside the now-filtered generic event feeds and legacy trader-table cleanup path
- a tighter authoritative live turn package that carries the exact HUD, combat, movement, and audio-open payload the client needs at the boundary
- a fuller V2 creation/runtime path beyond admin seeding alone, including any player-facing or richer admin workflows that should intentionally choose `v2_game_actor`
- the next V2 step is no longer "introduce `sim_game_actors`"; it is to build on the new seeded actor snapshots by wiring a true V2 creation/runtime path and then gradually moving read/write ownership onto `gameActorId`
- more read seams that prefer actor identity first and use `legacyEmpireId` only as a bridge, starting with the most player-facing runtime surfaces
- the next empire-facing read seams that should stop treating the bridged empire row as the only identity source, especially where per-player perspective, labels, or ownership summaries can become actor-first before write migration
- the next gameplay-adjacent seams that should stop depending on bridged empire identity in V2 beyond the now-validated fleet/order/route/fleet-row, pending-order, battle-summary, colony-ship, Priority star, holding, `gal_systems` ownership, trader/economy presentation, fleet-system presentation, empire-panel presentation, combat presentation, soundscape ownership, and galaxy player-ownership bridges, especially the remaining player-perspective surfaces and runtime tables that still treat `empireId` as the only meaningful owner key
- the next V2 blockers are no longer the already-patched player-owned access seams above; they are the remaining shared role/ownership utilities and runtime tables that still treat `empireId` as the only durable owner key instead of using actor-backed control only as a temporary bridge toward true `gameActorId` ownership
- the follow-on ownership migration from bridged actor-aware UI/mutation surfaces to true `gameActorId` runtime ownership across the main V2 tables
- more actor-aware aggregate analytics beyond the now-patched results cards, especially any deeper cross-game ranking/reporting seams that still summarize durable V2 outcomes without representative actor/runtime context
- further data-generation reduction, especially around event-policy splits, optional transcripts, and rolling aggregates

## J. Implementation Handoff

The first implementation pass should be handed over as four tightly scoped deliverables.

### Deliverable 1. Exact turn pipeline and scheduler contract

Define and implement the timing contract for one running game:

- visible turn duration
- order cutoff lead
- preparation start target
- boundary commit target
- recovery thresholds for overdue wake-ups

Required outcome:

- one healthy game can run continuously from per-game wake-ups alone
- stale scheduled jobs no-op by generation check
- recovery cron only repairs abnormal games

### Deliverable 2. Turn package and client catch-up contract

Define the minimum authoritative package the server must publish for the next visible turn.

Required outcome:

- the client can render the next turn immediately from committed server output
- reconnecting or delayed clients can fetch the latest committed turn package and catch up cleanly
- history/export/debug tables are explicitly excluded from the live rendering dependency chain

### Deliverable 3. Registry-driven mode composition

Refactor phase selection so that game modes activate a declared phase list and capability set.

Required outcome:

- conquest-core executes only the lean phase set
- trader/economy logic is attached through registered modules rather than scattered conditionals
- the turn controller stays readable and mode additions stay localized

### Deliverable 4. V2 game-actor schema decision

Lock the V2 naming and migration boundary before broader ownership rewrites begin.

Required outcome:

- V2 runtime rows use `gameActorId`
- V1 and V2 game creation paths are explicitly separated
- no long-lived plan depends on running mixed `empireId` and `gameActorId` ownership inside the same live game

### Non-goals for the first implementation pass

Do not combine these into Slice 1:

- full V2 ownership migration across all gameplay tables
- trader gameplay redesign
- transcript/export redesign beyond separating live-critical from background-only data
- UI polish beyond the minimum needed to consume committed turn packages and catch up after delay

## Proposed Decision

The cleanest strategic direction is:

- scale the conquest-first game first
- isolate each game’s scheduler from other games
- make all cleanup background-only
- reduce generated data by mode
- migrate runtime ownership from empire-centric to game-actor-centric
- treat empire as a label/snapshot rather than the root live identity

That gets StarStrat to a simpler, faster core loop without blocking the future trader game. The trader game can then be reintroduced on top of a stable game-actor and scheduler foundation instead of being part of every game’s baseline cost.
