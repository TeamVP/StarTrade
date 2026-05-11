# StarTrade v1 PRD

## Document control

| Field | Value |
|---|---|
| Product | StarTrade v1 |
| Release focus | Empire-builders only |
| Genre | Real-time, semi-automatic grand strategy / 4X-lite browser game |
| Platform | Web first, mobile-capable web app |
| Primary stack direction | React frontend, Convex reactive backend, Vercel deployment |
| Turn model | 15-second real-time turns with limited player-triggered pause |
| PRD basis | Product requirements documents are meant to align teams around purpose, features, UX, assumptions, dependencies, open questions, and scope boundaries.[cite:60][cite:61][cite:62][cite:68] |

## Implementation status vs this PRD

Engineering tracks **what is built versus what remains** in a living checklist (Convex backend, frontend shell, playable loop, gaps toward full V1):

- **`docs/2026_May--StarTrade_v1_tech_stack_project_shape.md`** → section **“V1 implementation checklist (living document)”**

Use that checklist as the authoritative bridge between this PRD’s scope and the repository; update it when shipping meaningful vertical slices.

## Overview

StarTrade v1 is the empire-builder foundation of the game: players and AI opponents expand across a fixed galaxy map, build fleets, conquer star systems, defend borders, manage economic emphasis, and survive long enough to become major powers.

The main job of v1 is to ship the conquest game in a form that already contains the economic logic needed for later trader play. That means stockpiles, prices, treasury pressure, taxation, shortages, battle damage, and background trade all exist in v1, even though live trader players do not join until v2.

This version of the PRD adds a **combat damage system** so battles are costly even when a player eventually wins. A long fight can destroy food reserves, weapon reserves, research stockpiles, and population, making conquest expensive and creating immediate economic stress after victory.

## Product goals

### Primary goals

- Deliver a fast, readable, replayable empire-builder with meaningful strategic depth.
- Make the core loop understandable within a short first session: inspect, allocate, build, move, fight, stabilize, repeat.
- Support both AI-driven and human multiplayer galaxies that can continue for long periods.
- Create a treasury-and-stockpile model that matters immediately in v1 and cleanly extends into v2 trader play.
- Prevent stale late-game states by supporting viable new empire entry and imperial collapse into smaller successor states.
- Make battles feel costly enough that winning a war can still weaken the victor.

### Product principles

- **High-level strategy first:** the star system is the atomic gameplay unit, not individual planets or units.
- **Set and revisit, not constant babysitting:** system emphasis should be adjustable quickly and then left alone until conditions change.
- **Information must be earned:** players know owned systems in real time and everything else through aging observations.
- **Markets move goods, not players:** empire players do not manually route logistics between systems.
- **Homeworlds matter:** every empire should have a productive core that gives it resilience and a realistic ability to rebuild.
- **Failure should be painful, not terminal by default:** running out of money should fracture an empire before it instantly deletes a player from the galaxy.
- **War should scar territory:** prolonged combat should destroy useful things, not just fleets.

## Background and design intent

The game is a spiritual successor to Spaceward Ho! and to an earlier BASIC strategy game centered on hidden fleet movement, delayed arrivals, and conquest of productive systems. The modern version preserves that abstraction while adding a live map, stronger UX, a treasury model, background market behavior, persistent multiplayer structure, and territory damage from warfare.

The design target is a game that feels simple at the surface but produces interesting second-order effects. A decision to overemphasize shipbuilding on a frontier world should not just increase ships; it should also raise food stress, treasury pressure, and future vulnerability. A decision to force a long siege should not just cost ships; it should also wreck the system you are trying to capture.

## Success metrics

| Metric | Target for v1 |
|---|---|
| Time to first meaningful action | Under 3 minutes from entering a match |
| Time to grasp core loop | Under 10 minutes for a new player |
| Median session length | 20–45 minutes |
| Turn-resolution reliability | 99.9% successful server-side turn resolution |
| Late-join viability | New empire entrants survive at least 15 turns in mature galaxies at acceptable rates |
| Readability | Players can explain why a system is growing, starving, collapsing, damaged, or building quickly from the UI and event log |
| Economic clarity | Players can understand why the treasury is rising or falling without reading hidden formulas |
| War consequence clarity | Players can understand what was destroyed during a battle and what recovery is now needed |

## Target users

### Player segments

