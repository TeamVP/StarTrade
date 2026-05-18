# StarStrat System Specification

## 1. Purpose

This document defines the implementation-level systems for StarStrat across:
- **v1 Empire Play**: conquest, production, taxation, treasury, collapse, and battle damage
- **v2 Trader Play**: market visibility, chartered shipping, route knowledge, automatic sale settlement, and solvency risk

It is intended to sit below the PRD level and above task-level engineering tickets. It defines game state, turn order, formulas, decision rules, service boundaries, and default tuning values.

## 2. System principles

- One shared simulation powers both empire and trader roles.
- Star systems are the main gameplay nodes; planets are flavor only.
- Turns resolve every 10 seconds.
- All orders entered during turn `T` resolve at the start of turn `T+1`.
- Ownership, economy, fleets, prices, and route knowledge all live in the same authoritative backend state.
- Traders never negotiate prices; settlement is automatic from system state.
- War changes the economy directly through tax interruption, stockpile loss, population damage, and ownership change.

## 3. Runtime architecture

### 3.1 Core services

| Service | Responsibility |
|---|---|
| Turn Engine | Resolves the full turn pipeline in deterministic order |
| Galaxy State Store | Stores systems, fleets, empires, traders, and event history |
| Economy Engine | Production, consumption, prices, taxes, imports, treasury updates |
| Combat Engine | Arrival, battle rounds, retreat, conquest, collateral damage |
| Market Engine | Commodity pricing, sale settlement, charter costs, solvency checks |
| Intelligence Engine | Empire fog of war and trader route knowledge |
| AI Engine | Empire AI decisions each turn |
| Notification Engine | Alerts, event log entries, collapse notices, battle summaries |

### 3.2 Authoritative model

- The backend is authoritative for all turn outcomes.
- Clients send intents, not final state mutations.
- All random rolls are generated server-side and stored in the event resolution record for auditability.
- A turn replay record should be reconstructible from persisted events plus seed data.

## 4. Shared game entities

### 4.1 StarSystem

```ts
StarSystem {
  id: string
  name: string
  x: number
  y: number
  regionId: string
  adjacentSystemIds: string[]

  ownerType: 'empire' | 'independent' | 'unaligned' | 'rebel'
  ownerEmpireId: string | null
  homeworldEmpireId: string | null
  coreWorldEmpireId: string | null

  baseProductivity: number         // 1-10
  productivityModifier: number     // derived each turn
  population: number
  maxPopulationSoft: number

  emphasisFood: number             // 0..100
  emphasisShips: number            // 0..100
  emphasisResearch: number         // 0..100

  stockFood: number
  stockWeapons: number
  stockResearch: number
  stockHeavyMetals: number
  stockEnergyCrystals: number
  stockRareEarths: number
  stockBioMedicine: number
  stockAntimatter: number

  localProductionFood: number
  localProductionShips: number
  localProductionResearch: number

  localDemandFood: number
  localDemandWeapons: number
  localDemandHeavyMetals: number
  localDemandEnergyCrystals: number
  localDemandRareEarths: number
  localDemandBioMedicine: number
  localDemandAntimatter: number

  stationedShips: number
  rallyTargetSystemId: string | null
  autoExportShips: boolean

  underAttack: boolean
  recentBattleTurns: number
  recentDamageFood: number
  recentDamageWeapons: number
  recentDamageResearch: number
  recentDamagePopulation: number

  taxEligible: boolean
  localTreasury: number            // used by independent systems; optional for empire systems

  lastPrices: CommodityPriceSet
  lastTradeVolume: CommodityVolumeSet
}
```

### 4.2 Empire

```ts
Empire {
  id: string
  name: string
  type: 'human' | 'ai'
  homeworldSystemId: string
  coreWorldSystemIds: string[]

  treasury: number
  techLevel: number
  researchPool: number

  totalPopulation: number
  totalShips: number
  status: 'active' | 'collapsing' | 'eliminated'
  insolvencyTurns: number

  pauseBudgetSeconds: number
  lastPauseRefreshAt: number

  aiProfile: 'expansionist' | 'fortress' | 'tech' | 'opportunist' | null
}
```

### 4.3 Fleet

```ts
Fleet {
  id: string
  ownerEmpireId: string
  originSystemId: string
  destinationSystemId: string
  ships: number
  state: 'stationed' | 'inTransit' | 'inBattle' | 'retreating'
  etaTurns: number
  visibleToOwnerOnly: boolean
}
```

