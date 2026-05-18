# Per-Game Scheduler and Scalable Core Game Plan V2

This document supersedes the earlier scheduler/core-game plan in
[2026_May--Per_Game_Scheduler_and_Scalable_Core_Game_Plan.md](2026_May--Per_Game_Scheduler_and_Scalable_Core_Game_Plan.md).

Keep the older document for design review and historical context, but treat this V2 plan as the working architecture and implementation handoff.

It complements the other turn/runtime documents:

- [State_Machine.md](State_Machine.md) remains the authoritative turn-state model.
- [Turn_System.md](Turn_System.md) remains the work log and invariant list for the staged turn controller.
- [Database_Scalability_May_2026.md](Database_Scalability_May_2026.md) captures why storage volume and retention are now first-order architectural concerns.

## Executive Summary

The next durable architecture should optimize for four things at the same time:

1. a per-game scheduled runtime that can sustain short turns without deployment-wide polling pressure,
2. a strict separation between gameplay-critical state and background maintenance,
3. a storage model that minimizes durable writes for data that can be derived or compacted, and
4. a V2 runtime centered on `gameActorId` rather than `empireId` as the durable ownership key.

The key change from V1 of this plan is that storage efficiency is now a design driver, not only a cleanup concern. The system should stop producing large classes of durable rows by default when those rows are not required for current gameplay, pause/resume recovery, or compact finished-game summaries.

## Design Principles

### 1. Live gameplay should depend on as little durable state as possible

Only data required to render the current game state, accept orders, resolve the next turn, and recover from a restart during live play should remain durable by default.

### 2. Detailed history is temporary unless the retention policy explicitly preserves it

During a live game, only immediately recent detail matters. After the game is finished, detailed turn history should be compacted or deleted, leaving durable summaries and official results.

### 3. Durable state should describe what is true now, not every intermediate calculation

If a value is derivable from durable state, recent summaries, or deterministic recomputation, do not treat it as permanent product data.

### 4. Ephemeral working state is acceptable where restart safety is not compromised

Server memory and short-lived staged caches are valid tools, but durable state remains the source of truth. Ephemeral storage should accelerate active preparation, not become the only copy of gameplay-critical data.

### 5. V2 ownership should become actor-first throughout the runtime

The end state remains a game-actor-centric runtime. Storage reduction work must reinforce that direction rather than entrench `empireId` as the only durable owner key.

## Data Lifetime Model

The runtime should classify data into four explicit lifetimes.

### A. Durable Core State

Required to keep the game playable and restart-safe.

Examples:

- `sim_games`
- `sim_turns`
- `sim_game_actors`
- `gal_systems`
- `gal_links`
- `emp_states` until fully reduced out of V2
- `emp_system_holdings`
- `flt_fleets`
- active `flt_orders`
- active `flt_garrison_routes`
- active `col_colony_ships`
- active `cmb_battles`
- active `eco_bg_traders` state required for in-flight voyages

### B. Recent Live Detail

Helpful during live play, pause/resume, and short-horizon review, but not intended to survive forever.

Examples:

- recent `sim_events`
- current-turn or recent-turn market snapshots if the active mode uses them
- current-turn derived presentation data that supports local catch-up
- recent trader deliveries if trader mode needs a short review window

### C. Compact Durable Summaries

The long-lived artifact for finished games and historical browsing.

Examples:

- `sim_game_results`
- `emp_results`
- compact winner/placement summaries
- optional aggregated economy or trader summaries when product needs them

### D. Ephemeral Working State

Needed only while preparing or committing the current or next turn.

Examples:

- staged in-memory overlays
- transient preparation caches
- debug-only staging traces
- derived next-turn payload caches

## What Must Change From V1

The earlier plan correctly pushed toward per-game scheduling, background cleanup, and actor-first runtime identity. The missing piece was an explicit storage policy. That omission left too many tables behaving as if all simulation exhaust were durable product data.

The architectural correction is:

- treat row generation as a cost that must be justified,
- define retention and compaction at the table family level,
- avoid long-lived verbose per-turn outputs when only current state or compact summaries are needed,
- and make finished-game collapse part of the default lifecycle instead of an optional cleanup afterthought.

## Target Architecture

## A. Per-Game Scheduled Turn Driver

The primary runtime should remain per-game wake driven, with the recovery cron acting only as a bounded safety mechanism.

Each running game should own:

- next preparation wake metadata,
- next boundary wake metadata,
- generation/lease data for stale wake rejection,
- and minimal recovery state.

This part of the plan is already partly implemented and should continue to harden rather than expand back toward deployment-wide polling.

## B. Storage Policy By Table Family

The biggest change in V2 is an explicit table-policy matrix.

### Durable core by default

Keep durable:

- authoritative live state,
- player order state while a turn is open,
- active route state,
- active battle state,
- actor ownership state,
- and compact finished-game results.

### Short-window detail by default

Keep only a recent rolling window for:

- player-visible event detail,
- current-turn or recent-turn economy detail when enabled by mode,
- trader review detail that is still needed by active logic,
- and temporary observability rows.

### Compact at finish by default

When a game finishes:

- retain summaries and official results,
- delete detailed turn history,
- delete per-turn economy outputs unless the retention class explicitly preserves them,
- and retire any remaining runtime-only rows through bounded background phases.

## C. Turn Working State Simplification

The staged controller should eventually stop treating the full durable staged-op log as the long-term default.

Recommended direction:

- keep durable preparation envelope/version metadata,
- keep deterministic recomputation from durable live state as the correctness fallback,
- and gradually move the full preparation body toward ephemeral staging plus bounded verification.

This is a later phase because it is higher risk than reducing derived history writes.

## D. Derived Outputs Should Not Be Permanent By Default

The clearest current over-materialized families are:

- `eco_system_outputs`
- `eco_market_snapshots`
- verbose trader delivery ledgers
- long-tail `sim_events`
- and eventually parts of `sim_turn_preparation_ops`

Rules:

1. If a table exists only for admin/debug inspection, its writes must be mode-aware and retention-aware.
2. If a table can be derived from current durable state plus a short recent window, do not treat it as permanent history.
3. If a finished game no longer needs a detailed transcript (default behavior - compact at finalization), compact it at finalization instead of preserving it for a later manual cleanup.

## E. Mode-Driven Data Generation

Mode gating should not stop at turn phases. It should also gate transcript production.

Examples:

- `conquest_core` should not create trader rows, trader events, or trader-ledger detail.
- non-trader modes should not persist market-history or economy transcript rows that only trader/economy screens read.
- admin and observability surfaces should understand disabled table families rather than assuming every game writes every transcript.

Current product decision:

- `conquest_core` is the only published free empire-only mode.
- `conquest_plus` remains simulation-supported but unpublished until its data contract is intentionally defined.
- `trader_economy` remains the future paid creation path, and entitlement policy should stay above the simulation capability layer.

This is one of the safest and highest-ROI reduction paths because the read side is already partly gated.

## F. Game-Actor-Centric Runtime

The identity migration remains the same direction as the earlier plan:

- V2 runtime ownership should become `gameActorId` first,
- `empireId` should become a bridge and presentation concept,
- and durable summaries/results should prefer game-actor snapshots.

Storage reduction work should reinforce that by avoiding new history or transcript structures that only make sense in the legacy empire-centric model.

## G. Finished-Game Compaction As A First-Class Lifecycle Phase

Finished games should move through this path:

1. gameplay ends,
2. durable results are written,
3. finished-game summary state is stabilized,
4. detailed history is compacted or deleted according to retention class,
5. the remaining shell is a summary/result artifact, not a full live transcript.

The existing finalization and wipe infrastructure already points in this direction. V2 should make it the normal path instead of a cleanup exception.

## H. Community Publisher Catalog And Lifecycle

Community-created missions and automation strategies should live in the same durable catalogs as official content, but with explicit provenance, ownership, and lifecycle metadata instead of implicit admin-only behavior.

Recommended model:

- `users.publisher` is a separate capability from `users.admin`; admins can grant it, but publisher workflows should still enforce owner scope on normal edits.
- `sim_missions` and `usr_automation_strategies` should carry `ownerUserId`, `source`, and `status` metadata.
- `source` should distinguish `official` from `community` so public readers can show community content clearly without treating it as official progression content.
- `status` should be explicit and shared across both catalogs:
	- `draft`: visible to the owner and admins only; editable.
	- `published`: visible to everyone through the appropriate public/community surfaces.
	- `archived`: visible to the owner and admins, but terminal and read-only.
	- `deleted`: terminal hidden-from-public status for owner/admin back-office visibility.
	- `admin_deleted`: terminal admin-only visibility and admin-only transition.

Recommended rollout order:

1. Add the new ownership/provenance/status metadata and keep official catalog behavior stable.
2. Add a dedicated `/publisher` workspace for owner-scoped CRUD on community missions and strategies.
3. Keep official starter progression and official mission listings filtered to `source === "official"` so community missions do not leak into the canonical conquest-core ladder by default.
4. Allow published community strategies onto shared strategy-library surfaces with explicit community labeling, because that surface already tolerates mixed provenance better than the mission ladder.
5. Launch published community missions through the dedicated `/publisher` / Community surface with per-user on-demand runs, rather than overloading the official progression pipeline or starter-game provisioning.

## I. Product Naming Normalization

User-facing product naming should now be normalized to `StarStrat` across current docs, UI surfaces, and future planning updates.

Rules:

1. Replace legacy `StarTrade` and `StarTrade V1` naming in user-facing copy with `StarStrat`.
2. Keep technical identifiers such as existing local filesystem paths, deployment variables, and the GitHub repository slug `TeamVP/Starstrat` stable until a separate path/slug migration is intentionally planned.
3. Prefer relative markdown links inside docs so naming cleanup does not depend on machine-specific absolute workspace paths.

## Prioritized Implementation Plan

### Phase 1. Storage Policy Matrix

Create an explicit storage policy for every major turn-written table.

Each table should be classified as one of:

- durable core,
- recent live detail,
- compact durable summary,
- ephemeral working state.

Success condition:

- every future storage change is justified against one shared policy instead of ad hoc table-by-table reasoning.