- **Classic strategy players:** players who like Spaceward Ho!, Risk, Diplomacy, Master of Orion, or other streamlined 4X games.
- **Live-pressure multiplayer players:** users who enjoy making quick decisions under a clock.
- **Persistent-world players:** users who want to join live galaxies already underway and still matter.
- **AI-simulation watchers:** users who enjoy observing empires rise and fall even when not issuing many commands.

### User needs

- Quick command input during 15-second turns.
- Clear visibility into production, shortages, treasury pressure, battle damage, and military risk.
- Enough hidden information to make scouting and timing matter.
- A late-game environment that stays dynamic rather than becoming a solved blob.

## Core gameplay loop

1. Inspect the galaxy map, alerts, and treasury state.
2. Adjust star-system emphasis between Food, Ships, and Research.
3. Set local ship behavior: defend locally or auto-route to a rally point.
4. Launch, split, or redirect fleets.
5. Resolve the turn and observe movement, combat, collateral damage, production, shortages, tax flow, and treasury change.
6. Respond to new intelligence, vulnerable targets, or collapsing frontier systems.
7. Repeat until the empire grows, fractures, stabilizes, or is ultimately destroyed.

## Player stories

### Empire player stories

- As an empire player, the player needs to click a system and instantly understand its food balance, productivity, local fleet, battle damage, and treasury contribution so a decision can be made inside one turn timer.
- As an empire player, the player needs to route newly built ships automatically so repetitive inputs do not dominate play.
- As an empire player, the player needs to split fleets with a fast drag-and-click flow so operational decisions feel tactile rather than bureaucratic.
- As an empire player, the player needs useful but stale information on foreign systems so scouting matters and attacks are not perfectly informed.
- As an empire player, the player needs the homeworld to feel like a real core of power that helps the empire recover from setbacks.
- As an empire player, the player needs battle aftermath to be visible so they can decide whether a newly captured world is worth defending, feeding, or rebuilding.
- As a late-joining empire player, the player needs a compensating core start that is asymmetric but still viable.

### AI stories

- As the simulation, AI empires need to obey the same economy, movement, scouting, damage, and collapse rules as humans so outcomes feel fair.
- As the simulation, AI empires need distinct strategic profiles so not every game converges to the same pattern.

## System model

### The galaxy

The galaxy is a fixed map of named star systems distributed across one or more galactic arms with graph-based travel routes. Each system is a gameplay destination and production node, not a detailed solar-system simulation. Systems may have flavour visuals of stars and planets, but those do not change mechanics.

Each star system must store at minimum:
- Name
- Position on galaxy map
- Adjacency / travel connections
- Base productivity
- Resource bonuses
- Population
- Current stockpiles by tracked commodity
- Current owner state: empire, unaligned, rebel, independent
- Current stationed ships
- Current emphasis settings
- Last-seen intelligence records by observing empire
- Tax status
- Homeworld / core-world flag where applicable
- Current battle-damage state or recent damage markers

## Functional requirements

### 1. Turn system

The game must run on a 15-second real-time turn timer. All player orders entered during a turn apply at the start of the next turn, never immediately.

Pause rules:
- Each player has a 20-second global pause budget.
- The budget replenishes to full every 5 minutes of real time.
- Pause halts the turn timer for all players.
- Budget does not stack above the cap.

### 2. Fleet movement and hidden travel

Fleets are assembled from stationed ships at owned systems. Players can create new fleets, split existing fleets, and send them into hyperspace.

Requirements:
- Travel time depends on route distance.
- Fleets in transit are visible only to their owner.
- Arrival is only revealed when the fleet emerges at the destination.
- Orders are committed this turn and applied next turn.
- Systems must support rally behavior so newly built ships can automatically remain for defense or head to a designated collection point.

### 3. Combat resolution

When a fleet arrives at a hostile or unaligned system:
- Defenders receive a half-turn opening attack.
- Then attacker and defender exchange full combat rounds simultaneously.
- After each full round, the attacker may continue or retreat.
- Retreat triggers another half-turn defensive attack.
- If defenders are destroyed, the system changes ownership.

Combat must preserve the baseline rule that defenders have a 2x advantage before technology modifiers. The system should reward overwhelming force and reduce purely random outcomes.

### 4. Combat collateral damage system

Battles must damage the contested star system itself. This is a core v1 mechanic, not cosmetic flavor.

#### Damage targets

