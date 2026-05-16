# Turn System — Work Log and Improvement Notes

This document records the specific problems found, the changes made, the design decisions taken, and the known remaining issues with StarTrade's turn execution engine as of May 2026.

It is a working companion to [State_Machine.md](State_Machine.md), which owns the authoritative state diagram and transition rules. This document tracks the engineering history and the outstanding improvement backlog.

The goal of this document is not just to describe what broke. It should give future work a stable set of invariants: what the server promises, what clients should assume, what can safely change, and which parts of the staged execution pipeline still need hardening.

---

## Background

The game runs on a Convex backend. Each game has a `sim_games` row that carries the visible turn number and boundary clock, plus one `sim_turns` row per turn. "Resolution" refers to the full pipeline that simulates a turn's outcomes and opens the next turn.

Before this work, the full pipeline:

1. ran on the live tables at the boundary
2. mutated live rows immediately
3. committed (opened turn N+1) only after all simulation work finished

That meant the next turn could open already partway elapsed if simulation took longer than the turn duration, and players could not issue orders while preparation was in flight because the live turn was locked out.

## Executive Summary

The turn system now works as a two-phase controller:

1. the visible turn remains authoritative for player interaction and stays `open` until the actual boundary
2. turn preparation can run ahead of time against a staged snapshot
3. the staged result is committed at the boundary as a durable diff apply
4. if inputs change before the boundary, the staged result is invalidated and recomputed

That architecture is materially better than the old boundary-only live mutation path because it separates player-facing turn availability from server compute cost.

The work in this thread fixed three concrete failures in that architecture:

1. pre-boundary staging was closing the visible turn too early
2. staged snapshot loading assumed every table had a `by_gameId` index
3. staged queries did not support range predicates used by 10-turn economic review logic

The result is that turn preparation can happen early without cutting off order entry, and the known production stalls at turn 1 and turn 10 are fixed.

## Current Architecture in Plain Terms

The current controller should be understood as four separate concerns.

### 1. Visible turn state

`sim_games` and `sim_turns` define what players see now:

- the currently visible turn number
- the visible boundary clock
- whether the turn is still `open`
- whether the game is paused, running, or finished

This is the state clients should trust for countdowns, order-entry affordances, and turn-driven animation.

### 2. Preparation envelope

`sim_turn_preparations` owns the lifecycle of precomputed work for a specific `(gameId, turnNumber)`:

- `queued`
- `preparing`
- `prepared`
- `committed`
- `stale`

This envelope exists specifically so expensive simulation can happen before the visible boundary without mutating live state.

### 3. Durable staged diff

`sim_turn_preparation_ops` stores the exact operations produced during staged simulation. Commit applies that durable diff instead of re-running the full turn simulation at the boundary.

This is the core scalability improvement because it makes boundary-time work cheaper and more predictable.

### 4. Staged query adapter

[convex/sim/stagedTurnStore.ts](../convex/sim/stagedTurnStore.ts) wraps the live Convex context and provides an in-memory overlay for staged tables. This adapter is the most fragile part of the current system because it must behave closely enough to real Convex queries for all simulation code that runs inside staging.

The production failures in this thread both came from that adapter, not from the high-level controller.

## Key Invariants

Future edits should preserve these unless there is an explicit redesign.

1. The visible turn must remain `open` until the real turn boundary. Pre-boundary compute must not close the order-entry window.
2. Pre-boundary preparation must never mutate live simulation tables.
3. Commit must apply only a staged result that still matches the latest preparation envelope for that turn.
4. If a player mutation changes current-turn simulation inputs while the turn is still `open`, any staged result for that turn must be invalidated.
5. If preparation finishes after the target boundary, the next visible turn must start at commit time, not be backdated.
6. Clients should treat server-authored timing as authoritative and derive local display from that timeline, not from isolated browser clocks.
7. Any code path executed inside staged preparation must either be supported by the staged adapter or deliberately routed to the real database.

---

## Changes Made in This Thread

### 1. Pre-boundary staged preparation (`keep turns open during pre-boundary staging`)

**Problem.** The turn controller was flipping `sim_turns.state` from `open` to `preparing` as soon as the preparation lead window opened, even if the visible boundary had not arrived yet. Players lost the order-entry window early.

**Root cause.** `beginTurnResolution` unconditionally set `state = preparing` whenever the preparation lead window opened, regardless of whether the actual turn boundary had elapsed.

