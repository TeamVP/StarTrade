Please prioritize correctness of state transitions over decorative animation. The user should always see one coherent truth: where the unit was, where it is moving, and where it is now.

# Fleet Movement Animation

This brief covers the visualization layer only. Simulation remains authoritative. The renderer should present that state smoothly and without gaps.

## What is already correct

The current movement timing model is sound and should stay in place.

- Turn interpolation is driven from a stable turn boundary timestamp in `turnTravelProgress`.
- Multi-turn journeys already render as consecutive per-turn segments instead of one long ad hoc animation.
- First-leg departure smoothing is intentional and should remain. It hides late subscription delivery for newly dispatched units without changing simulation state.

Do not replace this with chained tweens, per-frame lerp start updates, or render-state feedback into simulation.

## Current bug

Fleet travel currently uses two render sources.

- An en-route ghost while `status === "enRoute"`.
- An idle orbit marker while `status === "idle"`.

The current fleet ghost fades out as it reaches the destination. The idle marker only appears after the subscription delivers the state change. That creates a visible gap where neither marker is shown.

This handoff gap is the main bug to fix.

## Shared movement rules

- Each turn should render from fixed authoritative start and end positions for that turn segment.
- A unit must begin each turn exactly where it visually ended the prior turn.
- Multi-turn travel must remain visually continuous across turn boundaries.
- Render interpolation must never feed back into simulation state.

These rules apply to trader ships, colony ships, motherships, and fleets.

## Type-specific arrival rules

### Trader ships

- Keep the current travel interpolation.
- Keep the short arrival fade if it still looks good.
- Treat that fade as presentation only, never as a delay in state ownership.

### Colony ships and motherships

- Use the same turn interpolation rules as fleets and traders.
- Do not add special timing logic unless the difference is purely visual.

### Fleets

Fleet arrival must be gap-free.

- While traveling, show the moving fleet marker for the full travel segment.
- Do not fade the fleet ghost away before the idle fleet marker exists.
- If the destination idle marker is not yet visible, keep rendering the fleet ghost pinned at the destination point.
- As soon as the idle fleet marker exists, hand off to it immediately.
- There must never be a frame where neither the traveling marker nor the idle marker is visible.

## Destination appearance rules

Idle fleet markers should continue using the existing orbit placement around the destination system.

- If the fleet was already visible as a traveling marker immediately before handoff, the idle orbit marker should appear immediately at full visibility.
- If a fleet appears at a system without an already-visible travel marker, a short 0.3 second fade-in is acceptable.
- Any fade or scale-in effect must happen on an already-visible destination marker, not by hiding the fleet first.

## Implementation plan

1. Keep `turnTravelProgress` and first-leg departure smoothing intact.
2. Stop applying arrival fade-out to fleet travel ghosts.
3. When a fleet ghost reaches its destination and no idle fleet marker exists yet, continue rendering that ghost at the destination until the idle marker appears.
4. Track first appearance for idle fleet markers.
5. Only apply the 0.3 second idle fade-in when the fleet was not already visible during the prior handoff.
6. Leave trader arrival fade behavior unchanged.

## Acceptance criteria

- Ships no longer zip forward or replay motion within a turn.
- A unit begins each turn exactly where it visually ended the last turn.
- Multi-turn journeys remain smooth, continuous turn-to-turn segments.
- Trader, colony, mothership, and fleet movement all continue using the same core turn timing model.
- A fleet arriving at a star system never disappears before its destination marker is visible.
- The destination fleet marker is visible immediately on handoff.
- A 0.3 second fade-in only occurs when a fleet was not already visible.

## Example

If a fleet starts turn 12 midway between Ashveld and Gorvak and turn 12 lasts 10 seconds, it should move smoothly for those 10 seconds from its turn-12 start position to its turn-12 end position.

If turn 12 is the arrival turn, then at the end of that segment the moving fleet marker should either:

- remain visible at the destination point until the idle orbit marker exists, or
- hand off directly to the idle orbit marker with no invisible gap.

The player should never see the fleet arrive, disappear, and then pop into orbit later.

## Verification notes

- Frontend build passes with the current renderer changes.
- Convex deploy should remain clean because this work does not change schema or backend functions.
- A focused regression test suite now covers the fleet ghost handoff and idle marker fade decisions.
- Live browser verification through the dev server is currently blocked by an unrelated Vite import-analysis error in `src/features/audio/lib/galaxySoundscapeEngine.ts`.
- A starter mission was successfully started through the lobby flow, but the affected map routes could not be observed in the browser until that unrelated audio import issue is resolved.