During combat rounds, the system may suffer random damage to:
- Food stockpiles
- Weapons stockpiles
- Research or technology stockpiles
- Population
- Optional future-facing infrastructure health if that variable is added later

#### Damage timing

Requirements:
- After each full combat round, the game performs a collateral-damage check.
- Longer battles increase expected total damage simply because more rounds create more damage checks.
- Damage can occur regardless of which side is currently winning.
- Damage may continue until the battle ends or the attacker retreats.

#### Damage behavior

Requirements:
- Food stockpile damage should raise immediate starvation risk if the surviving population remains high.
- Weapons stockpile damage should reduce short-term ship-production efficiency until replenished.
- Research / technology stockpile damage should reduce future research throughput or reset stored research materials in that system.
- Population damage should lower tax income, local demand, and long-term productive potential.
- The event log must summarize what was damaged in a battle.

#### Design intent

This mechanic ensures that a prolonged siege can turn a valuable world into a burden. Winning quickly preserves value. Grinding battles create shattered conquests that need food, money, and time to recover.

### 5. Production emphasis

Each owned system must always produce all three core outputs:
- Food
- Ships
- Research

The player does not toggle outputs on or off. Instead, the player changes emphasis on the margin. No track can be driven to zero.

Requirements:
- Food emphasis affects food surplus or deficit and therefore stockpiles and population trajectory.
- Ship emphasis affects ship output.
- Research emphasis affects empire-wide tech progress.
- Changes take effect next turn.
- The UI must show projected changes before the player confirms or exits the panel.

### 6. Stockpiles, shortages, and prices

Every system must track stockpiles for key commodities, with Food operationally central in v1. Prices should respond to local supply-demand pressure and stockpile stress, creating a simple background market that later becomes player-facing in v2. Supply-and-demand systems are most legible when scarcity and abundance can be inferred from visible market signals rather than opaque rules alone.[cite:85][cite:86][cite:88][cite:90]

Requirements:
- Population consumes food each turn.
- Food surplus increases stockpiles.
- Food deficit reduces stockpiles first and population second.
- Food prices rise when stockpiles are low relative to demand.
- Background off-screen trade can deliver food after a delay when local prices become attractive enough.
- Those deliveries reduce shortages and bring prices back down.
- The UI must alert the player to boom, stability, deficit, and crisis states.
- Battle damage must be able to create instant post-battle shortages by destroying stockpiles.

### 7. Treasury and money flow

Each empire has an empire-wide treasury in credits. Treasury change per turn must be visible and explainable.

#### Treasury inflows

Empires make money from two main sources:
- **Population taxation:** systems contribute credits based on their population and local tax eligibility.
- **Market export revenue:** systems that sell excess goods into the background market can generate revenue, though this may be partly offset by import spending.

#### Treasury outflows

Empires spend money on:
- Background-market imports, especially food stabilization.
- Optional future-facing economic actions kept in the data model.
- Recovery costs indirectly created by battle damage, because damaged systems produce less and may require more imports.

#### Taxation rules

Requirements:
- Taxes are derived primarily from population across owned systems.
- Systems under active attack do not contribute taxes for that turn.
- Systems in severe instability states may contribute reduced or zero taxes.
- Population losses from battle damage must immediately reduce tax contribution.
- The empire overview must show total tax income and which systems are not contributing.

This gives the treasury a clear strategic logic: a peaceful, populated empire is rich; a burning frontier stops paying for itself.

### 8. Homeworld and core-world bonuses

Every empire must have a designated homeworld. The homeworld is a major gameplay anchor and should receive substantial structural bonuses.

#### Homeworld bonus requirements

The homeworld should receive meaningful bonuses such as:
- Higher effective productivity
- Stronger tax contribution reliability
- Faster ship output for the same emphasis mix
- Greater food resilience or storage capacity
- Better defensive recovery or baseline defense
- Better resistance to battle-damage effects than ordinary worlds, if tuning supports it

The exact numbers are tuning questions, but the effect must be strong enough that the homeworld feels like the empire's true capital base.

#### Core-entry package for new players

To support late joining in mature galaxies, a new player may receive a starter package of one, two, or three **core worlds**. One of those is the formal homeworld; the others may receive reduced but meaningful core-world bonuses. This gives late joiners enough economic and military capacity to expand without making them instantly dominant.

### 9. Technology progression

Technology must remain empire-wide and simple rather than branching.