### 4.4 Trader

```ts
Trader {
  id: string
  name: string
  wallet: number
  homeNodeSystemId: string
  knownNodeSystemIds: string[]
  activeCharterIds: string[]
  automationProfiles: AutomationProfile[]
}
```

### 4.5 Charter

```ts
Charter {
  id: string
  traderId: string
  currentSystemId: string | null
  destinationSystemId: string | null
  cargoCommodity: Commodity | null
  cargoAmount: number
  state: 'idle' | 'inTransit' | 'arrivedObservation' | 'arrivedOperational' | 'waiting'
  etaTurns: number
  travelRatePerTurn: number
  dockRatePerTurn: number
  freeArrivalTurnRemaining: boolean
  autoSell: boolean
  autoBuyCommodity: Commodity | null
  autoRepeat: boolean
  autoDepartAfterWait: number | null
  waitTurnsAccumulated: number
}
```

### 4.6 TraderKnowledge

```ts
TraderKnowledge {
  traderId: string
  systemId: string
  tier: 1 | 2 | 3
  establishedNode: boolean
  lastObservedTurn: number
  lastObservedPrices: CommodityPriceSet | null
  lastObservedVolumes: CommodityVolumeSet | null
  lastObservedPopulation: number | null
  lastObservedOwnerType: string | null
  lastObservedEmpireId: string | null
  lastObservedDamage: DamageSummary | null
  lastObservedSolvencyBand: 'healthy' | 'tight' | 'uncertain' | 'distressed' | null
}
```

## 5. Turn pipeline

Each turn resolves in this order:

1. Apply queued player and AI intents.
2. Refresh pause budgets where needed.
3. Advance fleet and charter transit counters.
4. Trigger fleet arrivals and charter arrivals.
5. Resolve combat and combat collateral damage.
6. Resolve conquest and retreat outcomes.
7. Resolve local production and local consumption.
8. Resolve commodity effects, including Weapons production bonus.
9. Resolve taxes and other treasury inflows.
10. Resolve market background imports/exports for empire systems.
11. Resolve trader sale attempts, waits, reroutes, and auto-actions.
12. Resolve solvency checks and empire collapse.
13. Recompute prices, volumes, and derived indicators.
14. Update intelligence and trader knowledge snapshots.
15. Write event log entries and notifications.
16. Open next turn for intent collection.

This order is important. Combat must happen before economic recovery so damage matters immediately.

## 6. Time and turn rules

- One turn = 10 seconds real time.
- Commands entered during turn `T` are committed for `T+1`.
- A global pause halts the turn timer for all players.
- Each empire player has 20 seconds pause budget.
- Pause budget replenishes to full every 300 seconds real time.

## 7. Travel model

### 7.1 Fleet travel

- Fleet travel time is based on graph distance.
- Default travel time band: 2 to 12 turns.
- Fleets in transit are hidden from other empires.
- Only origin, destination, and ETA are visible to the owner.

### 7.2 Trader charter travel

- Charter travel also uses graph distance.
- Chartered ships are not shown as military fleets.
- Transit cost is charged each turn while `state = inTransit`.

### 7.3 Distance function

A simple initial rule:

```ts
travelTurns = clamp(2, 12, ceil(routeLength / hyperspaceSpeed))
```

Where `routeLength` is the sum of edge costs across the chosen route.

## 8. Empire production model

Each owned system always produces food, ships, and research.

### 8.1 Emphasis weights

The system stores three emphasis sliders summing to 100.

Example default:
- Food: 34
- Ships: 33
- Research: 33

### 8.2 Effective productivity

```ts
effectiveProductivity = baseProductivity
  * homeworldMultiplier
  * coreWorldMultiplier
  * damagePenaltyMultiplier
  * shortagePenaltyMultiplier
  * weaponsBonusMultiplier
```

### 8.3 Homeworld and core-world defaults

Initial tuning defaults:
- Homeworld productivity multiplier: `1.50`
- Homeworld food storage multiplier: `1.50`
- Homeworld tax reliability bonus: `+25%`
- Homeworld collateral damage resistance: `20%`
- Secondary core-world productivity multiplier: `1.20`

These numbers are tuning defaults, not permanent law.

### 8.4 Production outputs

