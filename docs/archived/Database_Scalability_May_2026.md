# Database Scalability Notes, May 2026

## Implementation status

This document started as a design exploration and is now partly implemented in the codebase.

### Built so far

- `sim_games` now carries explicit finalization and retention metadata so a game can move through finish, result write, cleanup, and retained-shell states instead of remaining ambiguously `finished` forever.
- Durable result tables now exist:
	- `sim_game_results` for the retained game-level outcome
	- `emp_results` for one durable empire competition row per kept game participant
- A dedicated finalization module now evaluates end conditions, writes durable result rows, and queues cleanup.
- Turn finalization and cron sweep paths now both participate in end-of-game evaluation.
- Activity timestamps are refreshed from meaningful player and admin actions so abandonment can be detected from signals instead of age alone.
- Admin controls now support:
	- retention policy selection
	- score-finalizing a game
	- terminate-and-discard behavior
- Cleanup now preserves a minimal `sim_games` shell row for `official` and `archived_debug` games instead of deleting every finished game outright.
- Durable result data is now surfaced in the UI through:
	- player lobby starter-game cards
	- turn panel durable summary for finished games
	- games dashboard recent official results
	- history screen durable summary for cleaned finished games
	- a dedicated shared results page with human, NPC, and strategy leaderboards

### What should be working now

- Official games should be able to finish, write durable results, and then clean up their high-volume live simulation payload.
- Discarded games should still be eligible for aggressive deletion rather than permanent retention.
- Finished official games should remain understandable after cleanup through retained result rows and a minimal game shell.
- Starter-game progression should read from durable result rows rather than depending on live finished-game state.
- Admins should be able to set retention intent, finalize a stalled game by score, or discard a game.
- Players and admins should be able to browse durable official outcomes and leaderboards without depending on preserved event transcripts.

### What still needs to be built

- Trader-side durable results (`trd_results`) and trader leaderboards are not implemented yet.
- Strategy identity is still only partially normalized. The system records snapshots and fingerprints, but result UIs still need stronger named-strategy attribution.
- There is no dedicated per-game durable result detail page yet; current results browsing is list-oriented.
- Long-term archive/export behavior for `archived_debug` games is still a product and infrastructure decision rather than a completed implementation.
- The current leaderboards are bounded and practical for now, but may need more explicit scaling strategy as official result volume grows.

After roughly 10 solo test games with NPC players, StarStrat generated millions of Convex records and about 691 MB in a downloaded zip. That is far beyond the target footprint for a finished game. The issue no longer looks like ordinary optimization. It looks like a retention-model problem.

The current system behaves as if the full operational history of a game is durable product data. If the desired outcome is closer to “a finished game should mostly collapse to results,” then the database needs to be treated much more explicitly as a lifecycle system: some data exists only while a game is live, some exists only briefly for debugging or UI, and only a small summary survives long term.

## The core problem

The main source of growth is not the static game world. It is the accumulation of per-turn, per-system, per-event, and per-voyage rows that continue to exist after the game no longer needs them for gameplay.

The current model stores both:

- the live state required to run the simulation, and
- a broad transcript of how the simulation got there.

That transcript includes logs, derivative outputs, and historical records that are useful during play, debugging, or admin inspection, but may not be necessary once the game is over.

## What is generating the volume

The highest-growth record families are the ones that are created repeatedly as turns resolve:

- `sim_events`, written across many gameplay and simulation paths.
- `sim_turns`, which preserves one row per turn lifecycle.
- `eco_system_outputs`, which writes three rows per owned system per turn.
- `eco_market_snapshots`, which writes three market rows per turn.
- `eco_bg_traders`, where each voyage becomes a durable row even after delivery.
- `cmb_battles`, which preserves battle rows rather than only battle outcomes.
- `flt_orders`, which stores order rows during turn execution.
- `flt_garrison_routes`, which can persist or be rebuilt as standing operational state.

The turn pipeline amplifies this. One turn can execute movement, combat, economy, NPC planning, trade delivery, trader spawning, and garrison routing. Several of those phases write history even when the underlying game state only changes modestly.

## Important current behavior

There is a sharp difference between a game being finished and a game being wiped.