Requirements:
- Systems contribute research into a common empire pool.
- Technology levels affect combat and potentially movement capabilities.
- Progress and estimated turns to next level must be visible.
- The model must remain readable under fast-turn play.
- Local research-stockpile damage from battles must be able to weaken a system's contribution temporarily.

### 10. Intelligence and fog of war

The game must use delayed information for non-owned systems.

Empire intelligence rules:
- Owned systems provide full real-time data.
- Previously scouted or visited foreign systems provide last-known snapshots.
- Structural facts such as map position, productivity potential, and resource bonuses remain durable.
- Volatile facts such as population, stationed fleet strength, battle damage, and current shortages decay in reliability as the snapshot ages.
- Never-visited systems are visible as destinations but without detailed information.

### 11. Unaligned systems

Unaligned systems must act as viable early and mid-game expansion targets.

Requirements:
- Unaligned systems have defensive fleets.
- If attacked and they survive, they invest more heavily in defense over time.
- Unaligned systems do not launch conquest fleets in v1.
- Unaligned systems operate local economies and can later become starting points for new entrants.
- Unaligned systems can also suffer battle damage and emerge weaker or more desperate after surviving an attack.

### 12. AI empires

The game must support AI-controlled empires using the same rules as human players.

Minimum AI profiles:
- Expansionist
- Fortress Builder
- Tech Racer
- Opportunist

AI must understand at minimum:
- How to adjust emphasis
- How to tax and preserve treasury health
- When to expand and when to defend
- When insolvency risk is rising
- How to respond to food crises and rebellion danger
- How battle damage changes the value of a target or captured world

### 13. Joining live games

Human empire players must be able to join galaxies already in progress.

#### Entry rules

- If viable unaligned territory exists, the new player receives a compensating cluster of one to three starter worlds.
- One of those worlds is marked as the new player's homeworld.
- Additional starter worlds may receive reduced core-world bonuses.
- The size of the entry package scales with galaxy maturity.
- If insufficient viable unaligned territory exists, the game may create a rebellion or secession event in a large empire, producing a viable breakaway start.
- The galaxy must announce the appearance of the new empire.

### 14. Insolvency, fracture, and survival

Financial collapse should damage an empire severely without automatically ending that player's participation.

#### Insolvency rule

If an empire runs out of money and remains unable to recover for two consecutive turns, the empire enters collapse.

#### Collapse result

- The empire loses all owned systems except its homeworld.
- Non-homeworld systems become independent or break away from the collapsing empire.
- The player is not eliminated unless the homeworld and remaining fleets are later lost.
- The homeworld bonus gives the player a real chance to rebuild from collapse.

This mechanic creates a strong penalty for overextension while keeping the galaxy politically alive.

### 15. Elimination and persistence

The game is open-ended rather than ending at a fixed victory condition.

Requirements:
- An empire is only fully eliminated when it loses its homeworld and any remaining fleets.
- Empire collapses do not count as elimination if the homeworld survives.
- Surviving players receive event messages for eliminations and major collapses.
- The galaxy remains open to new empire entrants over time.

## UX requirements

### Main map interactions

The galaxy map must support fast play suitable for 15-second turns.

Required interactions:
- Smooth zoom in and out.
- Pan across the galaxy.
- Click a system to open a detail panel.
- Click a fleet to inspect it.
- Drag from a fleet to a destination to create an order.
- Use a fast quantity control, such as a slider, to choose how much of a fleet to send.
- Set rally points for new ships.

### Core screens

| Screen | Purpose |
|---|---|
| Galaxy map | Primary play surface and command layer |
| System panel | Population, stockpiles, local fleet, emphasis, tax status, damage state, homeworld/core-world markers |
| Fleet panel | Selected fleet composition, ETA, origin, destination, split controls |
| Empire overview | Treasury, tax inflow, import spending, tech progress, empire alerts |
| Battle summary panel | Fleet losses, damaged stockpiles, population losses, retreat or conquest result |
| Turn log | Combat outcomes, captures, famines, damage events, collapses, scouting updates |
| Join flow | Entry package, homeworld designation, start confirmation |

### Information design requirements

The UI must make the following obvious:
- Food surplus, balance, deficit, and crisis
- Population growth or decline
- Real-time owned information versus stale foreign information
- Treasury rise versus treasury drain
- Systems that are not currently paying taxes
- Homeworld and core-world status
- Collapse risk when insolvency is approaching the two-turn threshold
- Post-battle damage by category, especially food, weapons, research, and population

