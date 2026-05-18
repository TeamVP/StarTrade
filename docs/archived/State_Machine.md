# Turn State Machine Proposal

This document defines the turn controller that should own turn timing for simulation, UI, animation, and audio.

## Problem

The current system has one stored turn boundary timestamp, but it still resolves the turn after that boundary and only then opens the next turn. That causes three visible issues.

- The next turn can appear already partway complete when server resolution finishes late.
- Pause can freeze local UI timers without freezing the authoritative turn window.
- Different clients derive progress from different local clocks, so countdowns and ship movement can drift.

## Goal

The player should observe one authoritative turn clock.

- A turn lasts exactly `turnDurationMs` of visible play time.
- Pause freezes that visible play time.
- Fleet movement, turn bars, and any turn-bound effects read the same clock.
- Server compute should ideally prepare the next turn before the visible boundary so the turn flip is cheap.

## Proposed State Model

There are two related concepts.

1. The visible turn.
2. The prepared next turn.

The visible turn is what the player is watching now. The prepared next turn is the already-computed result that can be committed at the next boundary.

### Visible Turn Fields

- `currentTurn`: turn number currently visible to players.
- `turnStartedAt`: authoritative server timestamp for the start of the visible turn window.
- `turnDurationMs`: visible wall-clock duration.
- `turnPausedAtMs`: optional server timestamp set when the visible turn is paused.
- `status`: `lobby`, `running`, `paused`, or `finished`.

### Resolution Fields

- `turnState`: `open`, `preparing`, `prepared`, or `resolved` for the current row in `sim_turns`.
- `resolutionPhase`: current phase while a turn is resolving.
- `nextTurnAutoResolveDelayRatio`: optional hold chosen during the visible turn.
- `turnPausedUntilMs`: optional post-resolution hold deadline.

### Future Prepared-Turn Fields

These are now partially implemented via the preparation envelope and durable op log.

- `preparedTurnNumber`
- `preparedAt`
- `preparedSnapshotId` or equivalent durable staging reference
- `preparedStatus`: `idle`, `preparing`, `ready`, `stale`

### Preparation Envelope

The controller now also owns a per-turn preparation record separate from `sim_turns`.

- `sim_turn_preparations(gameId, turnNumber)` stores the durable preparation lifecycle for that turn.
- `targetBoundaryAt` records the boundary this turn is trying to hit.
- `state` is `queued`, `preparing`, `prepared`, `committed`, or `stale`.
- `sim_turn_preparation_ops(preparationId, opOrder)` stores the durable staged diff that commit applies.

## State Diagram

### Lobby

- Entered when a game is created.
- Leaves on `startGame`.

### Running/Open

- The visible turn clock is advancing.
- Players may issue orders.
- The next boundary is `turnStartedAt + turnDurationMs`, adjusted by any paused duration.

### Paused/Open

- The visible turn clock is frozen.
- `turnPausedAtMs` captures the exact freeze instant.
- UI must derive progress using `turnPausedAtMs`, not client `Date.now()`.
- On resume, the current turn window is shifted forward by `resumedAt - turnPausedAtMs`.

### Running/Preparing

- The current turn is no longer open for orders.
- Preparation phases execute in order against an in-memory snapshot of the turn-scoped sim tables.
- The current implementation now has an explicit `prepared` stop before commit.
- The staged run produces a durable diff log in `sim_turn_preparation_ops` instead of mutating live tables immediately.
- Preparation can now begin before the visible boundary because the live state remains untouched until commit.

### Running/Prepared

- Heavy turn work has finished for the current turn.
- The controller is waiting to commit the next visible turn.
- If preparation finished before the stored boundary, commit can keep the exact boundary start.
- If preparation finished late, the next visible turn starts when commit happens instead of being backdated partway complete.

### Finished

- The visible turn clock stops permanently.

## Transition Rules

### `startGame`

- Set `status = running`.
- Set `currentTurn = 1`.
- Insert `sim_turns(1)` with `startedAt = now`, `state = open`.

### `pauseGame`

- Valid only from `status = running`.
- Set `status = paused`.
- Set `turnPausedAtMs = now`.
- Do not mutate the visible turn boundary yet.

### `resumeGame`

- Valid only from `status = paused`.
- Compute `pauseDurationMs = resumedAt - turnPausedAtMs`.
- Shift the active open turn's `startedAt` forward by `pauseDurationMs`.
- Shift `turnPausedUntilMs` forward by `pauseDurationMs` when present.
- Clear `turnPausedAtMs`.
- Set `status = running`.

### `beginTurnResolution`

- Valid only when `status = running`.
- Reject while `turnPausedUntilMs > now`.
- Reject until the configured preparation lead window opens.
- Before the visible boundary, keep the current turn row `open` and move only the preparation envelope to `state = preparing`.
- At or after the visible boundary, lock the current turn row to `state = preparing` if commit cannot happen immediately.

### `finalizeTurnPreparation`

- Mark the current turn row as `prepared`.
- Do not advance `currentTurn` yet.

### `commitPreparedTurn`

- Apply the durable staged diff for the prepared turn.
- Mark current turn as resolved.
- Advance `currentTurn`.
- Insert the next `sim_turns` row.
- If preparation completed before the stored boundary, the next row keeps that exact boundary start time.
- If preparation completed late, the next row starts at commit time so the UI never opens a turn already partway elapsed.
- Commit is now a diff-apply step instead of rerunning heavy simulation work.