- Natural game completion marks the game `finished`, sets `endedAt`, sets `winnerEmpireKey`, and writes a `game_finished` event.
- Admin-triggered `killGame` marks the game finished and then schedules a full wipe across game-scoped tables.

So the system already contains one radical idea: total deletion of game-scoped rows is acceptable in at least one supported workflow. What it does not currently do is apply any compaction or retention policy when a game finishes normally.

That means completed test games keep most of their operational history by default.

## What the current product appears to need after a game ends

From the current code, the durable post-game needs look much smaller than the retained data volume.

The clearest durable needs visible today are on `sim_games` itself:

- whether the game finished,
- when it ended,
- who won,
- what scenario or map it used,
- who created or owned it.

There is also at least one direct product use of finished-game metadata for progression logic: `usr/queries.ts` derives lobby unlocks from finished games and `winnerEmpireKey`. That suggests a strong pattern: the product currently appears to need finished-game outcomes, not the full finished-game transcript.

By contrast, event history, per-turn market data, delivered trader rows, system output rows, and detailed turn rows look much more like temporary runtime data or optional observability data than long-lived product records.

## A more radical framing

The right way to think about this may be that a game has multiple data lifetimes, not one.

### 1. Live simulation state

This is the data needed to run the current game right now.

Examples:

- `sim_games`
- `gal_systems`
- `gal_links`
- `emp_states`
- `emp_system_holdings`
- `flt_fleets`
- `col_colony_ships`
- `usr_game_roles`
- active background trader state while voyages are still in flight

This data should exist while the game is active. Its job is to let the sim proceed, not to preserve history forever.

### 2. Turn-execution working data

This is data that exists to help resolve turns and should probably disappear quickly.

Examples:

- `flt_orders`
- active `cmb_battles`
- transient route-planning artifacts
- active turn rows needed for timing and resolution coordination

This category should probably be treated as disposable operational state, not archive material.

### 3. Observability and debugging data

This is the data that helps explain what happened, inspect balance, or debug failures.

Examples:

- `sim_events`
- `eco_system_outputs`
- `eco_market_snapshots`
- delivered or cancelled `eco_bg_traders`
- resolved battle history
- older turn rows

This may be valuable, but it does not automatically follow that it belongs in the primary durable game dataset forever. A lot of it may only be useful:

- during active play,
- for a short cooling-off period after a game ends,
- for explicit debugging sessions,
- or when deliberately exported.

### 4. Durable finished-game results

This is the part that likely deserves to survive long term.

Examples:

- game identity and scenario
- start and end timestamps
- winner
- participating empires or players
- a few headline stats
- progression-relevant flags
- maybe a compact scoreboard or end-of-game summary blob

This category is much closer to the likely product need for a completed game.

## The strongest conclusion from the current codebase

The system currently stores far more history than the finished product seems to require.

More specifically, it appears to be retaining raw simulation exhaust as if it were player-facing game outcome data. That is probably the central mismatch.

If the product goal is “keep almost nothing except the results of the game,” then the current default should likely be inverted:

- raw history should be temporary unless explicitly preserved,
- finished-game summary should be the durable thing,
- and full-game retention should be an exception rather than the baseline.

## Questions that now matter most

These are the questions that seem worth answering before deciding tables, migrations, or cleanup jobs.

### What is the minimum finished-game artifact?

What exact information must survive so that a completed game is still meaningful to the product and to the player?

### Which data is only needed while the game is active?

Which tables exist only because the simulation is still resolving live state, and therefore should not survive end-of-game cleanup?

### Which data is really observability rather than game state?

What is only needed for debugging, tuning, admin investigation, or temporary UI affordances?

### Should debugging history be opt-in?

Instead of recording everything for every game, should detailed transcripts exist only for explicitly flagged games, development environments, or short retention windows?

### Should the game collapse on finish?

When a game reaches `finished`, should the system immediately or shortly afterward reduce the game to a compact summary and delete the rest?

### Is Convex the right long-term home for full transcripts?

If full replay or forensic history is sometimes wanted, should that live outside the primary transactional database, for example as an export or archive artifact rather than hot operational rows?

## Minimum durable finished-game artifact

The durable artifact should be designed around the idea that most games are disposable, but some games are worth keeping as official results.