### Phase 2. Low-Risk Derived Write Reduction

Start with the lowest-risk write families:

- stop writing conquest-only economy transcript rows that no live conquest view reads,
- reduce or window `eco_market_snapshots` where the mode does not require them,
- and keep admin/debug readers working through mode-aware empty states.

Success condition:

- conquest-first games materially reduce per-turn row growth without changing authoritative live state.

### Phase 3. Event Retention Tiers

Add write/query policies for:

- recent player-visible detail,
- compactable debug/runtime detail,
- and finished-game summaries.

Success condition:

- active games still have recent history,
- finished games no longer retain full event transcripts by default.

### Phase 4. Trader Ledger Compaction

Keep active trader voyage state, but move delivered-trader economics toward compact summaries instead of full per-row delivery ledgers.

Success condition:

- trader review logic uses bounded summary data rather than a growing historical ledger.

### Phase 5. Finished-Game Collapse

Hook compaction into finalization so official and debug-retained games keep summaries, not full live transcripts.

Success condition:

- a finished official game becomes small and understandable without retaining all operational history.

### Phase 6. Staged Preparation Redesign

Only after the lower-risk wins land, revisit durable staged-op persistence.

Success condition:

- preparation remains restart-safe,
- invalidation remains correct,
- and durable op volume shrinks substantially.

## What Is Being Implemented In This Pass

This pass should do two things:

1. establish this V2 plan as the working handoff document, and
2. land one low-risk storage reduction that follows the plan immediately.

The recommended first slice is:

- suppress conquest-only writes for per-turn economy transcript tables that are already hidden from non-trader reads.

That is intentionally small, reversible, and aligned with the existing mode-gated read model.

### Implemented in this pass