## Non-functional requirements

### Performance

- Support smooth rendering on desktop browser for a galaxy with dozens of systems and multiple active fleets.
- Keep interaction responsive during the live turn timer.
- Resolve turns quickly enough that the game feels continuous rather than stalled.

### Reliability

- Turn resolution must be authoritative server-side.
- Multiplayer state must remain consistent across clients.
- Reconnection must restore current empire state, fleets, treasury, and turn timing accurately.
- Battle-damage resolution must be deterministic from the server's perspective and fully auditable in the event log.

### Accessibility

- Ownership, alerts, and crisis states must not rely on color alone.
- Core controls must remain usable without high-precision dragging only.
- Text and iconography must remain readable during zoom and on smaller screens.

## Assumptions

- Good PRDs define product behavior, assumptions, scope, and dependencies clearly enough that a team can build from them with fewer ambiguities.[cite:60][cite:61][cite:62][cite:68]
- A visible supply-demand framing produces a more intuitive economic model than hidden price logic alone, even when players are not directly participating in the market yet.[cite:85][cite:86][cite:88][cite:90]
- The homeworld bonus is necessary for both emotional identity and mechanical resilience.
- Population-based taxation is the simplest reliable base for empire income in v1.
- Attack-driven tax disruption is an elegant way to link war pressure to treasury collapse.
- Collapsing to the homeworld is more interesting than instant elimination when an empire becomes insolvent.
- Battles should produce economic scars, not just military casualties.

## Dependencies

### Product dependencies

- Final combat and tech modifier tuning
- Final homeworld and core-world bonus numbers
- Final tax formula and instability rules
- Final collapse thresholds and independence behavior
- Final star-system stat ranges and galaxy topology
- Final collateral-damage probabilities and category weights
- AI economic and military behavior tuning

### Technical dependencies

- Authoritative backend turn engine
- Real-time client synchronization
- Map rendering and interaction library
- Event log and alert pipeline
- Persistent game, player, and empire state storage
- Server-side battle-damage resolution logic

## Out of scope for v1

The following are explicitly out of scope for StarTrade v1:
- Human trader role
- Player-authored cargo route gameplay
- Chartered ship management by traders
- Real player-facing commodity trading screens
- Trader-owned fleets or military-economic hybrid play
- Deep diplomacy systems
- Procedural galaxy generation
- Branching tech trees
- Planet-level simulation below the star-system layer

## Open questions

1. What exact numeric bonus should the homeworld receive relative to normal systems?
2. How large should the reduced bonus be on secondary core worlds granted to late joiners?
3. Should collapse create fully independent worlds, region-based breakaways, or both depending on geography?
4. Should background-market food deliveries continue during severe insolvency, or fully stop once treasury is exhausted?
5. How quickly should tax contribution recover after a system stops being attacked?
6. Which non-food commodities should be fully simulated in v1 versus stored only for forward compatibility?
7. What is the right damage probability and damage amount per battle round so war is costly without making every conquest worthless?
8. Should defenders, attackers, or both influence the category mix of collateral damage?

## Milestone suggestion

| Milestone | Scope |
|---|---|
| Prototype | Galaxy map, turn timer, fleet movement, conquest loop, basic owned systems |
| Alpha | Emphasis model, stockpiles, treasury, taxation, food pressure, combat damage, AI empires |
| Beta | Homeworld bonuses, live join logic, collapse-to-homeworld mechanic, battle summaries, persistence |
| v1 Launch | Stable empire-builder with open-ended multiplayer galaxies, costly warfare, and resilient economic model |

## Acceptance criteria

StarTrade v1 is ready for launch when:
- A player can join a new or existing galaxy and control a viable empire.
- Every empire has a meaningful homeworld advantage that supports recovery and identity.
- Population-based taxes and market-linked spending create understandable treasury dynamics.
- Empires can suffer insolvency collapse back to the homeworld after two turns of failed recovery.
- A player can manage systems, launch fleets, scout, and conquer through the graphical map UI.
- AI opponents can play full games under the same economic and military rules as humans.
- Food shortages, stockpiles, background trade, tax interruption, battle damage, and treasury collapse all work end to end.
- Battles can destroy food, weapons, research stockpiles, and population in a way that the player can understand and respond to.
- The galaxy remains playable after collapses and eliminations and continues to accept new empire entrants.
