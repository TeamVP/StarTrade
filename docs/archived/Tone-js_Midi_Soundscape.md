## Concept

Plan the game to use **event-driven bell audio** instead of a traditional looping soundtrack. The soundscape is to be generated in the browser with Tone.js, and gameplay events on the map trigger bell sounds whose pitch, timbre, loudness, stereo position, and distance are shaped by what is happening in the world and by what the player is currently looking at on the map  [github](https://github.com/Tonejs/Tone.js).

The goal is for the player to gradually “hear the state of the map.” Attack, defense, and exploration should each have distinct bell behaviors; each player or team should have its own bell identity; force size should influence pitch range and density; and camera position plus zoom should determine which events sound close and present versus distant and muffled  [tonejs.github](https://tonejs.github.io/examples/sampler).

## Core stack

The audio engine should be built around Tone.js running entirely on the client. Tone.js provides the main browser audio framework, `Sampler` for playing bell samples, `Panner` for left-right placement, `Panner3D` for more advanced spatial placement if needed later, `Filter` for muffling distant sounds, and `Reverb` plus `Limiter` for final mix polish and clipping protection  [github](https://github.com/Tonejs/Tone.js).

If we want to import or export MIDI-shaped data, use `@tonejs/midi`. That library is specifically for reading and writing MIDI and converting it into a Tone.js-friendly JSON structure, which is useful for storing motifs, authoring pattern fragments, or exporting generated sessions later  [github](https://github.com/Tonejs/Midi). The important design choice is that MIDI is treated mainly as an event description format, not as the runtime sound engine.

## Sound sources

The preferred sound source is a small curated set of bell samples loaded into Tone.js `Sampler`. Tone’s sampler supports note-to-sample mapping and repitching, which means we do not need a massive sample library for each player or action type  [tonejs.github](https://tonejs.github.io/examples/sampler).

There are three likely source paths:
- Custom recorded or edited bell samples, best long-term option because it gives the most distinct identity.
- Curated free orchestral/chime sources adapted into small browser-ready note sets.
- MIDI-authored motifs converted into note events, but still rendered through our own bell samples rather than through a generic GM playback engine  [tonejs.github](https://tonejs.github.io/examples/sampler).

The recommendation is to avoid relying on generic browser General MIDI playback for production sound. The game should use its own bell sample banks so that attack, defense, exploration, and player identity all remain legible and stylistically coherent  [tonejs.github](https://tonejs.github.io/examples/sampler).

## Audio language

The game audio should encode three kinds of information at once:

- **Action type**: what is happening, attack, defense, or exploration.
- **Ownership**: which player or team the event belongs to.
- **Scale and importance**: how large or significant the force or event is.

Action type should be communicated mainly through timbre and gesture, because timbre is easier for players to recognize than raw pitch alone. Defense should feel lower, slower, and steadier; exploration should feel lighter, airier, and sparser; attack should feel brighter, faster, and more urgent  [tonejs.github](https://tonejs.github.io/examples/sampler).

Each player should have its own bell family so ownership is clear even when multiple players are triggering the same action type. For example, one player might use warm bronze bells, another glassy chimes, another darker tubular bells, and another bright metallic temple bells. The action mapping stays consistent across players, but the bell palette changes by owner  [tonejs.github](https://tonejs.github.io/examples/sampler).

## Pitch and fleet size

Fleet size should control pitch register, note density, and possibly loudness. Small forces should generally map to higher notes, while larger forces should map to lower notes, because lower pitch reads more naturally as weight, size, and mass  [tonejs.github](https://tonejs.github.io/docs/14.7.39/Scale).

The mapping should not be continuous raw frequency. Instead, fleet size should be normalized and quantized into a constrained note set so the result stays musical. For example:
- Small exploration groups: high notes from a sparse pentatonic set.
- Mid-size defense groups: mid-low notes with longer release.
- Large attack groups: low notes with brighter transient and slightly greater density.

This keeps the system readable and avoids random-sounding pitch output.

## Spatial mix

The camera acts as the listening focus. What the player sees on the map should strongly influence what they hear in the mix, both in clarity and in spatial location  [tonejs.github](https://tonejs.github.io/docs/14.7.39/Panner3D).

Horizontal position relative to the current viewport should drive stereo placement. Tone.js `Panner` supports direct left-right positioning from `-1` to `1`, which is appropriate for a 2D map view where screen-space left/right matters more than fully realistic 3D acoustics  [tonejs.github](https://tonejs.github.io/docs/14.7.28/Panner).

Distance from the current camera focus should affect:
- volume attenuation via `Volume` or gain control,
- tonal darkening via lowpass `Filter`,
- possibly reverb send for atmospheric depth,
- event priority in the mix so nearby events remain intelligible  [tonejs.github](https://tonejs.github.io/docs/14.7.38/Filter).

The intention is:
- events near the current camera center sound clearer, brighter, and more present,
- events near the edge of the view sound more lateral,
- events off-screen sound quieter, more muffled, and biased to the side where they occur.

For example, something happening off-screen to the left should sound softer, darker, and primarily left-biased. Something far to the right should sound similarly reduced and right-biased. This lets players infer that the wider world is still active without overwhelming the area they are actually inspecting  [tonejs.github](https://tonejs.github.io/docs/14.7.28/Panner).

## Zoom behavior

Zoom level should control listening radius and mix focus. When the player zooms in, the audio engine should narrow its attention and prioritize events within the current area of interest. Nearby events should become more detailed and dry, while distant activity becomes quieter, darker, and less central in the mix  [tonejs.github](https://tonejs.github.io/docs/14.7.39/Panner3D).

When the player zooms out, the listening radius can widen so more global map activity is audible, though still with prioritization rules to prevent clutter. In short:
- Zoomed in = local detail, stronger separation between foreground and background.
- Zoomed out = broader awareness, less extreme attenuation, more overall map ambience.

This means the audio is not just reacting to world state; it is reacting to player attention.

## Engine structure

The client audio engine should be event-driven and separate from the React render cycle. React components and map systems emit gameplay events, but scheduling and audio playback should live in a dedicated Tone.js service so timing remains stable and independent from UI rerenders  [github](https://github.com/Tonejs/Tone.js).

A typical voice chain should be:

`Sampler -> Filter -> Volume -> Panner/Panner3D -> team bus -> shared reverb -> master limiter`

This allows every event to be shaped individually, while still giving each team its own controllable bus and the whole game a stable master mix  [tonejs.github](https://tonejs.github.io/examples/sampler).

Suggested bus structure:
- One bell sampler preset per player.
- Per-player or per-team bus for small EQ/level tuning.
- Shared ambience/reverb bus.
- Master compressor/limiter for safety  [tonejs.github](https://tonejs.github.io/docs/14.7.58/Limiter).

## Application fit

The right owning surface in this codebase is the existing galaxy view on the client, not Convex. The current app already has the three inputs this first audio slice needs:

- `GalaxyViewport` owns the live map camera, including focus point, scale, viewport width, and height.
- `useGalaxyData` already provides world positions for systems and empire ownership metadata.
- `api.sim.queries.listRecentEvents` already streams the event log rows needed to detect combat, fleet movement, and colonization without adding schema or new backend functions.

That means the first implementation should stay entirely client-side. React should only provide state and subscriptions. Tone.js should run inside a dedicated soundscape service that is fed high-level event rows plus a camera snapshot. This keeps timing separate from rerenders and avoids unnecessary backend coupling.

## Revised phase plan

Phase 0, now:
- Use existing `sim_events` rows as the runtime event source.
- Classify current event types into three audio buckets: attack, defense, exploration.
- Derive the sound location from the system coordinates already shown on the galaxy map.
- Gate audio behind an explicit enable button because browser audio contexts require a user gesture.

Phase 1:
- Replace placeholder synth voices with a real bell `Sampler` bank.
- Add player or team bell identity so the same action type sounds different by owner.
- Broaden event coverage to traders, food crises, and empire collapse cues.

Phase 2:
- Introduce authored motifs or MIDI fragments for recurring strategic patterns.
- Add per-team buses, ownership-aware EQ, and optional 3D listener behavior if the 2D camera model proves too flat.

## First implementation slice

The first slice should be intentionally narrow and testable:

- Surface: `GalaxyViewport` only.
- Event source: newest `sim_events` subscription only; do not backfill or replay old history when sound is first enabled.
- Event families: combat (`battle_started`, `battle_round_resolved`, `battle_continues`, `system_conquered`, `system_claimed`, `system_held`), plus exploration (`fleet_dispatched`, `fleet_arrived`, `colony_ship_dispatched`, `colony_ship_arrived`, `system_colonized`).
- Spatial model: camera-relative pan, gain, lowpass cutoff, and reverb send derived from current focus and zoom.
- Playback: a minimal Tone.js engine with bell-like synth placeholders now, to be swapped for `Sampler` once the project has approved bell assets.

This slice is enough to answer the key product question: does event-driven map audio increase legibility without creating clutter. It also gives the codebase a stable seam for future sample banks and owner-specific timbres.

## Current implementation status

Built so far:
- A client-only soundscape hook in `GalaxyViewport` that watches `sim_events` and plays new event bells only after the player enables audio.
- Event classification for attack, defense, and exploration using existing event log types.
- Camera-aware spatial shaping for pan, gain, lowpass cutoff, reverb send, and listening radius.
- Ownership-aware bell identity using current event payloads plus live fleet, colony ship, and system ownership lookups as fallback.
- A minimal Tone.js playback engine using synth-based placeholder bells, with a master limiter and shared reverb.

What should be working now:
- The galaxy map shows a sound toggle in the map controls.
- Enabling the toggle starts the browser audio context and arms the soundscape without replaying older event history.
- New combat, conquest, defense, fleet movement, colony ship movement, and colonization events can trigger bells.
- Nearby events should sound louder and brighter, while distant or off-screen events should sound softer, darker, and panned toward their side of the map.
- Different empires should no longer sound identical when they trigger the same action family.

What still needs to be built:
- Replace the placeholder synth voices with a proper `Sampler` bell bank and curated assets.
- Add richer multi-empire voicing for battles with several attacking factions instead of a single primary owner voice.
- Expand coverage to traders, food crises, collapse events, and other strategic systems.
- Add team or empire buses for stronger mix control and clearer ownership identity.
- Add authoring or import support for motifs and optional MIDI-shaped pattern infrastructure.

## Detailed remediation plan for current silent-start behavior

The current soundscape behavior has an important usability failure mode: the player can click the speaker toggle, see the "Starting sound" affordance, receive no runtime error, and still hear nothing. That can happen even when the audio engine starts correctly, because the present flow treats the already-loaded event batch as old history and then schedules future sounds later across the turn.

The next implementation pass should explicitly solve two separate problems:

- No immediate audible confirmation after enabling sound.
- Silent no-op states that are operationally valid but indistinguishable from breakage.

### Root causes to address

The plan should treat these as distinct root causes rather than one generic bug:

- The current enable path arms the audio engine but does not play an immediate confirmation sound.
- The current enable path should not replay the entire historical feed, but it also should not leave the player with zero audible evidence that sound is working.
- The current event feed may already contain supported combat or movement events when sound is enabled, yet those events can be skipped because they are marked as already seen.
- The newer turn-spread scheduler intentionally delays playback across the active turn, which is musically useful but makes the lack of immediate feedback much more noticeable.
- Unsupported event types or events that cannot resolve to a known map system are currently dropped silently, which is reasonable for runtime stability but poor for diagnosability.

### Phase A: immediate audible confirmation

The first fix should be a dedicated confirmation sound that does not depend on `sim_events` at all.

- Add a short, soft "sound armed" confirmation cue that plays immediately when the speaker toggle successfully transitions from off to ready.
- This cue should be routed through a lightweight UI sound path, not through the world event scheduler, so it can never be delayed by turn timing.
- The cue should be quiet, warm, and unmistakable, more like a soft glass tick or airy chime than a gamey notification.
- The cue should only play after the browser audio context is actually running and sample buffers are available, so it becomes a truthful confirmation rather than a speculative one.
- The cue should also play when the user re-enables sound later in the session, because the problem is about reassurance at the moment of activation, not just first-run onboarding.

This keeps the original product constraint intact: do not replay old world history on enable. Instead, confirm that audio is now armed and waiting.

### Phase B: replace silent no-op states with explicit audio state reporting

The next fix should make "nothing heard" explainable without requiring a console.

- Expand the sound status model beyond `off`, `starting`, `ready`, and `error` to include states such as `armed_waiting_for_events`, `ready_with_scheduled_events`, and `ready_no_playable_recent_events`.
- Show a compact user-facing status line near the speaker control for a few seconds after enable. Examples: "Sound on. Waiting for next event." or "Sound on. Next map sound scheduled this turn.".
- In development builds, expose a small debug payload behind the same control or a hidden debug affordance showing: event rows received, event rows classified, events dropped for unsupported type, events dropped for missing system position, events scheduled, and timestamp of last sound played.
- Add internal counters for the audio hook so product debugging can answer whether the failure is: no events, unsupported events, missing map coordinates, muted UI category, blocked audio context, or delayed scheduler.
- Preserve graceful runtime behavior. These states should not throw exceptions just to create visibility.

This addresses the "no runtime error exists" issue by treating the lack of sound as an observable state, not just the absence of exceptions.

### Phase C: replay strategy for the already-loaded event batch

The existing design explicitly avoids replaying old history on enable, and that is still the right default. The fix should therefore use a constrained replay strategy rather than a broad replay.

Recommended approach:

- On enable, do not mark the entire current `listRecentEvents` payload as permanently consumed before evaluation.
- Build a small "eligible activation batch" from the already-loaded event rows, but only from events that are both recent and musically relevant.
- Limit this activation batch to a small capped subset such as the newest 1-3 playable events.
- Prefer events from the current turn first, then fall back to the immediately previous turn only if no current-turn playable event exists.
- Filter out low-information events if needed so activation does not produce a sudden clutter burst.
- Route the activation batch through a dedicated enable-time pacing rule that plays almost immediately, with a short stagger of perhaps 100-300 ms between cues.

The effect should be: when sound is enabled mid-turn, the player gets an immediate confirmation cue, then a tiny curated glimpse of the currently active map state if appropriate, not a backlog dump.

### Phase D: scheduler changes so responsiveness and musical spread can coexist

The turn-wide scheduling work is still directionally correct, but it needs a faster foreground path.

- Split scheduled playback into at least two lanes: `foreground_immediate` and `ambient_spread`.
- Foreground-immediate lane: high-importance events near the camera center, newly selected entities, or events belonging to the listener's own empire should be eligible for near-immediate playback.
- Ambient-spread lane: distant, lower-priority, or enemy-only events can continue to be distributed across the turn for texture.
- Add a maximum first-audible delay budget. For example, once sound is enabled and a playable event exists, at least one event should be audible within a short bounded window.
- Do not let all current-turn events be pushed toward the latter half of the turn if the player is waiting for proof that audio works.

The scheduler should optimize for legibility first, then musical spacing.

### Phase E: longer tails without obscuring control feedback

The reverb-over-turn design should remain, but it should be isolated from the activation and UI feedback problem.

- Keep the long shared reverb tail so world sounds can overlap across turn boundaries.
- Ensure the confirmation cue and UI cues remain relatively dry compared with the world-event bus so they stay readable.
- Keep a separate dry path for confirmation and UI interactions even if the world bus is lush and overlapping.
- Consider a dedicated world reverb bus plus a lighter UI ambience bus instead of forcing all sound families through the same tail behavior.

This preserves the desired slower, smoother decay while preventing the interface feedback layer from becoming vague or muddy.

### Phase F: acceptance criteria for the sound-start fix

This work should not be considered done until all of the following are true:

- Toggling sound on always produces an immediate audible confirmation if audio is actually armed.
- Enabling sound mid-turn can produce either a small curated activation batch or a clear "waiting for next event" status, never silent ambiguity.
- Supported current-turn events near the player or in the current focus area are not all deferred deep into the turn.
- The UI can distinguish between engine-ready-but-idle and actual startup failure.
- Developers can inspect why no sound played without relying on console exceptions.

## Detailed plan for soft UI interaction sounds

The project should treat short interaction feedback as a second audio layer separate from the strategic world soundscape.

### Audio architecture split

Use two audio families with distinct responsibilities:

- World soundscape: Tone.js, spatialized, camera-aware, event-driven, musically paced.
- UI interaction sounds: Howler or a similarly lightweight low-latency path for short non-spatial interface feedback.

This repo already has an initial UI SFX seam in `src/lib/audio/sfx.ts`, so the recommended direction is to expand that into a small UI audio service rather than forcing all button and hover sounds through the Tone world engine.

### UI sound categories

The UI layer should define separate named cues rather than one generic click.

Recommended starting cue set:

- `select_star`
- `select_fleet`
- `select_colony_ship`
- `select_trader_ship`
- `button_press`
- `drag_valid_hover_loop`
- `drag_commit_success`
- `drag_commit_cancel`
- `sound_enabled_confirm`

Each cue should have its own volume trim, cooldown behavior, and category metadata.

### Selection sounds on the galaxy map

These interactions should sound subtly different so the player learns what was selected without reading the panel immediately.

- Clicking a star system: soft, luminous, slightly resonant ping.
- Clicking a fleet: slightly more metallic and directional than the star sound, suggesting ships and intent.
- Clicking a colony ship: softer and more sheltered, slightly warmer than fleet selection.
- Clicking a trader ship: lighter, quicker, and more nimble, suggesting motion and commerce.

Owning surfaces for this work:

- Star selection already flows through the `GalaxyStage` star pointer handlers and then through `GalaxyViewport` selection state.
- Fleet selection already flows through `handleFleetPointerDown` in `GalaxyStage` and `handleSelectedFleetChange` in `GalaxyViewport`.
- Colony ship selection already flows through `handleColonyShipPointerDown` in `GalaxyStage` and `handleSelectedColonyShipChange` in `GalaxyViewport`.
- Trader selection already flows through the `TraderShipMarker` tap handler in `GalaxyStage` and `handleTraderSelect` in `GalaxyViewport`.

The plan should attach the audible feedback at the point where selection is confirmed, not merely at pointer down if selection will be rejected.

### Drag hover magnetic buzz for valid fleet destinations

This should be treated as a looping state sound, not as a repeated click.

Desired behavior:

- When a fleet drag is active and the cursor is hovering a legitimate destination star that already shows the yellow dashed destination circle, begin a soft magnetic or energized buzz.
- Keep that buzz running continuously as long as the cursor remains over a valid drop target.
- If the cursor leaves the valid target, fade the buzz out quickly rather than hard-stopping it.
- If the cursor re-enters a valid target during the same drag, fade it back in without restarting from a harsh transient.

Implementation surface:

- `GalaxyStage` already computes `dropSystemId` during drag and already knows when the dashed destination circle should be drawn.
- The UI audio plan should expose a `setDragHoverState({ kind, targetId, isValid })` style API so the drag loop can be controlled as a state machine rather than as one-shot sounds.

### Success and disappointment sounds for releasing a fleet drag

The release sound should depend on whether the drop produced a valid committed order.

- Successful fleet drop: a quick positive affirmation, like a soft exhale, approval chirp, or tiny harmonic lift.
- Unsuccessful release: a tiny disappointment sigh, air drop, or downward gesture that communicates "not accepted" without feeling punitive.
- The unsuccessful cue should only play when the player attempted an actionable drag and released without a valid destination, not when they simply click a fleet with zero ships selected or when dragging was never allowed.

The same success-failure pair should be considered for colony ship dispatch drags, because the interaction pattern is nearly identical.

### Button press sounds across the game page

General UI buttons should produce subtle confirmation sounds, but not every control should sound identical.

Recommended grouping:

- Primary actions: slightly firmer confirmation.
- Secondary buttons and tabs: softer click.
- Toggle buttons: small on/off timbral difference.
- Destructive or risky actions: more restrained, lower-pitched confirmation rather than cheerful approval.

The implementation should avoid hand-wiring every button instance one by one where possible. Prefer a shared hook or wrapper strategy for common button primitives, then add opt-out or override behavior for exceptions.

### UX rules to prevent spam and fatigue

The UI sound layer needs explicit anti-annoyance rules.

- Add cooldowns so repeated rapid clicks do not stack into harsh chatter.
- Do not replay selection sounds if the user re-clicks the already selected object unless the interaction visibly changes state.
- Keep hover-loop sounds on a dedicated low-volume bus.
- Duck or trim UI sounds slightly when strong world-event bells are playing nearby so the mix stays readable.
- Respect a global mute and separate category volumes for world sounds and UI sounds.

### Asset plan for UI sounds

The UI set should use a different timbral family from the strategic bell soundscape.

- World soundscape should remain more resonant, spatial, and atmospheric.
- UI sounds should be shorter, drier, and more tactile.
- The drag-valid buzz should be loopable and seamless.
- Success and failure cues should be short and expressive, but never cartoonish or overly gamey.

### Settings and accessibility plan

UI sounds should not be bundled into the same single toggle as world ambience forever.

Recommended settings model:

- Master audio toggle.
- World soundscape toggle or volume.
- UI sound effects toggle or volume.
- Optional reduced-feedback mode for users who want the world soundscape but not frequent interface reinforcement.

Accessibility and predictability requirements:

- UI sounds should reinforce state change, not replace visible confirmation.
- Success and failure cues should be distinct in contour, not just louder or softer.
- Hover-loop sounds should never be the only indication that a destination is valid.

### Rollout plan for UI sound work

Recommended implementation order:

1. Add the UI audio service and settings split.
2. Ship the immediate `sound_enabled_confirm` cue.
3. Add map selection sounds for star, fleet, colony ship, and trader ship.
4. Add a generic subtle button press cue on shared button primitives.
5. Add valid-destination drag hover loop plus success and cancel drop cues.
6. Tune cooldowns, category volumes, and mix interaction with the world soundscape.

### Acceptance checklist for UI sounds

This part of the audio roadmap should be considered complete only when:

- Clicking a star, fleet, colony ship, or trader ship gives a distinct but subtle cue.
- Valid drag hover produces a continuous magnetic buzz only while a valid destination is actively hovered.
- Successful drag release and failed drag release produce clearly different one-shot cues.
- Buttons across the game page confirm interaction without becoming noisy or repetitive.
- UI sounds can be tuned or muted separately from the strategic world soundscape.
- None of these sounds interfere with the legibility of the map event audio layer.

## Event model

Gameplay systems should emit a high-level event object rather than raw audio instructions. A typical event might include:

- `playerId`
- `actionType` such as attack, defense, or exploration
- `fleetSize`
- `worldX`, `worldY`
- `timestamp`
- optional `importance`, `duration`, or `intensity`

The audio engine then translates this into:
- note selection,
- sample bank selection,
- velocity,
- release time,
- stereo pan,
- lowpass cutoff,
- gain,
- reverb amount.

This makes the system easy to tune without rewriting gameplay code.

## MIDI role

MIDI is optional support infrastructure, not the main playback path. We may use MIDI files or MIDI-like structures for:
- storing authored motifs,
- testing melodic patterns,
- exporting generated sessions,
- converting external ideas into Tone-friendly note data  [github](https://github.com/Tonejs/Midi).

At runtime, sound should still be rendered by Tone.js using our own bell sample sets. That keeps the game fully browser-native and ensures the final sound is consistent across devices  [github](https://github.com/Tonejs/Tone.js).

## Design intent

The overall design goal is that the sound system communicates the strategic state of the world in a subtle but learnable way. A player should be able to hear that a small exploration group is active off to the right, that a large defensive force is forming near the viewed area, or that a distant attack is occurring at the edge of relevance, even before visually parsing every unit on the map.

In effect, the map becomes a living bell instrument. Gameplay generates the score, the camera determines the listening perspective, and the player hears not just events, but the world filtered through attention and scale.

## Initial implementation recommendation

Phase 1 should stay simple:
- Tone.js as the core engine  [github](https://github.com/Tonejs/Tone.js)
- Temporary bell-like synth voices for the first slice, then `Sampler` once bell assets are ready  [tonejs.github](https://tonejs.github.io/examples/sampler)
- `Panner` for stereo positioning  [tonejs.github](https://tonejs.github.io/docs/14.7.28/Panner)
- `Filter` and gain for distance/off-screen muffling  [tonejs.github](https://tonejs.github.io/docs/14.7.38/Filter)
- Shared `Reverb` and master `Limiter` for polish and safety  [tonejs.github](https://tonejs.github.io/docs/14.7.58/index.html)
- `@tonejs/midi` only for optional motif import/export  [github](https://github.com/Tonejs/Midi)

`Panner3D` and listener-based world audio can be added later if the simpler 2D camera-relative model proves insufficient  [tonejs.github](https://tonejs.github.io/docs/14.7.39/Panner3D).

## Short version

This system is a browser-based, Tone.js-driven bell sound engine where gameplay events create music-like signals instead of relying on a fixed soundtrack. Attack, defense, and exploration each have distinct bell behavior; each player has a unique bell palette; fleet size maps to pitch and density; and the player’s camera position and zoom determine which parts of the world sound close, centered, distant, or muffled  [github](https://github.com/Tonejs/Tone.js).

For this codebase, the concrete first slice is a client-only soundscape hook in `GalaxyViewport` that listens to new event-log rows, maps them into attack, defense, and exploration bell intents, and plays them through a small Tone.js engine using the live camera as the listening focus.