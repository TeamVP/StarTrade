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

- `turnState`: `open`, `resolving`, or `resolved` for the row in `sim_turns`.
- `resolutionPhase`: current phase while a turn is resolving.
- `nextTurnAutoResolveDelayRatio`: optional hold chosen during the visible turn.
- `turnPausedUntilMs`: optional post-resolution hold deadline.

### Future Prepared-Turn Fields

These are not implemented in the first slice, but they are the target architecture.

- `preparedTurnNumber`
- `preparedAt`
- `preparedSnapshotId` or equivalent durable staging reference
- `preparedStatus`: `idle`, `preparing`, `ready`, `stale`

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

### Running/Resolving

- The current turn is no longer open for orders.
- Resolution phases execute in order.
- In the current architecture this still computes after the boundary.
- In the target architecture this work should move earlier and produce a prepared next turn.

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
- Reject while the visible turn duration has not elapsed.
- Move the current turn row to `state = resolving`.

### `finalizeTurnResolution`

- Mark current turn as resolved.
- Advance `currentTurn`.
- Insert the next `sim_turns` row.
- Today this next row is backdated to the prior exact boundary.
- Target architecture should commit a precomputed next turn here instead of doing heavy work after the boundary.

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
- The system should also schedule a direct wake-up attempt at each known turn boundary.
- A coarse 10 second poll against a 10 second turn duration can add almost a full extra turn of visible delay.
- The current implementation now polls once per second, and it also schedules an exact per-turn wake-up attempt. Both paths still defer the actual go/no-go decision to `beginTurnResolution`.

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
- Starting a game, resuming an open turn, and opening a newly resolved turn now schedule an exact wake-up attempt at that turn boundary, with cron kept as the recovery path.
- Precomputed next-turn staging is not implemented yet.

## Built So Far

- Authoritative visible-turn pause state using `turnPausedAtMs`.
- Pause/resume logic that preserves the active turn window instead of consuming time while paused.
- Shared client turn clock helpers plus `useTurnClock` for offset-aware, pause-aware time.
- Turn timeline query fields for status, pause time, and server time snapshots.
- Turn-driven UI and map consumers moved onto the shared clock.
- Faster resolution polling plus exact turn-boundary wake-up attempts.

## What Should Be Working Now

- The pause button countdown should freeze on pause and continue from the same point on resume.
- Fleet travel and combat replay timing should stay aligned with the same pause-aware turn clock used by the UI.
- Turn-driven visuals should be less sensitive to browser/server clock drift.
- Turn resolution should start much closer to the intended boundary instead of waiting for a 10 second cron phase.
- Starting a game, resuming an open turn, and opening the next turn after resolution should all schedule the next boundary wake-up automatically.

## Still To Build

- Prepared-next-turn staging so heavy simulation work can finish before the visible turn boundary.
- A cheap commit step that flips to a precomputed next turn instead of resolving after the boundary.
- Any schema and lifecycle needed to track prepared turn snapshots and readiness.
- Final cleanup of remaining secondary screens that still derive time independently outside the main turn-clock path.