# StarStrat v2 PRD

This is a document that should only be used once V1 is fully built, play tested and accepted as complete.

## Document control

| Field | Value |
|---|---|
| Product | StarStrat v2 |
| Release focus | Trader gameplay on top of the live StarStrat v1 empire simulation |
| Genre | Real-time market-and-logistics strategy game inside a persistent galactic war |
| Platform | Web first, mobile-capable web app |
| Depends on | StarStrat v1 final ruleset |
| Turn model | 15-second real-time turns inherited from v1 |
| Core PRD intent | Define purpose, player needs, functional behavior, UX, assumptions, dependencies, scope, and acceptance criteria |

## Overview

StarStrat v2 adds a second playable role to the galaxy: the trader. Traders do not conquer systems, command war fleets, negotiate contracts, or set prices. They make money by reading market conditions, chartering civilian shipping, buying goods where they are cheap, moving them through a war-torn galaxy, and selling them where local need and solvency make the trade profitable.

V2 is built directly on the final v1 simulation. That means traders operate inside a galaxy where empires earn money primarily from population taxation, lose tax income when systems are under attack, can collapse back to their homeworld after two turns of insolvency, and leave behind systems that may be damaged by war, short of food, short of weapons, or suddenly independent.

The trader game is therefore not a separate economy. It is a player-facing layer on top of the same living economy already running for empire players.

## Product goals

### Primary goals

- Add a fully playable trader role that can enter a live galaxy at any time.
- Make the trading loop understandable from a small number of visible signals: price, volume, population, information age, route distance, charter cost, and solvency risk.
- Reward network-building by making established routes faster and cheaper to work than first-time exploratory routes.
- Ensure trader action materially affects empire survival, especially after famine, battle damage, and imperial collapse.
- Keep the system strategically rich without requiring negotiated contracts, manual buy orders, or military control by traders.

### Product principles

- **Markets set prices:** the sale price is always determined automatically by current local supply and demand.
- **Credit risk matters:** a high price is meaningless if the buyer cannot pay.
- **Time is a cost:** ships cost money while traveling and while waiting.
- **Networks matter:** known routes should be more efficient than unknown ones.
- **War reshapes trade:** battles damage populations and stockpiles, creating both shortages and risk.
- **Traders are civilians:** they solve problems with timing, knowledge, and cargo choice, not weapons.

## Relationship to v1

StarStrat v2 inherits the following from v1 and must remain fully consistent with them:

- The galaxy is a fixed map of star systems linked by travel routes.
- Empires and AI continue to play the conquest game in real time.
- Systems track population, stockpiles, prices, ownership, tax status, and recent battle damage.
- Battles can destroy food stockpiles, weapons stockpiles, research stockpiles, and population.
- Food shortages hurt population and stability.
- Weapons stock supports ship-production efficiency.
- Empires earn income mainly through population taxation and some export revenue.
- Systems under active attack stop paying taxes that turn.
- If an empire stays insolvent for two consecutive turns, it collapses back to its homeworld and other systems break away or become independent.

V2 should never duplicate or contradict these rules. It should expose them to traders in a form that supports route planning and economic decisions.

## Scope

### In scope

- Trader role joining live galaxies
- Buying and selling commodities through automatic market settlement
- Per-turn charter costs for civilian shipping
- New-route arrival delay and established-route efficiency
- Waiting in dock as a strategic choice
- Solvency-based failed sales
- Trader information network with real-time and stale market data
- Market effects of war damage and empire collapse
- Multi-commodity trade, including Food and Weapons
- Automation tools for repeated routes

### Out of scope

- Trader-owned combat fleets
- Negotiated contracts or buy orders
- Player-set sale prices
- Player-to-player contracts
- Convoys, escorts, piracy, or direct tactical cargo combat
- Empire-manual internal logistics routing
- Loans, debt markets, insurance, or financial derivatives

## Target users

### Player segments

- Players who like economic strategy more than direct war.
- Late joiners who want meaningful influence in an already-running galaxy.
- Players who enjoy reading imperfect information and acting under uncertainty.
- Optimization players who enjoy turning one profitable route into a wider network.

### User needs

- A viable first route shortly after joining.
- Clear explanations of price opportunity and payment risk.
- A meaningful difference between exploring a route and operating an established route.
- Enough automation that repeated trading does not become click-heavy.
- Clear visibility into why a route failed, especially whether the problem was price movement, insolvency, or war damage.

## Core loop