**Fix.** [convex/sim/internal.ts](../convex/sim/internal.ts) was updated so that:

- Before the visible boundary, only the preparation envelope (`sim_turn_preparations`) moves to `state = preparing`. The live `sim_turns` row stays `open`.
- At or after the boundary (or if the already-in-progress preparation finishes after the boundary), the live row is locked to `state = preparing`.
- `prepareTurnWithStaging` tracks the `startedAt` of the preparation run it opened. If the envelope has been replaced by the time staging finishes (because a player edit invalidated it), the stale result is discarded silently.

**New file.** [convex/sim/turnPreparationInvalidation.ts](../convex/sim/turnPreparationInvalidation.ts) — provides `invalidateOpenTurnPreparation`, which resets the preparation envelope to `queued` and deletes any staged ops. This ensures the controller re-prepares from the current live state on its next wake-up.

**Wired into all current-turn input mutations:**

| File | Mutations |
|---|---|
| [convex/flt/mutations.ts](../convex/flt/mutations.ts) | `issueFleetOrder`, `setGarrisonRoute` |
| [convex/col/mutations.ts](../convex/col/mutations.ts) | `startColonyShipBuild`, `cancelColonyShipBuild`, `dispatchColonyShip`, `colonize` |
| [convex/emp/mutations.ts](../convex/emp/mutations.ts) | `updateEmpireMeta` (strategy changes), `patchStrategicSlider` |
| [convex/gal/mutations.ts](../convex/gal/mutations.ts) | `setEmphasis`, `adjustFoodImportSubsidy`, `setPriorityStar` |
| [convex/usr/mutations.ts](../convex/usr/mutations.ts) | `refreshStandingOrders` |
| [convex/sim/mutations.ts](../convex/sim/mutations.ts) | `rebuildStandingOrders` (all modes) |

**Commit:** `e4e2f09` (`keep turns open during pre-boundary staging`)

---

### 2. Missing staged snapshot for `eco_bg_traders` (`fix staged trader snapshot loading`)

**Problem.** Turn resolution crashed immediately on every game, with:

```
Uncaught Error: Index eco_bg_traders.by_gameId not found.
```

Turns never advanced past turn 1.

**Root cause.** The staged turn store's `loadTableRows` function has table-specific cases for `flt_orders` and `sim_game_settings`, but falls through to a generic `withIndex("by_gameId", …)` for all other tables. The `eco_bg_traders` table does not have a `by_gameId` index; its indexes are `by_gameId_and_status` and `by_gameId_and_etaTurn_and_status`.

**Fix.** [convex/sim/stagedTurnStore.ts](../convex/sim/stagedTurnStore.ts) — added an explicit `case "eco_bg_traders"` that loads all three status buckets (`enRoute`, `delivered`, `cancelled`) through `by_gameId_and_status`.

**Commit:** `856d6cb` (`fix staged trader snapshot loading`)

---

### 3. Missing range predicate support in the staged query adapter (`support staged range queries`)

**Problem.** Turn resolution crashed on every 10th turn, with:

```
Uncaught TypeError: e.eq(...).gte is not a function
```

Games stalled at turns 10, 20, 30, etc.

**Root cause.** The in-memory `StageIndexBuilder` class only implemented `eq`. The automated NPC trader limit review (`maybeAdjustAutomatedNpcTraderLimits`) runs on every 10th turn and queries `eco_bg_traders` with a range predicate:

```ts
q.eq("gameId", gameId).gte("deliveredTurn", fromTurn).lte("deliveredTurn", toTurn)
```

When this ran inside the staged snapshot context, the shim did not expose `.gte(...)`, so it threw.

**Fix.** [convex/sim/stagedTurnStore.ts](../convex/sim/stagedTurnStore.ts) — extended `StageIndexBuilder` with `gt`, `gte`, `lt`, `lte` methods, added a `compareValues` helper that handles numbers, strings, and bigints, and updated `matchesStageFilter` to dispatch the correct comparison. The `materialize` loop now calls `matchesStageFilter` instead of a bare `valuesEqual` check.

**Commit:** `4081e6b` (`support staged range queries`)

---

## Validation Performed in This Thread

These fixes were not only reasoned about locally. They were exercised against the real deployed game that had been stalling.

### Production validation