## Client Clock Rules

Clients should not directly compare local `Date.now()` to `turnStartedAt`.

They should derive an effective clock.

- Estimate server clock offset from the latest turn timeline snapshot and run turn math against server-aligned time.
- If the game is paused, clamp the effective clock to `turnPausedAtMs`.
- Turn progress, remaining time, and movement interpolation must all use that effective clock.

## Scheduler Rules

The cron driver must not wake only once per turn duration.

- The turn boundary is determined by stored timestamps, not by cron cadence.
- Cron should poll frequently enough that turn resolution begins close to the deadline.
- The system should also schedule direct wake-up attempts for both the preparation lead instant and the exact turn boundary.
- A coarse 10 second poll against a 10 second turn duration can add almost a full extra turn of visible delay.
- The current implementation now polls once per second, and it also schedules exact per-turn wake-up attempts for both preparation and commit. Both paths still defer the actual go/no-go decision to `beginTurnResolution` / `commitPreparedTurn`.

## Implementation Plan

### Slice 1

- Add `turnPausedAtMs` to the game model.
- Make pause/resume preserve the visible turn window on the server.
- Expose `turnPausedAtMs` through the turn timeline query.
- Route pause button countdown and fleet travel interpolation through a shared clock helper.

### Slice 2

- Introduce a shared turn clock provider on the client.
- Remove duplicated local progress calculations in panels and map consumers.
- Add server/client clock offset handling so clients animate against server-authored time.

### Slice 3

- Split visible turn progression from heavy turn computation.
- Add prepared-next-turn staging so compute can happen before the visible boundary.
- Make the turn boundary commit cheap and deterministic.

## Current Implementation Status

This document is being updated incrementally alongside the implementation.

- The backend now stores the instant a pause begins.
- Resume shifts the active turn window forward instead of letting paused wall-clock time consume the turn.
- The turn timeline now includes a server-time snapshot so clients can estimate server clock offset.
- The player/admin turn panels and turn-driven map visuals now read an offset-aware shared turn clock that freezes while paused.
- The cron driver now polls once per second instead of once per turn duration, which removes scheduler-phase drift as a major source of delayed turn starts.
- Starting a game, resuming an open turn, and opening a newly resolved turn now schedule exact wake-up attempts for both the preparation lead instant and the final turn boundary, with cron kept as the recovery path.
- The backend now has an explicit prepare/commit split for the current turn row: heavy work ends in `prepared`, and commit advances the visible turn separately.
- If commit happens after the stored boundary because preparation finished late, the next turn now starts at commit time instead of opening already partway elapsed.
- The controller now also creates a durable `sim_turn_preparations` row for each turn and a durable `sim_turn_preparation_ops` diff log for staged effects.
- Turn preparation now runs against a staged snapshot instead of mutating live tables, so the heavy turn work can start before the visible boundary.
- Pre-boundary preparation now keeps `sim_turns.state = open`, so players retain the full visible order-entry window until the actual boundary.
- Mutations that change current-turn simulation inputs now invalidate any staged preparation so late edits force a fresh staged run instead of committing stale results.
- Commit now applies the staged diff log at the boundary instead of rerunning simulation logic.

## Built So Far

- Authoritative visible-turn pause state using `turnPausedAtMs`.
- Pause/resume logic that preserves the active turn window instead of consuming time while paused.
- Shared client turn clock helpers plus `useTurnClock` for offset-aware, pause-aware time.
- Turn timeline query fields for status, pause time, and server time snapshots.
- Turn-driven UI and map consumers moved onto the shared clock.
- Faster resolution polling plus exact turn-boundary wake-up attempts.
- Exact preparation wake-up attempts before the boundary.
- Backend prepare/commit state split with `prepared` as an explicit boundary before visible-turn advancement.
- Late-commit protection so the next turn is not backdated into a partially elapsed timer when preparation overruns.
- Durable per-turn preparation envelopes keyed by `(gameId, turnNumber)` with a stored target boundary and lifecycle state.
- In-memory staged turn simulation with durable per-turn diff logs in `sim_turn_preparation_ops`.
- Diff-apply commit with virtual-id remapping for staged inserted rows.

## What Should Be Working Now

- The pause button countdown should freeze on pause and continue from the same point on resume.
- Fleet travel and combat replay timing should stay aligned with the same pause-aware turn clock used by the UI.
- Turn-driven visuals should be less sensitive to browser/server clock drift.
- Turn resolution should start much closer to the intended boundary instead of waiting for a 10 second cron phase.
- Starting a game, resuming an open turn, and opening the next turn after resolution should all schedule both the next preparation wake-up and the next boundary wake-up automatically.
- Heavy turn work should be able to finish before the visible boundary without mutating the live turn while it is still open.
- Players should keep the full visible order-entry window until the actual boundary even when pre-boundary staging has already started.
- Changing current-turn orders or other turn-driving inputs during that open window should invalidate the staged result and force a fresh preparation pass.
- Commit should now apply the precomputed staged diff rather than recomputing the entire turn at the boundary.
- If heavy turn work completes late, the UI should no longer open the next turn already partway through its countdown.

## Still To Build

- The original Slice 1–3 goals are implemented.
- Optional follow-up work is now mostly tuning and cleanup: preparation lead calibration from live metrics, removal of deprecated legacy phase mutations, and richer inspection/debug tooling for staged turn diffs.