1. Join a live galaxy as a trader.
2. Review known and rumoured markets.
3. Charter cargo space from a known system.
4. Buy a commodity at origin.
5. Travel to destination.
6. On a new route, spend the first post-arrival turn observing the destination market.
7. On an established route, use real-time knowledge to trade on the first post-arrival turn.
8. Sell cargo if the destination can pay.
9. Buy new cargo, wait in dock, or depart.
10. Expand route knowledge and repeat.

## User stories

### Trader stories

- As a trader, the player needs to enter a live galaxy and immediately see at least one plausible commercial opportunity.
- As a trader, the player needs route profitability to be understandable without seeing hidden formulas.
- As a trader, the player needs unknown destinations to require one turn of local observation so exploration has friction.
- As a trader, the player needs established routes to be operationally smoother so building a network is worth it.
- As a trader, the player needs to wait in dock when a destination cannot pay or when next-turn conditions may improve.
- As a trader, the player needs to see when battle damage has likely created a shortage worth serving.
- As a trader, the player needs to see when a system has become newly independent after imperial collapse, because that may create a fresh buyer.

### Empire-adjacent stories

- As an empire player, the player needs trader-delivered food to help stabilize worlds damaged by siege or famine.
- As an empire player, the player needs trader-delivered weapons to improve ship-production efficiency on systems that still have functioning industry.
- As the simulation, the game needs traders to participate in the same economy as empires, not a separate minigame.

## Role model

| Role | Controls territory | Commands military fleets | Charters ships | Trades goods | Sets prices | Uses money pool |
|---|---|---|---|---|---|---|
| Empire player | Yes | Yes | No | Indirectly through local markets | No | Treasury |
| Trader player | No | No | Yes | Yes | No | Wallet |
| AI empire | Yes | Yes | No | Indirectly | No | Treasury |

## Commodity model

### Core commodities

| Commodity | Main use in the simulation | Trader logic |
|---|---|---|
| Food / Organics | Keeps population alive; shortages cause decline | Most essential shortage trade |
| Heavy Metals | Supports industrial continuity | Useful for productive worlds and recovery |
| Energy Crystals | Supports advanced production efficiency | Higher-value technical input |
| Rare Earths | Supports research-sensitive output | Valuable for research-oriented systems |
| Bio-Medicine | Helps resilience and recovery | Attractive after battle damage or prolonged shortages |
| Antimatter | Reserved for advanced economic or mobility functions | Premium speculative trade good |
| Weapons | Boosts ship-production efficiency while stock remains | Key military input, especially in threatened systems |

### Commodity effects

Requirements:
- Food must remain the most politically important commodity because shortages immediately threaten population.
- Weapons must improve ship-production efficiency while stock exists and while the system still has population and productive capacity to use them.
- Commodity effects must respect battle damage; for example, Weapons are less useful on a world whose industry or population has been badly degraded.
- Recent battle damage should influence market need and price pressure.

## Market model

### Automatic settlement

The core rule of v2 is that **sale price is never set by the trader and never set by a destination buy order**. When cargo is offered for sale, the game calculates the current local market price from local conditions and uses that price if the destination can pay.

Each system marketplace must track at minimum:
- Stockpile by commodity
- Local production by commodity
- Local consumption by commodity where relevant
- Population
- Recent trade volume
- Closing price history
- Ownership state
- Treasury access or liquid buying power
- Recent battle damage markers

### Sale resolution

When a trader attempts to sell:
1. Determine current local market price for the commodity.
2. Determine whether the system still meaningfully needs more of that commodity at that price.
3. Check whether the buyer can actually pay from the funds available to that system or its governing empire.
4. If payable, execute the sale automatically at the computed price.
5. If not payable, the sale fails and the cargo stays with the trader.

### Payment failure

A failed sale due to insolvency must be a normal game event, not an edge case.

Requirements:
- The UI must explain clearly that the destination could not pay.
- Cargo remains on the chartered ship.
- The trader may wait, reroute, or retry later.
- The destination may later become payable if treasury conditions improve or if it becomes newly independent after imperial collapse.

### Partial versus full sale

For clarity in first release, v2 should default to all-or-nothing sale settlement. Partial sale support may be added later if needed for balance.

## Route knowledge and information model

### Knowledge tiers

| Tier | What the trader sees |
|---|---|
| Tier 1: Known node | Real-time prices, volume, solvency signal, charter access |
| Tier 2: Known market | Stale closing price, stale volume, population, ownership, recent damage signal, age marker |
| Tier 3: Rumour | System name, ownership, broad hint only |
| Unknown | Not shown |

### Information age

Information should age by network distance from the trader's known commercial nodes. The farther away the system, the older the visible market snapshot.

### New-route timing rule