- Re-ran `sim/actions:resolveTurnJob` for the stuck production game at turn 1 and confirmed successful commit to turn 2.
- Re-ran `sim/actions:resolveTurnJob` for the same production game at turn 10 and confirmed successful commit to turn 11.
- Deployed the fixes to the production Convex deployment after each staged-adapter repair.
- Manually unblocked the live game twice during diagnosis and confirmed the game resumed advancing.

### Local validation

- Typechecked the Convex backend after the turn-system changes.
- Updated [docs/State_Machine.md](State_Machine.md) so the design document matches the actual controller behaviour.

This matters because the staged controller can appear locally correct while still failing only on production data shape or on a later-turn code path. The turn 10 bug is a concrete example of that class of failure.

---

## Current Known Gaps in the Staged Adapter

The `StageQuery` shim in [convex/sim/stagedTurnStore.ts](../convex/sim/stagedTurnStore.ts) is hand-rolled and only approximates Convex query semantics. These limitations are not yet fixed:

### 3a. Ordering does not match real Convex index order

Real Convex indexes impose a sort by the indexed fields. The staged adapter sorts only by `_creationTime` + `_id`, so any simulation logic that depends on result order from a non-default index may see a different order than it would at commit time. This is mostly benign today, but can produce subtle non-determinism if simulation reads ordered results for a decision (e.g., picking the first matching fleet).

### 3b. Range filters are evaluated post-hoc rather than index-guided

The staged adapter loads all rows for a table and filters in memory. On large games the `eco_bg_traders` load can scan all three status buckets fully. This is functionally correct but costs more than a real indexed range scan.

### 3c. No support for `filter(...)` predicates after `withIndex`

Convex allows `.filter((q) => q.eq(q.field("x"), v))` on top of an index query. The staged shim has no `filter()` method. If any simulation path adds a `.filter()` call it will crash at the same point.

### 3d. `unique()` is not schema-enforced

The shim throws if more than one row matches, mimicking Convex's unique() behaviour, but it does not enforce the uniqueness at insert time, so a bug that inserts a duplicate into the stage will only surface at query time.

### 3e. The adapter surface is still incomplete by construction

The current staged adapter is an allowlist implementation. It supports only the subset of query behaviour that simulation has used so far. That means each new simulation feature added inside `prepareTurnWithStaging` is a potential compatibility risk until proven against the adapter.

This is the single biggest long-term maintenance cost in the current design.

---

## Operational Failure Modes and How to Think About Them

There are now three main failure classes.

### 1. Controller-state bugs

Symptoms:

- players lose the ability to issue orders before the countdown hits zero
- a turn shows `preparing` too early
- commit never happens even though preparation seems done

Likely source:

- [convex/sim/internal.ts](../convex/sim/internal.ts)
- [convex/sim/turnTiming.ts](../convex/sim/turnTiming.ts)
- [convex/sim/actions.ts](../convex/sim/actions.ts)

### 2. Staged adapter compatibility bugs

Symptoms:

- resolution works for some turns and crashes for others
- production-only failures tied to specific systems like trader economy or scheduled reviews
- errors mentioning missing indexes, unsupported methods, or query builder mismatches

Likely source:

- [convex/sim/stagedTurnStore.ts](../convex/sim/stagedTurnStore.ts)

### 3. Operational backlog or thrash

Symptoms:

- preparation repeatedly restarts near the boundary
- the same turn spends a long time in `queued` or `preparing`
- players making rapid edits near the boundary cause repeated invalidation and missed precompute windows

Likely source:

- invalidation strategy
- lead-time tuning
- lack of telemetry on preparation duration and invalidation count

The practical lesson is that not all turn failures mean the core turn controller is wrong. The adapter and the surrounding scheduling/invalidation policy are independent failure surfaces and should be debugged as such.

## Debugging Runbook

When a live game is stuck, future debugging should follow this order.

1. Check the visible turn row and preparation envelope separately. Do not infer one from the other.
2. Confirm whether the game is stuck before boundary, during preparation, or during commit.
3. If staging crashed, inspect the failing code path for unsupported staged query behaviour before changing controller logic.
4. If preparation was invalidated, confirm whether the invalidation was correct or whether the system is thrashing on high-frequency edits.
5. Only after the above, manually re-run the turn job for the specific turn.

Two specific anti-patterns to avoid:

1. Do not use `sim_turns.state` alone as the source of truth for staged work progress.
2. Do not assume a staged query bug will show up on turn 1. The turn 10 failure only triggered when a periodic subsystem ran.

---

## Outstanding Improvement Work

### High priority

**Staged adapter: full-table fallback audit**

Every table in `STAGED_SIM_TABLES` should be checked against the live schema to confirm the `default` fallback path (`withIndex("by_gameId", …)`) is valid for that table. Tables that lack a plain `by_gameId` index (like `eco_bg_traders`) need explicit cases. A unit test that calls `createStagedTurnContext` with an empty game and exercises every table's load path would catch future schema additions that break this silently.

**Staged adapter: `filter()` method**

Add a `filter(predicate)` method to `StageQuery` so simulation code can safely use `.filter()` on top of an index query without crashing. The implementation only needs to evaluate the predicate as a post-load in-memory step.

**Staged adapter: compatibility test harness**

Build a focused test harness around [convex/sim/stagedTurnStore.ts](../convex/sim/stagedTurnStore.ts) that exercises the real simulation entry points used by staging against a seeded game. The purpose is not just unit coverage of helper methods; it is to catch query-shape drift whenever simulation code starts using a new part of the Convex query surface.

**Preparation telemetry and alerting**

Persist and surface per-turn metrics such as:

- preparation duration
- number of invalidations before commit
- op count written to `sim_turn_preparation_ops`
- delay between target boundary and actual commit
- whether a turn committed from a precomputed result or from a late boundary-time preparation

Without this, lead-time tuning and stuck-turn detection will stay manual.

### Medium priority

**Staged adapter: index-aware ordering**

For tables where simulation reads ordered results and makes decisions on them, add per-table sort key configuration so the staged snapshot sorts consistently with the real index. The most sensitive tables are `flt_fleets` (arrivals scan by `etaTurn`) and `flt_garrison_routes`.

**Staged adapter: insert deduplication guard**

Add an assertion in the staged `insert` path that detects a duplicate virtual ID before inserting. This makes bugs that double-insert a row surface immediately rather than silently producing a pair that crashes on `unique()` later.

**Preparation invalidation: scope to mutations that read staged tables**

Currently `invalidateOpenTurnPreparation` is called broadly on any mutation that touches current-turn inputs. Some of those (e.g., `adjustFoodImportSubsidy`) affect only economy tables that are already read inside staging, but others (e.g., NPC strategy updates) affect only un-staged tables. A finer-grained check that only invalidates when a staged table is actually modified would reduce unnecessary re-preparation.

**Preparation invalidation: observable event**

When preparation is invalidated mid-flight the controller silently discards the result. Adding a `sim_event` or a `summaryJson` note to the preparation envelope would make this visible in admin tooling and help diagnose games that cycle repeatedly without committing.

**Preparation invalidation: debounce window near the boundary**

If players submit several order edits in quick succession just before the boundary, the current policy can thrash by repeatedly clearing prepared work. A short debounce or "prepare again after quiet period" policy would reduce wasted recompute while still preserving correctness.

**Legacy `resolveTurn` removal**

The old `resolveTurn` mutation in [convex/sim/internal.ts](../convex/sim/internal.ts) is marked `@deprecated` and is no longer called by any live path. It should be deleted once there is confidence that no scheduled retries from old runs can still invoke it.

**Move historical-only reads out of the staged context when possible**

Some logic, such as periodic economic review over already-delivered traders, is conceptually historical analysis rather than current-turn staging. Where possible, move those reads behind helpers that use the real database directly. That shrinks the behavioural surface the staged adapter must emulate.

### Low priority / tuning

**Preparation lead calibration**

`scheduledTurnPreparationAt` computes the lead window from a fixed ratio of `turnDurationMs`. After a few weeks of live data, the preparation lead should be calibrated against observed preparation durations by map size so it opens early enough to finish before the boundary but not so early that player edits late in the turn always force a re-run.

**Staged diff size monitoring**

`sim_turn_preparation_ops` rows accumulate one row per staged write per turn. For large games or long sessions this table may grow quickly. A cron that soft-deletes or archives committed preparation rows older than N turns would bound the table size.

**Richer staged diff inspection in admin**

The admin games panel currently shows `preparationState` and `resolutionPhase` but not the number of staged ops or which phases produced diffs. Exposing `opCount` per turn (already returned by `prepareTurnWithStaging`) and making the preparation row browsable in the admin UI would help debug preparation overruns.