- this V2 document now exists and supersedes the earlier plan for active work,
- the older plan is now marked deprecated for active use but kept for review,
- `convex/sim/economy/applyTurnEconomy.ts` now suppresses `eco_system_outputs` and `eco_market_snapshots` writes for non-trader modes, which is the first concrete step toward reducing conquest-first row generation at the source,
- `convex/sim/internal.ts` now prunes older `sim_events` after each committed turn for non-`archived_debug` games, keeping detailed live history bounded instead of treating it as permanent runtime data,
- that `sim_events` retention is now policy-driven in `convex/sim/gameMode.ts`, with shorter live-history windows for conquest modes than for trader-economy games,
- `convex/sim/internal.ts` now also prunes stale completed `eco_bg_traders` rows for non-`archived_debug` trader-economy games while preserving `enRoute` runtime rows, with the retention policy owned by `convex/sim/gameMode.ts`,
- finished-game actor identity snapshots now persist directly on `emp_results`, so result queries no longer depend on live `sim_game_actors` rows and official cleanup can compact that table away,
- `sim_game_results` now also snapshots `urlCode`, letting finished-result listings depend less on the retained `sim_games` shell for display metadata,
- finished-game leaderboard queries now also read actor snapshot fields directly from durable `emp_results` rows instead of rebuilding per-game actor maps during aggregation,
- `emp_results` now snapshots the small game-level fields those postgame user queries actually consume (`endedAt`, official flag, map key, mission/scenario keys), so those readers only fall back to `sim_game_results` for older rows that predate the snapshot,
- the finished-game cron sweep now backfills those durable result snapshots for older finished games in bounded batches, so the fallback path shrinks over time without a one-shot migration,
- postgame leaderboard queries now prefer a selective `emp_results.gameIsOfficial` index, using the broad scan path only as a bounded fallback for legacy rows that have not been backfilled yet,
- `getMyLobbyState` now uses a selective official-winning-results index path for mission win summaries, with the older `by_userId_and_isWinner` read retained only as a bounded legacy fallback,
- `getMyLobbyState` now also uses selective `emp_results` winner and `empireKey` indexes when summarizing finished owned games, instead of collecting every empire-result row for each finished game just to find the winner and mission-player placement,
- `getMyLobbyState` now also resolves finished owned-game summaries in parallel across finished games instead of awaiting each `sim_game_results` and `emp_results` lookup chain sequentially,
- `getMyLobbyState` now also prefetches the current user’s `usr_game_roles` rows once and reuses them across mission scenarios instead of querying membership one game at a time while building the lobby-state mission list,
- `listRecentOfficialEmpireResults` now batches winner `emp_results` lookups in parallel instead of awaiting them serially row-by-row after the official `sim_game_results` index scan,
- the remaining `emp_results` metadata fallback in `convex/usr/queries.ts` now batches legacy `sim_game_results` point reads instead of loading those older result shells serially, and leaderboard call sites no longer repeat official-row checks that the official-only helpers already guarantee,
- `listEmpireUserLeaderboard` now also batches `usr_profiles` lookups for ranked rows instead of loading display names serially after leaderboard aggregation,
- `listGamePlayersForAdmin` now batches role-bucket reads and active-role profile/actor enrichment instead of walking those lookups sequentially, reducing latency on the admin player list for larger games,
- `getMyAccount` and `getMyGameMembership` now also batch their independent user/profile/account and role/game reads instead of paying serial query latency on those account-state surfaces,
- `listMyAutomationProfiles` now deduplicates `sourceLibraryKey` lookups before hydrating profile rows, so repeated source-library strategies are read once and reused across the result set,
- trader-economy games now also prune old `eco_market_snapshots` and `eco_system_outputs` in post-commit maintenance using a shared game-mode retention policy instead of preserving those per-turn transcripts indefinitely,
- the unused `convex/trd` charter/run API slice and dead frontend charter hook were removed after confirming they had no live callers, reducing stale trader-only surface area without affecting active gameplay,
- non-trader games now also purge leftover legacy `trd_charters` and `trd_runs` rows in bounded post-commit batches instead of relying on manual admin cleanup for tables that no live code still uses,
- non-trader games now also drain leftover legacy `sim_trader_identities`, `eco_bg_traders`, and trader-only `sim_events` rows in bounded post-commit batches, leaving those admin diagnostics as convergence checks rather than the only cleanup path,
- the manual admin-side legacy trader purge mutation/button were removed as redundant operator surface now that post-commit maintenance drains the same non-trader legacy rows automatically,
- the unused `convex/eco/internal.ts` market-snapshot writer was removed, closing a dead ungated `eco_market_snapshots` write entrypoint rather than carrying a legacy bypass that no live code used,
- `users` now have optional plan metadata and `sim_missions` now carry explicit mode and required-tier metadata, with backward-compatible fallbacks that treat legacy rows as `conquest_core` / `free` until backfill converges,
- built-in starter missions now declare `conquest_core` and `free` explicitly, making the current free empire-only catalog intentional instead of implicit,
- `convex/usr/missionCatalog.ts` now hides `conquest_plus` from normal published mission listings while keeping admin mission queries opt-in visible, so that mode stays unpublished without deleting runtime support,
- `convex/sim/mutations.ts:createGame` now resolves mission-aware mode defaults, rejects non-admin `conquest_plus` creation as unpublished, and requires `users.plan === "pro"` or admin rights to create `trader_economy` or future pro-tier missions,
- starter game creation/reset flows in `convex/usr/mutations.ts` now pass explicit mission modes into `createGame` instead of relying on the old missing-mode fallback,
- the admin create-game screen now defaults to `conquest_core` and labels `conquest_plus` as unpublished plus `trader_economy` as pro-creation, keeping the operator surface aligned with the current product policy,
- `convex/admin/queries.ts:listUsers`, `convex/admin/mutations.ts:createUser` / `updateUser`, and `src/app/router/AdminUsersPage.tsx` now expose and edit `users.plan`, which provides the first real operator surface for granting pro access instead of leaving the tier field write-only,
- `convex/admin/mutations.ts:backfillMetadataAccessBatch` now runs as a bounded resumable sweep across `users`, `sim_missions`, and `sim_games`, carrying cursors between runs so older legacy rows are eventually reached instead of rescanning only the newest slice, while still inferring mission-backed game modes and otherwise preserving legacy behavior by backfilling unknown game modes to `trader_economy`,
- `src/features/admin/components/DatabaseScreen.tsx` plus `convex/admin/queries.ts:getDatabaseHealth` now surface sampled missing metadata counts and a resumable “Backfill Metadata” action so operators can converge legacy rows without manual table edits or relying on newest-row sampling, and the backfill result now reports how many `sim_games.mode` patches were mission-backed versus legacy-fallback assignments,
- `convex/sim/internal.ts` now hydrates missing `sim_games.mode` from mission metadata the first time runtime-owned loaders touch a mission-backed legacy game, so turn-phase selection and post-commit maintenance no longer have to wait for the admin backfill sweep before treating those rows as `conquest_core`,
- `convex/eco/queries.ts`, `convex/eco/mutations.ts`, and `convex/eco/adminQueries.ts` now also resolve mission-backed legacy `sim_games.mode` before trader-economy gating, so conquest-mode games no longer appear trader-enabled on economy/trader screens or mutation endpoints just because their row has not been swept yet,
- `convex/sim/queries.ts` and the selected-game path in `convex/admin/queries.ts:getDatabaseHealth` now also use the resolved-mode read contract, so history/presentation event filtering and admin database diagnostics stop treating mission-backed legacy conquest games as trader-enabled while mode backfill is still converging,
- `convex/admin/internal.ts:seedGameData`, `convex/admin/mutations.ts:getGameSettings`, and `convex/admin/mutations.ts:updateGameSettings` now also load resolved modes for mission-backed legacy games, so admin seeding and balance/settings flows stop inheriting trader behavior from unset `sim_games.mode` rows,
- `convex/sim/gameMode.ts` now also exposes `resolveLoadedGameMode(...)`, and bulk list surfaces in `convex/sim/queries.ts:listGames`, `convex/sim/queries.ts:listRunningGamesTurnProgress`, plus the default sampled-game path in `convex/admin/queries.ts:getDatabaseHealth` now use it so dashboard-style views stop defaulting mission-backed legacy rows to `trader_economy`,
- `convex/usr/queries.ts:getMyLobbyState` and the owned-game scans inside `convex/usr/mutations.ts:ensureMyStarterGames` / `resetMyStarterGame` now also resolve mission-backed legacy `sim_games.mode` on their collected owned-game rows, so user-facing progression and starter-game refresh paths no longer depend on metadata backfill timing for those games,
- `convex/sim/gameMode.ts` now also exposes mutation-side persistence helpers, and mutation/admin paths such as `convex/admin/internal.ts:seedGameData`, `convex/admin/mutations.ts:updateGameSettings`, `convex/eco/mutations.ts`, and the owned-game scans in `convex/usr/mutations.ts` now opportunistically patch `sim_games.mode` when mission metadata can resolve it, so these flows actively shrink the legacy backlog instead of only masking it on read,
- and `src/app/router/AdminMissionsPage.tsx` now exposes mission `mode` and `requiredTier` in both create and edit flows, so future free versus pro mission authoring no longer depends on manual database edits or hidden defaults.
- `convex/usr/missionCatalog.ts:listMissions` now supports plan-aware filtering, `convex/usr/queries.ts:getMyLobbyState` now only includes missions available to the current user's plan, and starter-game creation/reset in `convex/usr/mutations.ts` now block future pro-tier missions for free users instead of relying on creation-time rejection alone.
- `users` now also support a separate `publisher` right, and `sim_missions` plus `usr_automation_strategies` now carry optional `ownerUserId`, `source`, and shared lifecycle `status` metadata so community catalog entries can coexist with official content without new tables.
- a new `/publisher` workspace now lets community publishers create and edit their own community missions and strategies, while published community entries remain browseable for everyone from that workspace,
- published community strategies now also appear in the shared strategy library with explicit community labeling, while official starter/lobby mission flows still filter to official mission content only,
- publisher lifecycle behavior is now enforced server-side for the first slice: drafts stay owner/admin visible, published rows are public, and terminal statuses (`archived`, `deleted`, `admin_deleted`) are kept visible only through back-office scopes instead of being editable again,
- and admins can now grant or revoke the new Publisher right from the users admin screen instead of relying on direct table edits.
- the admin missions and strategies screens now also expose source/status moderation and owner visibility for community content, so moderation can stay on the existing catalog tooling instead of depending on direct table edits or publisher-only screens,
- and the metadata convergence sweep plus database health panel now also track and backfill the new publisher/community metadata (`users.publisher`, mission source/status, strategy source/status) instead of leaving those fields as permanent optional legacy seams.