That points to a split between:

- runtime game tables used while a game is live, and
- compact results tables written only for games we choose to preserve.

### Recommended durable shape

An `emp_results` table makes sense, but it should probably not stand alone. The cleanest minimum durable artifact is likely:

- one game-level summary row, and
- one empire-level result row per participating empire.

That means a two-table result model.

The important nuance is that `emp_results` should be treated as a special competitive-results table, not just a compact backup of empire state. It is the durable record that lets human users, NPC personas, and later automation strategies compete over time on wins, placements, and performance.

### 1. `sim_game_results`

One row per finished game that is worth keeping.

Purpose:

- identifies the game as a retained historical result,
- stores the official winner and finish mode,
- provides the small amount of metadata needed by progression, profile history, leaderboard views, and archive browsing,
- allows the original live game rows to be deleted afterward,
- provides the permanent game identifier that all durable empire and future trader results should point at.

Suggested fields:

- `gameId`: the permanent durable game identifier copied from the original game and retained forever
- `sourceGameId`: original `sim_games` id, nullable if the source game row itself may later be deleted
- `name`
- `mapKey`
- `lobbyScenarioKey`
- `seed`
- `startedAt`
- `endedAt`
- `lastResolvedTurnNumber`
- `retentionClass`: for example `discarded`, `official`, `archived_debug`
- `isOfficial`: boolean shortcut if you want a simpler product rule
- `finishReason`: for example `last_empire_standing`, `abandoned_scored`, `admin_terminated`
- `winnerEmpireKey`
- `winnerEmpireResultId`
- `winnerControllerKind`: `human` or `npc`
- `winnerUserId`: nullable for NPCs
- `winnerNpcPlayerKey`: nullable for humans
- `winningStarsControlled`
- `winningFleetStrength`
- `empireCount`
- `humanEmpireCount`
- `npcEmpireCount`
- `summaryJson`: optional compact summary blob for a scoreboard or future UI

This row is the durable replacement for depending on the full live game dataset after a game finishes.

The key design point is that `sim_game_results.gameId` becomes the stable join key for every long-term competitive result tied to that game, even after the live simulation tables have been wiped.

### 2. `emp_results`

One row per empire in a retained finished game.

Purpose:

- preserves the placement and outcome of each empire,
- preserves who controlled that empire,
- allows post-game ranking, player history, NPC performance history, and automation-strategy performance history without keeping the whole simulation transcript.

This is the table that should power questions like:

- which human users have won the most empire games,
- which NPC empires or personas win most often,
- which automation strategies are actually winning,
- which strategies place highly but do not convert to wins.

Suggested fields:

- `gameResultId`
- `gameId`: copied durable game id from `sim_game_results`
- `sourceGameId`: optional direct back-reference while migration is in progress
- `empireId`: nullable once source rows are gone
- `empireKey`
- `empireName`
- `colorHex`
- `controllerKind`: `human` or `npc`
- `userId`: nullable for NPCs
- `npcPlayerKey`: nullable for humans
- `playerName`
- `strategyJson`: nullable snapshot of the effective automation strategy used by this empire
- `strategySummaryJson`: optional normalized preview used for analytics and UI
- `strategyLibraryKey`: nullable when the winning strategy came from a named library profile
- `strategySourceKind`: for example `manual`, `library`, `custom`, `npc_default`
- `placement`
- `isWinner`
- `eliminated`
- `eliminatedAtTurn`
- `eliminationReason`: for example `destroyed`, `collapsed`, `abandoned`, `survived_to_score`
- `starsControlledFinal`
- `populationFinal`
- `fleetCountFinal`
- `fleetStrengthFinal`
- `treasuryFinal`
- `researchPoolFinal`
- `homeSystemSurvived`
- `scoreFinal`
- `scoreBreakdownJson`: optional if the score formula becomes richer later

This table is where the real durable result lives at empire granularity.

For competitive analysis, `emp_results` should be queryable by:

- `gameId`
- `userId`
- `npcPlayerKey`
- `isWinner`
- `strategyLibraryKey`
- a normalized strategy fingerprint if two different empires can use the same effective strategy JSON

That makes it the durable source for empire-side competition metrics across all official games.