If a trader reaches a system that is not yet one of their established commercial nodes:
- The first post-arrival turn is an observation turn.
- During that turn, the trader gains full real-time local data.
- No buy or sell action can execute during that first post-arrival turn.
- That first post-arrival turn is free of dock cost.

This creates a discovery cost and prevents instant exploitation of every new destination.

### Established-route timing rule

If the trader already has an established node at the destination:
- The trader sees real-time destination data before arrival.
- On the first post-arrival turn, the trader can sell, buy, and depart in that same turn.
- If the trader leaves immediately at the end of that turn, no dock fee is charged for that turn.

This gives established routes a major efficiency advantage.

### Establishing a node

A system becomes an established trader node once the trader has successfully completed meaningful business there or otherwise activated a persistent commercial presence.

Requirements:
- An established node grants real-time information to that trader.
- An established node becomes a future origin for charters.
- An established node expands nearby rumour visibility.

## Charter model

### Per-turn charter cost

Traders do not own freighters permanently. They hire capacity.

Requirements:
- Charter cost is charged per turn.
- Travel turns cost more than docked turns.
- Default rule: travel turn cost is 2x docked turn cost.
- The first post-arrival turn is free.
- Additional waiting turns in dock incur dock cost each turn.
- Charter availability should vary by system size, stability, and market activity.

### Waiting in dock

Waiting is a core decision, not a failure state.

Reasons to wait:
- Destination cannot currently pay.
- Current price is weak but expected to improve.
- Nearby political change may create a better selling condition.
- A collapsing empire may lose the system, making it independent and newly solvent.

Requirements:
- Trader can wait any number of turns.
- Waiting must show ongoing cost clearly.
- Trader can set automation, such as auto-sell if payable or auto-depart after X turns.

## Route planner

Before the trader commits to a route, the planner must show:
- Origin purchase price
- Latest known destination sale price
- Latest known trade volume
- Population
- Ownership
- Information age
- Battle-damage signal if known
- Estimated travel turns
- Estimated charter cost
- Solvency signal if known
- Margin estimate with uncertainty label

The planner must communicate that estimates may fail because:
- Prices can move before arrival.
- Other traders may satisfy demand first.
- The destination may be unable to pay.
- The system may be conquered, damaged, or cut off before arrival.
- Imperial collapse may change the buyer structure.

## Interaction with v1 battle damage

This section is critical because it connects v2 directly to the final v1 rules.

### Market consequences of battle damage

Recent battles can damage:
- Food stockpiles
- Weapons stockpiles
- Research stockpiles
- Population

That means a post-battle system may exhibit:
- Sudden food shortages with a still-large surviving population
- High value for Bio-Medicine or recovery goods
- Strong demand for Weapons if defenses and ship production are being rebuilt
- Lower overall buying capacity if population and tax base were badly damaged
- High visible price but poor actual solvency

### Trader gameplay effect

This creates one of the best trader opportunities in the game: a recently damaged system can become desperate for imports, but the player must judge whether the damage produced a **real buyer** or just a broke, starving wreck.

### UI requirements for damage-aware trading

If a system has recent battle damage and the trader has sufficient knowledge, the market panel should show:
- Recent damage indicator
- Which categories were hit, if known
- Whether population loss likely weakened solvency
- Whether food or weapons shortage appears acute

## Interaction with v1 empire solvency and collapse

### Empire money model

Traders operate in a galaxy where empires mainly raise money from population taxes and lose taxes from attacked worlds. That means war can push an empire into insolvency even while prices inside that empire are spiking.

### Collapse consequences for traders

If an empire remains insolvent for two consecutive turns and collapses back to its homeworld:
- Former colonies can become independent buyers.
- A system that could not pay while trapped in a bankrupt empire may become payable later.
- Traders already waiting in dock may suddenly gain a valid sale opportunity.
- Route maps and ownership status must update immediately.

This rule should create dramatic moments where patient traders profit from political breakdown.

## Join flow

### Spawn logic

New traders should start in regions with plausible early success.

Requirements:
- Prefer regions with at least one likely profitable nearby route.
- Avoid over-saturated starts where many traders are already compressing margins.
- Avoid starts where all nearby systems are insolvent, destroyed, or unreachable.

### Starting package

A trader begins with:
- Enough credits to charter an initial ship and buy a modest first cargo
- One Tier 1 starting node
- Nearby Tier 2 and Tier 3 market visibility
- One or more suggested starter routes

## Automation

Because repeated trade should not become tedious, v2 must support route automation.

Minimum automation settings:
- Auto-sell when payable
- Auto-buy selected return commodity when conditions are met
- Auto-depart after X waiting turns
- Auto-repeat route
- Pause automation if route margin falls below threshold
- Pause automation if destination enters severe war-risk or insolvency state