## Handoff Guidance For The Next Developer

The next developer should not start by redesigning `sim_turn_preparation_ops` or deleting live battle state.

The correct next order is:

1. backfill explicit `mode` and mission access metadata on legacy rows before changing any missing-mode fallback behavior,
2. finish the storage policy matrix and document it near the schema/runtime docs,
3. continue low-risk derived write suppression for conquest-first modes,
4. add event-retention tiers and finished-game compaction,
5. then revisit trader delivery compaction,
6. and only after those land, tackle the staged-op redesign.

### Specific warnings

- Do not make in-memory staging the only source of truth for anything needed after restart.
- Do not remove `cmb_battles` durability until combat semantics are settled.
- Do not widen frontend cleanup into this storage-efficiency track unless a backend change forces it.
- Keep V2 actor-first ownership migration moving forward while reducing storage. Do not re-entrench `empireId` with new durable transcript structures.

### Specific files to use first

- [schema.ts](../convex/schema.ts)
- [internal.ts](../convex/sim/internal.ts)
- [preparationOps.ts](../convex/sim/preparationOps.ts)
- [stagedTurnStore.ts](../convex/sim/stagedTurnStore.ts)
- [applyTurnEconomy.ts](../convex/sim/economy/applyTurnEconomy.ts)
- [applyBackgroundTrade.ts](../convex/sim/economy/applyBackgroundTrade.ts)
- [eventLog.ts](../convex/sim/eventLog.ts)
- [eventTypePolicies.ts](../convex/sim/eventTypePolicies.ts)
- [finalization.ts](../convex/sim/finalization.ts)
- [wipeGame.ts](../convex/sim/wipeGame.ts)

### Recommended next slices after this pass

1. Backfill legacy `sim_games` and `sim_missions` rows so mode and access metadata are explicit everywhere, then only consider tightening the missing-mode fallback away from `trader_economy`.
2. After metadata convergence is complete, decide whether `resolveGameMode(...)` can safely stop defaulting missing `sim_games.mode` to `trader_economy`.
3. Continue write-side conquest-mode suppression for other derived history families that are already disabled on the read side.
4. Carry the new retention-policy seam into any remaining transcript-heavy trader tables instead of adding more one-off pruning constants.
5. Continue moving finished-game read dependencies off live runtime tables and off unnecessary result-row joins or scans when durable snapshots and indexes already exist, then remove fallback paths once old rows have converged.
6. Continue replacing legacy `StarTrade` naming in user-facing docs and surfaces with `StarStrat`, while keeping repo/path identifiers stable until a dedicated slug migration is planned.

## Verification Requirements

Each storage-reduction slice should prove four things:

1. active gameplay state is unchanged,
2. pause/resume and restart recovery still work,
3. the relevant read surfaces either still work or are intentionally disabled by mode,
4. row-generation pressure actually decreases for the targeted table family.