```ts
foodProduced = effectiveProductivity * foodWeight * foodSystemModifier
shipsProduced = effectiveProductivity * shipWeight * shipSystemModifier
researchProduced = effectiveProductivity * researchWeight * researchSystemModifier
```

Where weights are normalized emphasis values.

## 9. Commodity and stockpile model

Tracked commodities:
- Food
- Weapons
- Research stock
- Heavy Metals
- Energy Crystals
- Rare Earths
- Bio-Medicine
- Antimatter

### 9.1 Mandatory v1/v2 behaviors

- Food affects population survival and growth.
- Weapons affects ship-production efficiency.
- Research stock affects system research throughput contribution.
- Other commodities affect demand, prices, and v2 trading depth.

### 9.2 Stockpile bounds

- Stockpiles cannot go below `0`.
- Optional soft storage cap may be applied later; not required for first implementation.

## 10. Food and population model

### 10.1 Food demand

```ts
foodDemand = population * foodPerPop
```

Default tuning:
- `foodPerPop = 1`

### 10.2 Food resolution

```ts
foodBalance = foodProduced + foodImported + stockFood - foodDemand
```

Resolution rules:
- If `foodBalance >= 0`, surplus becomes new stock.
- If `foodBalance < 0`, consume all available stock and apply starvation.

### 10.3 Starvation damage

```ts
populationLoss = ceil(abs(foodBalance) * starvationFactor)
```

Default tuning:
- `starvationFactor = 0.25`

### 10.4 Population growth

If food is comfortably positive and recent damage is low:

```ts
populationGrowth = floor(population * growthRate)
```

Default tuning:
- `growthRate = 0.01`

## 11. Weapons effect model

Weapons are both a tradable commodity and an empire military input.

### 11.1 Weapons bonus

```ts
weaponsCoverage = min(1, stockWeapons / weaponsNeed)
weaponsBonusMultiplier = 1 + (maxWeaponsBonus * weaponsCoverage * shipWeight)
```

Default tuning:
- `weaponsNeed = max(1, population * 0.1)`
- `maxWeaponsBonus = 0.25`

### 11.2 Weapons consumption

```ts
weaponsConsumed = ceil(shipsProduced * weaponsConsumptionRate)
```

Default tuning:
- `weaponsConsumptionRate = 0.25`

## 12. Tax and treasury model

### 12.1 Tax base

Empire income is primarily taxation.

```ts
systemTaxBase = population * taxPerPop
```

Default tuning:
- `taxPerPop = 0.2`

### 12.2 Tax eligibility

A system contributes taxes this turn only if:
- It is empire-owned.
- It is not under attack this turn.
- It is not in severe instability state.
- Population is above zero.

### 12.3 Tax modifiers

```ts
systemTaxIncome = systemTaxBase
  * homeworldTaxMultiplier
  * stabilityMultiplier
  * damageTaxMultiplier
```

Default tuning:
- `homeworldTaxMultiplier = 1.25`
- `damageTaxMultiplier = 1 - min(0.5, recentDamagePopulation / max(1, population + recentDamagePopulation))`

### 12.4 Treasury update

```ts
empireTreasuryDelta = totalTaxIncome + marketExportRevenue - marketImportCost
empire.treasury += empireTreasuryDelta
```

## 13. Market pricing model

The market engine produces a local closing price for each commodity each turn.

### 13.1 Core pricing inputs

For each commodity in each system:
- current stockpile
- local production
- local demand
- recent trade volume
- population
- recent battle damage
- solvency context

### 13.2 Derived pressure score

```ts
pressure = (demand + safetyBuffer - stockpile - inboundSupplyForecast) / max(1, demand)
```

Where:
- `safetyBuffer` is commodity-specific
- `inboundSupplyForecast` includes scheduled background import if used

### 13.3 Price formula

```ts
price = basePrice * clamp(minPriceMult, maxPriceMult, 1 + pressure * elasticity)
```

Suggested defaults:

| Commodity | basePrice | elasticity | minPriceMult | maxPriceMult |
|---|---:|---:|---:|---:|
| Food | 10 | 0.8 | 0.5 | 3.0 |
| Weapons | 20 | 0.9 | 0.6 | 3.5 |
| Heavy Metals | 14 | 0.6 | 0.6 | 2.5 |
| Energy Crystals | 18 | 0.7 | 0.6 | 3.0 |
| Rare Earths | 22 | 0.8 | 0.6 | 3.2 |
| Bio-Medicine | 16 | 0.8 | 0.6 | 3.0 |
| Antimatter | 35 | 1.0 | 0.7 | 4.0 |
| Research stock | 24 | 0.7 | 0.6 | 3.0 |

