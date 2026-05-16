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