## UX requirements

### Core screens

| Screen | Purpose |
|---|---|
| Trader galaxy map | Known systems, route opportunities, ownership, risk, information age |
| Market panel | Current or stale market data, solvency signal, battle-damage indicators |
| Charter panel | Available cargo ships, per-turn rates, route duration, waiting-cost rules |
| Cargo planner | Buy commodity, choose destination, see estimate and automation options |
| Trader overview | Wallet, active charters, cargoes, nodes, recurring routes |
| Event log | Sales, failed sales, insolvency alerts, battle-damage discoveries, ownership change |

### Information design requirements

The UI must clearly distinguish:
- Real-time versus stale market information
- New-route versus established-route timing rules
- Travel cost versus dock waiting cost
- High price versus actual solvency
- Damaged but attractive markets versus healthy but crowded markets
- Temporary opportunity versus stable recurring route

## Functional requirements summary

### Must-have for v2 launch

- Trader join flow into live galaxies
- Tiered route knowledge and information-age system
- Automatic market pricing and sale settlement
- Solvency-based failed-sale logic
- Per-turn chartering with travel and dock rates
- Free first post-arrival turn
- New-route observation turn
- Established-route immediate post-arrival trading
- Waiting-in-dock mechanic
- Battle-damage-aware market signals
- Collapse-aware market ownership updates
- Basic route automation

### Should-have

- Suggested starter routes
- Profit history per route
- Solvency labels
- Battle-damage labels in route planner
- Margin-threshold automation

### Nice-to-have later

- Deeper forecasting tools
- Reputation effects with systems
- Advanced route analytics overlays

## Non-functional requirements

### Performance

- Trader UI must remain responsive while the galaxy simulation continues in 15-second turns.
- Route planning and market inspection should feel immediate.
- Automation should meaningfully reduce repetitive input.

### Reliability

- Market settlement must be authoritative server-side.
- Wallet, cargo, and charter charges must be transactional and recoverable after disconnect.
- Ownership and solvency changes must propagate quickly enough that traders are working from consistent state.

### Accessibility

- Information age, solvency, damage state, and risk must not rely on color alone.
- Core trader flows must work on smaller screens.
- Automation must reduce speed dependence for players who cannot or do not want to micromanage every turn.

## Dependencies

### Product dependencies

- Final v1 commodity definitions and stockpile behavior
- Final v1 tax and insolvency formulas
- Final v1 battle-damage outputs and visibility rules
- Final weapons bonus formula and cap
- Final trader node-establishment rule
- Final charter-rate tuning

### Technical dependencies

- Authoritative shared simulation backend
- Per-trader knowledge graph storage
- Market settlement engine
- Wallet and cargo ledger
- Charter-cost engine
- Event log and route automation pipeline

## Assumptions

- Traders should interact with the same simulation the empire game already uses, not a separate economy.
- New-route friction and established-route efficiency are both necessary for satisfying long-term play.
- Waiting must cost something or traders will gain a free option on every market.
- Battle damage should create some of the best trade opportunities in the game.
- Imperial collapse should create new trade opportunities rather than only shutting markets down.

## Open questions

1. Should solvency checks use empire treasury only, system treasury only, or a hybrid rule?
2. Should independent systems always gain a minimum starter treasury when they break free?
3. What exact event turns a visited system into an established node: any visit, any completed trade, or a minimum volume threshold?
4. Should battle damage directly increase willingness to pay, or only affect price indirectly through stockpile and population state?
5. Should partial sales remain disabled permanently, or be added later for advanced play?
6. How strong should route automation be before it starts removing too much judgement from the game?

## Milestone suggestion

| Milestone | Scope |
|---|---|
| Prototype | One-commodity trade loop, stale data, chartering, failed-sale logic |
| Alpha | Multi-commodity markets, node establishment, waiting, automation basics |
| Beta | Battle-damage integration, collapse-aware trading, balancing, persistence |
| v2 Launch | Full trader role inside the live StarStrat galaxy |

## Acceptance criteria

StarStrat v2 is ready for launch when:
- A trader can join a live galaxy and find a plausible first route quickly.
- New routes require one post-arrival observation turn before first trade.
- Established routes allow immediate business on the first post-arrival turn.
- The first post-arrival turn is free, while further waiting costs dock fees.
- Travel turns cost more than docked turns.
- A destination can refuse settlement because it cannot pay.
- Traders can exploit or avoid battle-damaged systems based on visible signals.
- Traders can benefit from imperial collapse events that create newly independent buyers.
- Repeated routes can be automated without removing the need for judgement.