### 13.4 Trade volume tracking

Each turn store:

```ts
lastTradeVolume[commodity] = amountSold + amountBought
```

## 14. Empire background market behavior

In v1 and still active in v2, systems can interact with a background market.

### 14.1 Imports

If Food pressure exceeds a threshold and treasury can pay:

```ts
if priceFood >= importTriggerPrice and empireTreasury >= estimatedImportCost
  schedule food import after delay
```

Default tuning:
- `importTriggerPrice = 18`
- background import delay = 1 to 3 turns

### 14.2 Exports

If a system has meaningful excess and no local crisis, it may sell to the background market and contribute export revenue.

## 15. Combat model

### 15.1 Battle phases

On hostile arrival:
1. Defender half-turn attack
2. Repeating full combat rounds
3. Attacker may continue or retreat after each full round
4. Retreat causes defender half-turn attack
5. If defenders die, ownership changes

### 15.2 Effective combat strength

```ts
attackerStrength = attackerShips * attackerTechMultiplier

defenderStrength = defenderShips * 2.0 * defenderTechMultiplier * homeworldDefenseMultiplier
```

Suggested default:
- `techMultiplier = 1 + techLevel * 0.1`
- `homeworldDefenseMultiplier = 1.15`

### 15.3 Loss calculation

Simple simultaneous exchange initial rule:

```ts
attackerLosses = ceil(defenderStrength * combatLossFactor)
defenderLosses = ceil(attackerStrength * combatLossFactor)
```

Default tuning:
- `combatLossFactor = 0.08`

Clamp losses so they cannot exceed current ship counts.

## 16. Collateral battle damage model

This is required by final v1 design.

### 16.1 Damage check cadence

After each **full combat round**, perform one collateral damage roll against the star system.

### 16.2 Damage trigger

```ts
damageOccurs = random() < collateralDamageChance
```

Default tuning:
- `collateralDamageChance = 0.45`

### 16.3 Damage category roll

If damage occurs, roll one primary target category:
- Food stockpile
- Weapons stockpile
- Research stockpile
- Population

Suggested initial weights:
- Food: 35%
- Weapons: 20%
- Research: 15%
- Population: 30%

### 16.4 Damage amount

```ts
damagePct = randomBetween(minDamagePct, maxDamagePct)
```

Suggested defaults:
- `minDamagePct = 0.05`
- `maxDamagePct = 0.20`

Apply to the chosen category's current amount.

### 16.5 Homeworld resistance

If the system is the defender's homeworld:

```ts
appliedDamagePct *= 0.8
```

### 16.6 Result storage

Update:
- `recentBattleTurns`
- `recentDamageFood`
- `recentDamageWeapons`
- `recentDamageResearch`
- `recentDamagePopulation`

### 16.7 Damage decay

Recent damage markers decay each turn:

```ts
recentDamageX = floor(recentDamageX * 0.85)
recentBattleTurns = max(0, recentBattleTurns - 1)
```

This preserves aftermath without permanent clutter.

## 17. Conquest model

If attackers win:
- System owner changes to attacker empire.
- Surviving population remains in place.
- Remaining stockpiles remain in place.
- Damaged state remains in place.
- Newly captured system starts with `underAttack = false` next turn unless another fleet arrives.
- Tax contribution is blocked for one stabilization turn after conquest.

## 18. Empire insolvency and collapse model

### 18.1 Insolvency counter

At end of each turn:

```ts
if empire.treasury <= 0:
  empire.insolvencyTurns += 1
else:
  empire.insolvencyTurns = 0
```

### 18.2 Collapse trigger

If:

```ts
empire.insolvencyTurns >= 2
```

Then empire collapses.

### 18.3 Collapse resolution

- Empire retains homeworld.
- Empire loses all non-homeworld systems.
- Lost systems become `independent` unless later tuned into regional breakaways.
- Each new independent system receives starter local treasury.
- Empire survives if it still has homeworld and/or fleets.

Suggested default for new independent treasury:

```ts
localTreasury = 10000
```

## 19. Trader market model

### 19.1 Trader role rules