---

## Client Smoothness and Scalability Guidance

The server-side fixes remove correctness failures, but client smoothness under scale will depend on how browser code consumes the turn timeline.

### Smoothness principles

1. One shared turn clock per connected client. Do not let panels, map layers, and animation systems each derive their own countdown independently.
2. Server time is authoritative; local time is only a rendering aid. Keep estimating offset from server snapshots and render against server-aligned time.
3. Boundary transitions should be visually cheap. Clients should animate a predictable handoff from turn N to turn N+1, not wait for a cascade of unrelated subscriptions to settle.
4. Animation should degrade gracefully under stale data. If a client misses a frame or reconnects late, it should snap to the authoritative timeline rather than trying to preserve an invalid local interpolation.

### High-value client improvements

**Expose a compact authoritative turn timeline payload**

Clients should be able to subscribe to a small, stable view model containing current turn number, turn start, pause state, target boundary, preparation state, and last server timestamp. This should be the only timing source for countdowns, movement interpolation, and turn-state badges.

**Separate animation state from data freshness**

Map movement and countdowns should continue from the last authoritative timeline even if a larger gameplay query is temporarily slow to refresh. The turn bar should not hitch because a bulky galaxy payload is re-rendering.

**Prefer boundary-driven UI transitions over broad rerenders**

When the turn flips, clients should update a narrow turn-timeline store first, then let heavier feature queries stream in. This reduces the visible "everything changed at once" effect and keeps the countdown and map in sync during heavy frames.

**Make reconnect and tab-throttle recovery explicit**

Browsers will throttle timers in background tabs. On refocus or reconnect, clients should resync against the latest server timeline and recompute all derived progress from scratch, rather than trusting paused local intervals.

**Instrument client-perceived turn drift**

Record the gap between local rendered boundary and server-reported commit/open events. This will expose whether users are seeing a smooth handoff even when backend correctness is fine.

### Scalability directions for many connected clients

**Keep timing subscriptions small and cheap**

The turn clock should not require every client to subscribe to large per-star or per-fleet payloads just to know when the next boundary is. Small shared timeline queries scale better than repeating the same timing fields across multiple heavy views.

**Avoid boundary fan-out work on the critical paint path**

If turn commit causes several large client queries to all invalidate at once, some users will experience visible stalls even if the backend commits quickly. Prefer progressive hydration: first timeline, then summary counters, then heavier map/economy details.

**Use admin telemetry to tune real player experience**

Track not just backend duration but also client-visible symptoms: subscription settle time after boundary, number of invalidations per turn, and percent of turns whose next state was ready before the boundary. These metrics will guide whether further work belongs in the controller, the adapter, or the client.

---

## Recommended Next Roadmap

If this work is resumed soon, the highest-value sequence is:

1. Build staged-adapter compatibility tests around real staged entry points.
2. Add preparation telemetry plus admin visibility for invalidations, op count, and late commits.
3. Add `filter()` support and audit every staged table for schema/index compatibility.
4. Introduce a compact client turn-timeline model and ensure all countdowns/animations consume it.
5. Tune invalidation and preparation lead using production metrics rather than fixed heuristics.

---

## File Map

| File | Role |
|---|---|
| `convex/sim/internal.ts` | Core turn controller: `beginTurnResolution`, `prepareTurnWithStaging`, `commitPreparedTurn`, `finalizeTurnPreparation` |
| `convex/sim/actions.ts` | Entry points called by cron and scheduler: `attemptResolveTurnBoundary`, `resolveTurnJob` |
| `convex/sim/stagedTurnStore.ts` | In-memory staged DB adapter and snapshot loader |
| `convex/sim/preparationOps.ts` | Staged operation types and serialization helpers |
| `convex/sim/turnPreparationInvalidation.ts` | `invalidateOpenTurnPreparation` — resets staged state when player edits change inputs |
| `convex/sim/turnTiming.ts` | Pure timestamp helpers: preparation lead, boundary, late-commit start |
| `convex/sim/cron.ts` | Cron driver that polls `attemptResolveTurnBoundary` once per second |
| `convex/sim/economy/adjustAutomatedNpcTraderLimits.ts` | NPC trader cap review — first consumer of staged range queries |
| `docs/State_Machine.md` | Authoritative state diagram and transition rules |