## Which games should create durable result rows

Not every finished game should be kept.

That suggests an explicit retention decision when a game finishes. For example:

- `discarded`: test games, abandoned prototypes, admin-killed junk games; write nothing durable and wipe everything
- `official`: write `sim_game_results` and `emp_results`, then wipe the live game tables
- `archived_debug`: write durable result rows and also preserve or export a transcript for investigation

This is important because it keeps the durable artifact aligned with product intent instead of assuming every game deserves permanent storage.

## When to write `emp_results`

The right model is incremental, not only end-of-game.

If an empire has clearly exited meaningful competition, its result row can be created or updated immediately. Then the game-level result row can be finalized when the game ends.

### Proposed empire exit trigger

Your suggested trigger is strong and much better aligned with durable scoring than the current `isCollapsed` logic.

Proposed elimination condition:

- `starsControlled === 0`, and
- `fleetCount === 0` or `fleetStrength === 0`

When both are true, the empire is effectively gone from competitive play and its `emp_results` row can be finalized as eliminated.

That is a better durable-results trigger than the current insolvency collapse path, because insolvency collapse still allows the empire to retain a homeworld and therefore does not always mean the empire has actually placed out of the game.

### Incremental write behavior

For each empire, the durable result row can be:

- created the first time the empire is detected as eliminated,
- updated again if additional final stats need to be filled in,
- finalized when the game itself is finalized.

This reduces dependence on keeping all raw history around until the very end.

It also means the eventual winner's row can already contain the strategy snapshot that actually won, instead of forcing later analytics to depend on ephemeral empire state that may already have been deleted.

## How to decide the winner

There are really two finish modes to support.

### 1. Last empire standing

If one empire remains meaningfully alive, that empire is the winner.

This is the cleanest finish mode and should map to `finishReason = last_empire_standing`.

### 2. Abandoned or administratively ended game

If players stop playing while multiple empires still exist, the game can still be finalized from current state without continuing the simulation indefinitely.

In that case, the winner should be determined from final score, with star control as the primary measure as you suggested.

Recommended ranking order:

1. `starsControlledFinal`
2. `fleetStrengthFinal`
3. `populationFinal`
4. `treasuryFinal`
5. stable fallback such as `empireKey`

That gives the game a deterministic end state even when it does not naturally resolve to one surviving empire.

This should map to `finishReason = abandoned_scored`.

## What should be computed into the durable score

If the product goal is simple and decisive, the durable score should also stay simple.

A good minimum is:

- primary score: stars controlled
- secondary tiebreaker: total fleet strength

Other quantities like population, treasury, and research are useful as descriptive stats even if they are not part of the primary ranking formula.

That means `emp_results` should preserve both:

- the official placement value used to rank the empire, and
- a few supporting final stats for display and future balancing analysis.

## What should happen after results are written

Once `sim_game_results` and `emp_results` are finalized for an official game, the live game should be eligible for aggressive cleanup.

That means deleting, not retaining, tables like:

- `sim_events`
- `sim_turns`
- `eco_system_outputs`
- `eco_market_snapshots`
- delivered `eco_bg_traders`
- `cmb_battles`
- `flt_orders`
- most or all remaining game-scoped live state

At that point the durable product record is the result artifact, not the original game graph.

## Future trader-side competitive results

The same permanent game identifier on `sim_game_results` should be used for future trader competition records.

That suggests a parallel future table, likely something like `trd_results`, with one durable result row per trader participant in a kept game.

Purpose:

- track how human traders perform across games,
- track how NPC trader personas perform across games,
- track which trader automation strategies are winning or placing highly,
- let empire-side and trader-side competition be analyzed against the same game outcome.

Suggested relationship:

- `sim_game_results.gameId` is the permanent anchor
- `emp_results.gameId` points to that anchor for empire competition
- future `trd_results.gameId` points to that same anchor for trader competition

That gives one durable game record with multiple role-specific competitive result tables hanging off it.

In other words, `sim_game_results` is the durable game header, while `emp_results` and future `trd_results` are the durable competitive ledgers for the roles played within that game.

## Game finalization pipeline

The results model only works if game ending is treated as an explicit pipeline rather than an incidental side effect of the turn resolver.