For the first few phases, prefer shadowing and parity checks over big-bang deletion.

## Current Status

The V2 plan is now the active architecture and implementation handoff for storage-efficiency and runtime-scaling work.

Current backend status:

- the Convex runtime is healthy and recent validation passes have kept `npx convex dev --once` green,
- `conquest_core` is now the explicit free/catalog baseline in built-in mission metadata and the admin create-game default,
- normal published mission listings now keep `conquest_plus` hidden while preserving admin visibility and simulation support for later evaluation,
- game creation now enforces the current product policy: non-admin users cannot create unpublished `conquest_plus` games and must be `pro` to create `trader_economy` games,
- admins can now assign `users.plan` directly from the users admin screen, which makes the new pro-creation gate operational instead of theoretical,
- admins can now also author mission `mode` and `requiredTier` directly from the missions admin screen, which makes free versus pro mission catalog policy editable without database surgery,
- free users now only see or launch missions whose `requiredTier` is `free`, so future pro missions can be authored without leaking into the current conquest-core free progression flow,
- sampled metadata convergence is now observable from the database admin screen, and the metadata backfill action now progresses through the full legacy backlog with stored cursors instead of rescanning only the newest rows,
- metadata backfill runs now also expose how many game-mode patches still depended on the legacy fallback instead of mission metadata, which gives operators a direct signal for when tightening `resolveGameMode(...)` becomes safer,
- mission-backed legacy games now also self-heal `sim_games.mode` inside the runtime when first touched by turn resolution or post-commit maintenance, which narrows the remaining risk window while the admin sweep converges older rows,
- economy and trader API surfaces now also resolve mission-backed legacy modes before access checks, which removes another user-facing path that previously depended on the old missing-mode fallback,
- sim history/presentation queries and selected-game admin database stats now also resolve mission-backed legacy modes before applying trader-specific filtering or diagnostics, which removes another class of read-side fallback dependence,
- admin seeding plus admin game-settings/balance flows now also resolve mission-backed legacy modes before trader-specific behavior is chosen, which removes another operator-facing path that previously depended on raw missing-mode rows,
- bulk game-list and dashboard-style query surfaces now also resolve mission-backed legacy modes before exposing mode labels or trader-capability assumptions, which removes another batch-read path that previously defaulted legacy rows to `trader_economy`,
- user-owned game batch reads in lobby progression and starter-game flows now also resolve mission-backed legacy modes before they are reused across mission scenarios, which removes another user-facing batch-read path that previously depended on raw missing-mode rows,
- several mutation/admin paths now also persist those resolved mission-backed modes back onto `sim_games`, which means ordinary operator and player flows contribute to metadata convergence instead of depending entirely on the explicit admin sweep,
- a separate `users.publisher` capability now exists alongside admin and plan, and admins can grant it from the users admin screen,
- publisher-owned community missions and strategies now persist explicit owner/source/status metadata in the existing catalogs instead of relying on a separate table family,
- the new `/publisher` route now provides a first owner-scoped community publishing workspace for mission and strategy CRUD plus public browsing of published community entries,
- published community strategies now appear in the shared strategy library with community labeling, while official mission progression remains intentionally filtered to official catalog rows only,
- published community missions can now also be launched from the `/publisher` / Community surface through per-user on-demand game creation and replay, while official starter-game provisioning still stays official-only,
- the `/publisher` / Community mission list now also has basic client-side discovery controls (search plus mode/tier/run-state filters) so published community missions remain usable as that catalog grows,
- the `/publisher` / Community strategy list now also has basic client-side discovery controls (search plus availability filters) so published community strategies remain browseable as community content grows,
- admin mission and strategy tooling can now also reassign community ownership to publisher-capable users without direct table edits, which closes the first obvious moderation gap after introducing owner-scoped community content,
- admin mission and strategy tooling now also has basic moderation filters (search plus source/status/owner narrowing) so the shared catalogs remain operable as official and community content volume grows,
- admin mission and strategy tooling now also supports basic bulk lifecycle moderation for filtered selections, so admins can publish, archive, or delete multiple catalog rows without editing each one individually,
- admin mission and strategy tooling now also supports bulk owner reassignment for filtered selections, so community rows can be reassigned or cleared in batches while official rows remain ownerless,
- admin mission and strategy tooling now also supports bulk source reassignment for filtered selections, so admins can move rows between official and community while automatically clearing owners when content becomes official,
- the admin bulk moderation controls now also clear stale feedback between selection/action changes, which keeps the new batch status/owner/source workflows readable instead of stacking outdated success and error banners,
- admin mission and strategy tooling now also records and shows a lightweight recent moderation history, so operators can see who last created, updated, or batch-moderated a shared catalog row without leaving the existing catalog screens,
- that moderation history now also carries optional admin-written notes on single-row saves and bulk status/owner/source actions, so the recent audit trail can explain why a moderation change happened instead of only recording that it happened,
- a dedicated `/admin/moderation` queue now exists as a frontend-only review surface built from the shared mission and strategy catalogs, and it now groups community content by explicit review state (`unreviewed`, `needs_changes`, `approved`) plus ownerless rows instead of inferring review priority only from status heuristics,
- that moderation queue now deep-links into the existing mission and strategy admin catalogs with prefilled search/source/status/review/owner filters, so admins can jump from queue triage into the full editing surface without rebuilding the review context by hand,
- admin mission and strategy tooling now also supports explicit `reviewStatus` moderation alongside source/status/owner controls, including review badges, review filters, create/edit review controls, and terminal read-only handling for archived/deleted content,
- those admin mission and strategy catalogs now also support bulk `reviewStatus` updates for filtered selections, so moderators can batch-approve or request changes across a working set without opening each row individually,
- the `/publisher` workspace now also shows the current review state on owned community missions and strategies, so publishers can see whether content is still unreviewed, needs changes, or has been approved without gaining permission to edit that field,
- metadata convergence now also sweeps the new publisher/community fields on users, missions, and strategies, including explicit review state on shared missions and strategies, so those rows can become explicit instead of remaining fallback-shaped legacy data,
- starter mission game creation now passes explicit mission modes instead of inheriting the old missing-mode behavior,
- non-trader modes now suppress and automatically drain most legacy trader/economy transcript families,
- trader-economy modes now retain only bounded recent windows for event and economy transcript detail instead of preserving those rows indefinitely,
- finished-game readers now rely much more heavily on durable `emp_results` / `sim_game_results` snapshots and selective indexes instead of live runtime tables or broad result scans,
- older finished rows now converge toward the new durable result shape through bounded cron backfill instead of a one-shot migration,
- the current community/publisher slice now validates cleanly through `npx tsc --noEmit -p tsconfig.app.json --pretty false`, `npx tsc --noEmit -p convex/tsconfig.json --pretty false`, `npx convex dev --once`, and a clean `npx convex dev` ready startup,
- and the remaining product-policy gap is operational rather than architectural: legacy rows still need explicit mode/access backfill before the old missing-mode fallback can be safely tightened.
- latest validation remains green through `npx tsc --noEmit -p tsconfig.app.json --pretty false`, `npx tsc --noEmit -p convex/tsconfig.json --pretty false`, `npx convex dev --once`, and a live `npx convex dev` startup reaching `Convex functions ready! (5.78s)` before clean shutdown.
- product naming cleanup is now an explicit tracked workstream: user-facing docs and primary shell copy are moving to `StarStrat`, while technical repo/path identifiers remain intentionally stable at `TeamVP/Starstrat` and the current workspace path until a dedicated migration is planned.