- Traders do not own territory.
- Traders do not own military fleets.
- Traders buy cargo, charter transport, and sell cargo.
- Sale price is always automatic from destination market state.

### 19.2 Charter costs

Per charter:

```ts
travelRatePerTurn = charterBaseRate * travelRateMultiplier

dockRatePerTurn = charterBaseRate
```

Suggested defaults:
- `charterBaseRate = 2`
- `travelRateMultiplier = 2`

So by default:
- travel turn cost = 4
- dock turn cost = 2

### 19.3 Arrival timing rules

#### New route

If destination is **not** an established node for this trader:
- On arrival, charter enters `arrivedObservation`
- Next turn is observation only
- Trader gets full real-time local data
- No buy or sell may execute that turn
- No dock fee is charged for that first post-arrival turn
- On following turn, charter enters `arrivedOperational`

#### Established route

If destination **is** an established node:
- Trader has real-time information before arrival
- On first post-arrival turn, trader may sell, buy, and depart
- If the trader leaves at end of that same turn, no dock fee is charged
- If the trader remains longer, dock fees begin next turn

### 19.4 Node establishment

A system becomes an established node for a trader when either:
- the trader successfully completes one sale there, or
- the trader successfully completes one purchase there after already observing the market

This is the simplest first rule.

## 20. Trader sale settlement model

### 20.1 Sale attempt

When trader attempts to sell `amount` of `commodity` into system `S`:

```ts
unitPrice = currentMarketPrice(S, commodity)
tradeValue = amount * unitPrice
```

### 20.2 Need test

For first implementation, a destination is considered willing to buy if:

```ts
pressure > 0
```

For that commodity.

### 20.3 Solvency check

Hybrid rule recommended:

```ts
availableBuyerFunds =
  if S.ownerType == 'empire': empireTreasuryAccess(S.ownerEmpireId)
  else: S.localTreasury
```

Then:

```ts
if availableBuyerFunds >= tradeValue:
  sale succeeds
else:
  sale fails
```

### 20.4 Settlement effects on success

- Trader wallet increases by `tradeValue`
- Buyer funds decrease by `tradeValue`
- System stockpile for commodity increases by `amount`
- `lastTradeVolume` updates
- Price recalculates at end of turn

### 20.5 Settlement effects on failure

- Trader wallet unchanged
- Cargo unchanged
- Charter remains at system
- Event log entry created: `SALE_FAILED_INSUFFICIENT_FUNDS`

### 20.6 Partial sale policy

First release: **disabled**.

## 21. Trader buy model

When trader buys at origin:

```ts
purchasePrice = currentMarketPrice(origin, commodity)
purchaseCost = amount * purchasePrice
```

Rules:
- Trader must have enough wallet balance.
- Origin stockpile must have enough supply unless later abstracted.
- On purchase success, wallet decreases and charter cargo fills.

## 22. Waiting and automation model

### 22.1 Waiting

A trader may leave cargo in dock waiting for:
- price improvement
- solvency recovery
- political change
- manual decision delay

### 22.2 Waiting cost

After free arrival turn expires:

```ts
wallet -= dockRatePerTurn
waitTurnsAccumulated += 1
```

### 22.3 Automation flags

Per charter support:
- autoSell
- autoBuyCommodity
- autoRepeat
- autoDepartAfterWait
- marginFloor
- dangerPause

### 22.4 Automation resolution order

At trader resolution step:
1. If operational and autoSell enabled, attempt sale.
2. If sale succeeded and autoBuy enabled, attempt buy.
3. If route repeat valid, launch return trip.
4. If sale failed and wait limit reached, auto-depart if configured.

## 23. Trader knowledge model

### 23.1 Knowledge tiers

- Tier 1: known node, real-time
- Tier 2: stale market snapshot
- Tier 3: rumor only
- Unknown: hidden

### 23.2 Staleness by distance

Recommendation:

```ts
infoAgeTurns = shortestPathTurns(nearestKnownNode, targetSystem)
```

### 23.3 Snapshot update

When a trader observes a system in person:
- prices, volumes, population, ownership, damage, solvency band update to real-time
- `lastObservedTurn = currentTurn`
- system can become established node if trade occurs

## 24. Solvency bands for UI

Derived from funds relative to likely near-term purchase needs.

Suggested bands:

```ts
if availableFunds >= strongThreshold: 'healthy'
else if availableFunds >= mediumThreshold: 'tight'
else if availableFunds > 0: 'uncertain'
else 'distressed'
```

This is only a UI summary, not the actual settlement rule.

## 25. Intelligence model for empires

Empire-side fog of war remains separate from trader knowledge.

For non-owned systems empire sees:
- durable data: location, route structure, fixed productivity tier
- volatile data: last seen population, fleet, damage, shortages
- snapshot age per observing empire

## 26. AI system requirements

Empire AI must evaluate:
- attack strength vs defender strength
- food crisis risk
- treasury stability
- tax loss from contested borders
- whether battle damage makes a target less desirable short term
- whether captured systems need immediate stabilization

Minimum trader AI is optional for first release. If implemented later, it should use the same node, knowledge, and solvency rules as human traders.

## 27. Event and notification schema

Minimum event types:

- `FLEET_LAUNCHED`
- `FLEET_ARRIVED`
- `BATTLE_STARTED`
- `BATTLE_ROUND_RESOLVED`
- `COLLATERAL_DAMAGE_APPLIED`
- `SYSTEM_CONQUERED`
- `SYSTEM_HELD`
- `FOOD_CRISIS_STARTED`
- `FOOD_CRISIS_ENDED`
- `TAX_INTERRUPTED`
- `EMPIRE_COLLAPSE_STARTED`
- `SYSTEM_BECAME_INDEPENDENT`
- `TRADER_CHARTER_PURCHASED`
- `TRADER_ARRIVED_OBSERVATION`
- `TRADER_SALE_SUCCEEDED`
- `TRADER_SALE_FAILED_INSUFFICIENT_FUNDS`
- `TRADER_WAITED_IN_DOCK`
- `TRADER_NODE_ESTABLISHED`

Each event should include:
- turn number
- actor id
- target id
- summary payload
- audit payload for formulas and random rolls where relevant

## 28. Suggested database collections

- `games`
- `systems`
- `empires`
- `fleets`
- `traders`
- `charters`
- `traderKnowledge`
- `turnIntents`
- `events`
- `priceHistory`
- `tradeHistory`

## 29. Balancing defaults

These are starting values for implementation and playtest, not final balance.

| Variable | Default |
|---|---:|
| Turn length | 15 sec |
| Pause budget | 20 sec |
| Pause refresh | 300 sec |
| Homeworld productivity multiplier | 1.50 |
| Core-world productivity multiplier | 1.20 |
| Defender base multiplier | 2.0 |
| Tech bonus per level | 0.10 |
| Collateral damage chance per full round | 0.45 |
| Collateral damage amount | 5% to 20% |
| Food per population | 1.0 |
| Tax per population | 0.2 |
| Max weapons bonus | 25% |
| Charter base dock cost | 2 |
| Charter travel multiplier | 2x |
| Collapse trigger | 2 insolvent turns |
| Independent starter treasury | max(50, productivity * 10) |

## 30. Implementation priorities

### Phase 1

- Shared turn engine
- Systems, empires, fleets
- Combat with conquest
- Food and taxation
- Insolvency collapse

### Phase 2

- Collateral battle damage
- Price engine
- Background imports/exports
- Trader entity and charter loop

### Phase 3

- Trader knowledge tiers
- Established route logic
- Automation
- Better UI indicators and analytics

## 31. Open engineering decisions

1. Whether route computation uses fixed graph edges or weighted dynamic edges.
2. Whether empire systems use only empire treasury or also local localTreasury buffers.
3. Whether background imports are explicit queued objects or implicit delayed state changes.
4. Whether battle damage can hit more than one category in very long battles.
5. Whether a newly independent system inherits any embargo or cooldown state after collapse.
6. Whether trader charters are single-use or can persist indefinitely as reusable shipping contracts.

## 32. Acceptance criteria

The system spec is considered implemented correctly when:
- Turn order is deterministic and auditable.
- Fleets travel hidden and resolve battle correctly.
- Long battles visibly damage system resources and population.
- Food crises, tax loss, and treasury collapse interact correctly.
- Empire collapse returns the empire to its homeworld and frees other systems.
- Traders can buy, travel, observe, sell, wait, and reroute under automatic pricing.
- Established trader routes are measurably more efficient than first-time routes.
- A system can show high demand but still fail a trade because it cannot pay.
- Recent battle damage can create profitable but risky trade opportunities.