Right now the runtime has two separate behaviors:

- the cron advances `running` games,
- admin `killGame` wipes a game,
- natural completion only marks the game `finished`.

That gap is exactly where long-term database growth happens. A finished game needs to move through a defined finalization flow that decides the outcome, writes durable results, and then schedules cleanup.

### Recommended lifecycle states

The cleanest design is to separate play-state from retention/finalization-state.

The game can still have a play status such as:

- `lobby`
- `running`
- `paused`
- `finished`

But it should also have a finalization state concept, whether stored on `sim_games` or in a dedicated job row. For example:

- `none`
- `pending_result_write`
- `results_written`
- `pending_cleanup`
- `cleaned`
- `archived_debug`

That prevents a game from getting stuck in the ambiguous state of being finished but still retaining all of its operational tables forever.

### One owner for finalization

There should be one authoritative internal mutation or action that owns all end-of-game transitions.

For example, conceptually:

- `evaluateGameFinalization`
- `finalizeGameResults`
- `cleanupFinishedGame`

The important point is not the exact function names. The important point is that winner selection, result writing, and cleanup should not be spread across unrelated code paths.

## How a game should be evaluated for ending

Game ending should be checked in two places:

- immediately after each successfully finalized turn,
- and from a watchdog cron or scheduled sweep for games that have stalled.

That gives one normal path and one recovery path.

### Normal path: after turn finalization

At the end of a turn, after economy, combat, arrivals, and result-affecting state have settled, the game should run a finalization check.

That check should:

1. compute current standings,
2. upsert any `emp_results` rows for empires that have now clearly exited,
3. determine whether the game has reached a finish condition,
4. if yes, write `sim_game_results`, finalize all `emp_results`, mark the game finished, and queue cleanup.

### Recovery path: watchdog sweep

Some games will not end through the normal happy path.

Examples:

- players stop interacting,
- a game stays paused indefinitely,
- a game remains technically `running` but no meaningful competition remains,
- a bug or deployment issue prevents the expected final mutation from running.

So there should be a separate sweep that finds games needing intervention and pushes them into one of:

- finish now,
- mark abandoned and score now,
- or keep waiting.

## What data is needed to detect abandonment

Abandonment should not be guessed from age alone. It should be based on explicit signals.

The current schema does not appear to track enough direct game-activity metadata for a strong abandonment decision, so the lifecycle design likely needs a small set of new fields.

Suggested fields on `sim_games` or a related lifecycle record:

- `lastMeaningfulActivityAt`
- `lastHumanActionAt`
- `lastResolvedTurnAt`
- `abandonmentEligibleAt`
- `abandonedAt`
- `finishReason`
- `cleanupQueuedAt`
- `cleanupCompletedAt`

### What should count as meaningful activity

Meaningful activity should include things that show a game is still genuinely being played or materially changing.

Examples:

- a human issuing fleet orders,
- a human changing strategic settings that affect the game,
- a turn successfully resolving,
- an empire being eliminated,
- an admin explicitly choosing to continue the game.

What should probably not count on its own:

- the cron merely waking up,
- automatic polling queries,
- passive reads of the game state.

### Recommended abandonment rule

A game should become eligible for abandonment scoring when all of the following are true:

- it is not in `lobby`,
- it is not already fully finalized,
- there are still multiple meaningful competitors alive,
- there has been no meaningful activity for a configured time window,
- and no player or admin has recently signaled intent to continue.

This is where product policy matters. The exact timeout can be chosen later, but the mechanism should support it cleanly.

## How to determine whether an empire is still alive

For durable results, empire survival should be evaluated using competitive presence, not just the current `isCollapsed` flag.

Recommended competitive-alive test:

- `starsControlled > 0`, or
- `fleetStrength > 0`

Recommended competitive-eliminated test:

- `starsControlled === 0`, and
- `fleetCount === 0` or `fleetStrength === 0`

This aligns the end-game and scoring logic with the durable results model instead of with insolvency-specific mechanics.

## Winner process

The winner process should be deterministic and run from one place.

### Finish mode 1: last empire standing

If only one empire remains competitively alive, that empire wins immediately.

This is the strongest and simplest finish mode.

Process:

1. finalize any newly eliminated empires,
2. mark the surviving empire as winner,
3. write `sim_game_results`,
4. finalize all `emp_results`,
5. mark the game `finished`,
6. queue cleanup.

### Finish mode 2: abandoned scored finish

If multiple empires still exist but the game has become abandoned, the system should score the game from current state and end it without waiting indefinitely.

Recommended ranking order:

1. stars controlled
2. fleet strength
3. population
4. treasury
5. stable fallback such as `empireKey`

This gives the game a deterministic winner and placement table even when the simulation does not naturally reduce to one surviving empire.

### Finish mode 3: admin termination

An admin should be able to end a game explicitly in one of two ways:

- terminate and discard,
- terminate and score.

Those are different retention intents and should not share the same default behavior.

## What should happen when a game is marked abandoned

Marking a game abandoned should not be the end of the process. It should be the trigger for the same formal winner pipeline.

That means:

1. set `abandonedAt`,
2. set `finishReason = abandoned_scored`,
3. compute standings from current live state,
4. write or update `emp_results`,
5. write `sim_game_results`,
6. mark the game finished,
7. queue cleanup.

In other words, abandonment is just a finish mode, not a separate limbo state.

## Cleanup pipeline

Cleanup should also be treated as a first-class workflow.

### Cleanup should not start until results are durable

The order must be strict:

1. determine finish outcome,
2. persist `sim_game_results`,
3. persist all `emp_results`,
4. only then delete live game tables.

That protects against ending a game and then losing the only durable record of who won.

### Cleanup classes

The cleanup step should depend on retention class.

#### `discarded`

- write no durable results,
- delete all game-scoped rows,
- optionally delete the source `sim_games` row too.

#### `official`

- write `sim_game_results`,
- write `emp_results`,
- delete the live operational tables,
- optionally keep either no `sim_games` row or only a minimal shell row during transition.

#### `archived_debug`

- write durable result rows,
- optionally export or preserve detailed history for debugging,
- do not let that debug retention become the default for ordinary games.

### Cleanup execution model

The existing wipe flow already shows the right basic pattern: batch deletes scheduled over multiple mutations.

The design should reuse that approach rather than invent a new all-at-once delete path.

The difference is that ordinary official finalization should eventually call into that cleanup machinery automatically, not only from a manual admin kill path.

## Suggested runtime ownership model

A practical ownership model looks like this:

- turn finalization calls `evaluateGameFinalization`
- a watchdog cron scans for stuck or abandoned games and also calls `evaluateGameFinalization`
- `evaluateGameFinalization` decides whether to do nothing, finish immediately, or score as abandoned
- `finalizeGameResults` writes `sim_game_results` and `emp_results`
- `queueFinishedGameCleanup` schedules the existing batch wipe flow

This keeps game ending, scoring, and cleanup as one coherent pipeline.

## The main design rule

No game should remain indefinitely in the state “finished, but still carrying its full simulation payload.”

The safe target state for an official completed game is:

- one durable `sim_game_results` row,
- one durable `emp_results` row per empire,
- later one durable `trd_results` row per trader participant,
- and no large live simulation transcript left in the primary database.

## The practical design principle

The minimum durable finished-game artifact should answer these questions and little else:

- Which game was this?
- Was it official enough to keep?
- Who participated?
- Who controlled each empire?
- When did each empire effectively go out?
- Who won?
- What was the final ranking by stars and tie-breakers?

If a row does not help answer one of those questions, it probably does not belong in the long-term finished-game dataset.

## Working direction implied by this analysis

The strongest working direction is not “make the current history tables smaller.” It is “stop treating most of them as durable finished-game storage.”

That implies a lifecycle like this:

- active game: keep the live state and whatever short-horizon runtime history the game currently needs,
- just-finished game: derive and persist a compact result summary,
- post-finish cleanup: delete or compact the operational and observability tables,
- optional archive mode: preserve a full transcript only when deliberately requested.

## Scope for the next pass

The next pass should answer the retention question table by table and define the actual durable contract for a finished game.

The central design choice is no longer whether the database can handle millions of rows. It is whether StarStrat should consider millions of rows to be the normal permanent footprint of 10 finished games. Based on the current product surface and the test result, the answer is probably no.