The older scheduler/core-game plan remains available for historical review, but this document should now be treated as the working plan.

## Update Log

- May 18, 2026: Added bounded retention for `eco_market_snapshots` and `eco_system_outputs` in trader-economy games.
- May 18, 2026: Removed dead trader-only surfaces (`convex/trd/*`, unused trader charter hook, and the unused `convex/eco/internal.ts` market-snapshot writer).
- May 18, 2026: Automated bounded cleanup for leftover non-trader legacy trader rows (`trd_*`, `sim_trader_identities`, `eco_bg_traders`, and trader-only `sim_events`) and removed the redundant manual admin purge action.
- May 18, 2026: Added selective finished-result indexes and query paths for leaderboards, lobby win summaries, and finished owned-game summaries; batched recent official-result winner lookups to reduce per-row read latency.
- May 18, 2026: Added durable finished-game snapshot/backfill coverage for actor identity, `urlCode`, and lightweight game metadata so postgame readers depend less on live runtime tables.
- May 18, 2026: Added explicit `users.plan` and `sim_missions` mode/tier metadata with backward-compatible `conquest_core` / `free` fallbacks, and made built-in starter missions declare that policy directly.
- May 18, 2026: Hid `conquest_plus` from normal published mission catalogs while keeping admin visibility, made the admin create-game screen default to `conquest_core`, and labeled the unpublished/pro-only modes accordingly.
- May 18, 2026: Made `createGame` resolve mission-aware mode defaults, reject non-admin `conquest_plus` creation as unpublished, and require pro or admin rights for `trader_economy` creation; starter mission game creation now passes explicit mission modes.
- May 18, 2026: Added admin-side `users.plan` editing and surfaced plan values in the users admin screen so pro access can be granted intentionally.
- May 18, 2026: Upgraded `backfillMetadataAccessBatch` from a newest-row sample pass to a bounded resumable sweep across legacy `users`, `sim_missions`, and `sim_games` rows, and updated the database admin screen to carry the sweep cursors forward between runs.
- May 18, 2026: Added mission-backed versus fallback-backed `sim_games.mode` backfill counts to the database admin sweep result so fallback dependence is visible while legacy game metadata converges.
- May 18, 2026: Made the turn runtime self-heal missing `sim_games.mode` from mission metadata on first touch, so mission-backed legacy games stop using the old fallback even before the admin backfill reaches them.
- May 18, 2026: Made economy/trader queries and mutations resolve mission-backed legacy game modes before trader gating, so conquest-mode games stop exposing trader surfaces while waiting for metadata convergence.
- May 18, 2026: Moved sim history/presentation queries and selected-game database diagnostics onto the same resolved-mode read path, so those surfaces no longer misclassify mission-backed legacy conquest games while the backfill sweep is still running.
- May 18, 2026: Moved admin seeding and admin game-settings flows onto resolved-mode loads too, so operator actions no longer inherit trader behavior from mission-backed legacy rows with unset `sim_games.mode`.
- May 18, 2026: Added `resolveLoadedGameMode(...)` for already-loaded game rows and moved bulk game-list/dashboard query surfaces onto it, so mission-backed legacy games no longer display unresolved `trader_economy` mode labels in batch views.
- May 18, 2026: Moved user-owned game batch reads in lobby progression and starter-game flows onto resolved-mode rows too, so those user-facing paths no longer depend on metadata backfill timing for mission-backed legacy games.
- May 18, 2026: Added mutation-side mode persistence helpers so admin, economy, and starter-game mutation flows now opportunistically write mission-backed `sim_games.mode` values back to legacy rows while they touch them.
- May 18, 2026: Added mission `mode` and `requiredTier` controls to the admin missions screen so free versus pro catalog authoring no longer depends on raw database edits.
- May 18, 2026: Made player-facing mission listing and starter-game flows respect `requiredTier`, so future pro missions stay out of free users' lobby progression and reset flows.
- May 18, 2026: Added the first community publisher slice: `users.publisher`, shared owner/source/status metadata on missions and strategy catalog rows, a `/publisher` workspace for owner-scoped community CRUD, and community labels on published shared-library strategies while official mission progression stays official-only.
- May 18, 2026: Extended admin moderation and metadata convergence for publisher content: the admin missions/strategies screens now expose owner/source/status fields for shared catalog rows, and the metadata backfill plus database health panel now converge and report the new publisher/community metadata on legacy rows.
- May 18, 2026: Added the first player-facing published community mission launch path: the `/publisher` Community surface now shows each user their current run state for published community missions and can create or restart those runs on demand without merging community content into the official mission ladder.
- May 18, 2026: Added basic discovery controls to the `/publisher` Community mission list: search plus mode/tier/run-state filters now narrow published community missions client-side while keeping launch behavior on the same surface.
- May 18, 2026: Added matching discovery controls to the `/publisher` Community strategy list and revalidated both TypeScript projects plus clean Convex startup (`npx convex dev --once` and `npx convex dev`).
- May 18, 2026: Added admin owner reassignment for community missions and strategies so publisher-capable users can become or stop being the explicit owner from the existing admin catalog screens instead of relying on raw table edits.
- May 18, 2026: Added basic moderation filters to the admin mission and strategy catalogs so admins can narrow by source, status, owner, and text search instead of managing community content through flat unfiltered lists.
- May 18, 2026: Added basic bulk lifecycle actions to the admin mission and strategy catalogs so admins can select filtered rows and transition them together between draft, published, archived, deleted, and admin-deleted states.
- May 18, 2026: Added bulk owner reassignment to the admin mission and strategy catalogs so selected community rows can be moved between publisher-capable owners or cleared back to system ownership without hand-editing each entry.
- May 18, 2026: Added bulk source reassignment to the admin mission and strategy catalogs so selected rows can be moved between official and community in batches while preserving the rule that official content cannot retain an owner.
- May 18, 2026: Polished the new admin bulk moderation controls so stale feedback clears when selection or action changes, then revalidated both TypeScript projects plus live `npx convex dev` startup (`Convex functions ready! (5.21s)`).
- May 18, 2026: Added a lightweight append-only moderation history for admin mission and strategy actions, and surfaced recent history directly on the existing admin catalog cards.
- May 18, 2026: Added optional moderation notes to admin mission and strategy saves plus bulk moderation actions, and surfaced those notes in the recent inline audit trail on the admin catalog cards.
- May 18, 2026: Added a dedicated `/admin/moderation` queue that reuses the shared mission and strategy catalogs plus recent moderation history to surface draft, ownerless, and recently moderated community content in one review screen.
- May 18, 2026: Added moderation-queue deep links into prefiltered mission and strategy admin catalogs so queue review can hand off directly into the existing editing screens with preserved source/status/owner/search context.
- May 18, 2026: Polished moderation-queue deep links so the mission and strategy admin pages keep their local filters synchronized with URL params after mount, then revalidated app TypeScript and live `npx convex dev` startup (`Convex functions ready! (5.78s)`).
- May 18, 2026: Began product naming normalization by replacing remaining legacy `StarTrade` references in active docs and primary UI copy with `StarStrat`, while keeping the new private repository slug at `TeamVP/Starstrat`.
- May 18, 2026: Replaced heuristic moderation triage with an explicit shared `reviewStatus` field on community missions and strategies, wired that state through metadata backfill, admin mission/strategy editing, the `/admin/moderation` queue, and read-only publisher badges, and revalidated the app UI with `npx tsc --noEmit -p tsconfig.app.json --pretty false`.
- May 18, 2026: Added bulk admin review-state actions for missions and strategies so filtered selections can move together between `unreviewed`, `needs_changes`, and `approved` while still skipping invalid rows such as official content asked to leave `approved` or terminal archived/deleted rows.
