# StarTrade identity, profile, role, and trader schema rationalization

## Purpose

This document proposes a concrete target data model for StarTrade user identity,
profile, game participation, empire control, and trader participation.

It is based on the current Convex schema and the planned v2 trader gameplay.
The goal is to keep what is already structurally sound, remove modeling
ambiguity, and provide a migration path that can be rolled out safely with
Convex.

## Executive summary

The current schema is partly correct and partly inconsistent.

What is already correct:

- Keep `users` separate from `authAccounts`.
- Keep app-facing profile data separate from auth data.
- Keep per-game simulation actors separate from global user identity.

What needs rationalization:

- The current `usr_profiles` versus `users.name` and `users.image` split lacks a
  declared source of truth.
- `usr_game_roles` is currently treated by code as one active row per user per
  game, even though the table shape suggests a more flexible model.
- Trader gameplay is modeled inconsistently: some records use a per-game trader
  identity, while others point directly at `userId`.

Recommended direction:

- Keep `users`, `authAccounts`, and `usr_profiles` as separate concerns.
- Make `usr_profiles` the canonical app profile.
- Keep per-game trader actors in `sim_trader_identities`.
- Stop linking trader gameplay directly to `userId`; link it through
  `traderIdentityId` instead.
- Either explicitly commit to one participation mode per user per game, or
  split the current `usr_game_roles` concept into membership plus assignment.

## Current model assessment

### 1. Auth and identity

Current tables:

- `users`
- `authAccounts`
- `authSessions`
- `authRefreshTokens`
- `authVerificationCodes`

Assessment:

- This is correct and should remain separate.
- `users` is the durable identity anchor for a person in the app.
- `authAccounts` is the login-method layer for password, Google, and future
  providers.

Decision:

- Keep as-is.

### 2. App profile

Current tables:

- `usr_profiles`
- optional profile-like fields on `users`: `name`, `image`

Assessment:

- A separate profile table is correct.
- The current overlap between auth-facing and app-facing profile fields should
  be reduced.

Decision:

- `usr_profiles` should be the canonical app profile.
- `users.name` and `users.image` should be treated as auth-provider-derived
  identity metadata, not as the main in-game profile.

Target meaning:

- `users`
  - Canonical user identity row.
  - Auth-linked email and phone.
  - Provider-sourced fallback identity values.
- `usr_profiles`
  - Canonical display name shown in the app.
  - Avatar chosen by the player.
  - Preferences such as timezone and consent.

### 3. Per-game participation and empire control

Current table:

- `usr_game_roles`

Current fields:

- `gameId`
- `userId`
- `role` in `observer | empire | trader | admin`
- `empireId`
- `joinedAt`
- `isActive`

Assessment:

- The table is workable if and only if StarTrade allows exactly one active role
  per user per game.
- Current code uses `.unique()` by `gameId + userId`, which means the effective
  application rule today is one row per user per game.
- That rule is acceptable for v1 if a user must choose exactly one seat in a
  game.
- That rule becomes too rigid if a user may be both admin and empire player, or
  both empire player and trader, in the same game.

Decision:

- Short term: keep the current behavior explicit.
- Medium term: rename or restructure the table to reflect actual semantics.

## Trader model assessment

Current trader-related tables:

- `sim_trader_identities`
- `eco_bg_traders`
- `trd_charters`
- `trd_runs`

Assessment:

- `sim_trader_identities` is the correct place for per-game trader actors.
- It already supports both `npc` and `player` traders with an optional `userId`.
- This is the right abstraction for a trader in a specific game.
- However, `trd_charters` still points directly to `traderUserId` instead of a
  trader identity.
- That means part of the model treats the trader as a person, while another part
  treats the trader as a game actor.

Why this matters:

- A user may have at most one human trader identity per game, but trader-owned
  gameplay records should still belong to the trader actor, not the global user.
- A human trader and an NPC trader should share the same simulation-facing shape.
- Gameplay data should depend on per-game identity, not global identity.

Decision:

- `sim_trader_identities` should become the canonical trader actor table for
  both NPC and human traders.
- Trader gameplay tables should reference `traderIdentityId` rather than
  `userId`.

## Recommended target model

### A. Keep these layers separate

#### Global identity layer

- `users`
- `authAccounts`
- `authSessions`
- related auth tables

Responsibility:

- Who the person is in the system.
- How they log in.
- Provider-linked identity metadata.

#### Global app profile layer

- `usr_profiles`
- `usr_automation_profiles`
- `usr_empire_color_prefs`

Responsibility:

- Player-facing preferences and reusable assets.

#### Per-game participation layer

Recommended target:

- `game_memberships`
- `game_empire_assignments`
- `sim_trader_identities`

Responsibility:

- What this user is doing in this game.
- Which empire they control, if any.
- Which trader actor represents them, if any.

### B. Recommended target tables

#### 1. `game_memberships`

Purpose:

- One row per user per game.
- Represents that a user has joined a game at all.

Suggested fields:

- `gameId`
- `userId`
- `status` in `active | left | removed`
- `joinedAt`
- `leftAt` optional
- `isAdmin`
- `defaultView` in `observer | empire | trader`

Notes:

- This replaces the overloaded use of `usr_game_roles` as both membership and
  assignment.
- `isAdmin` should be a capability, not mutually exclusive with gameplay seat.

#### 2. `game_empire_assignments`

Purpose:

- Explicit mapping between a member and an empire seat.

Suggested fields:

- `gameId`
- `userId`
- `empireId`
- `status` in `active | resigned | eliminated`
- `joinedAt`
- `endedAt` optional

Notes:

- This removes the need for `empireId` to be nullable inside a generic role row.
- If the product later allows co-op empires, this table extends naturally.

#### 3. `sim_trader_identities`

Purpose:

- Canonical per-game trader actor for both NPC and human traders.

Keep:

- `gameId`
- `kind`
- `displayName`
- `affiliation`
- `state`
- `treasury`
- `userId` nullable

Add or tighten:

- index `by_gameId_and_userId`
- optional `membershipUserId` rename is not required if `userId` is documented as
  the owning human player for `kind = player`

Notes:

- This table is already close to the correct final model.

#### 4. Trader execution tables

Move these to trader-actor ownership:

- `trd_charters`
- `trd_runs`

Recommended changes:

- Replace `traderUserId` with `traderIdentityId`
- Optionally denormalize `userId` if needed for convenience queries, but do not
  use it as the canonical ownership key

Suggested `trd_charters` fields:

- `gameId`
- `issuerEmpireId`
- `traderIdentityId`
- `routeStartSystemId`
- `routeEndSystemId`
- `baseRate`
- `status`

Suggested `trd_runs` fields:

- `gameId`
- `charterId`
- `traderIdentityId`
- `turnNumber`
- `commodity`
- `unitsMoved`
- `payout`
- `success`

## Design decisions to lock in now

### Decision 1: Is one user allowed to be both empire player and trader in the same game?

This is the main branching decision.

#### If no

Then the current one-row-per-user-per-game assumption can stay for now.

Recommended action:

- Keep the current semantics.
- Rename `usr_game_roles` later to something more accurate such as
  `game_participants`.
- Keep `role` mutually exclusive.

#### If yes

Then `usr_game_roles` should be replaced with separate membership and assignment
tables.

Recommended action:

- Introduce `game_memberships`.
- Introduce `game_empire_assignments`.
- Treat `sim_trader_identities` as the trader assignment layer.
- Remove role exclusivity from participation.

Recommendation:

- For v2 traders, assume a user should be able to participate in one game as a
  trader without also needing to be an empire controller.
- If there is any chance that the same person may act as both admin and empire,
  or admin and trader, move toward membership plus assignment rather than a
  single role row.

### Decision 2: Which profile fields are canonical?

Recommendation:

- Canonical app display: `usr_profiles.displayName`
- Canonical app avatar: `usr_profiles.avatarUrl`
- Auth fallback only: `users.name`, `users.image`

### Decision 3: What is the canonical owner of trader gameplay records?

Recommendation:

- Canonical owner: `sim_trader_identities._id`
- Never `userId` alone

## Recommended implementation strategy

Use a phased Convex migration strategy.

### Phase 0: Clarify semantics in code

No breaking schema change yet.

Actions:

- Treat `usr_profiles` as canonical wherever player name or avatar is displayed.
- Add comments documenting that `usr_game_roles` is currently one active row per
  user per game.
- Add comments documenting that `sim_trader_identities` is the canonical trader
  actor abstraction.

### Phase 1: Widen the trader schema

Safe additive changes.

Actions:

- Add `traderIdentityId` as an optional field to `trd_charters`.
- Add `traderIdentityId` as an optional field to `trd_runs`.
- Add index `sim_trader_identities.by_gameId_and_userId`.
- Update write paths to populate `traderIdentityId` for new rows.
- Update read paths to handle both old and new rows.

Result:

- New data is written in the new shape.
- Old data still reads correctly.

### Phase 2: Backfill trader-owned rows

Online migration.

Actions:

- For each `trd_charters` row with `traderUserId` and no `traderIdentityId`:
  - find the `sim_trader_identities` row for the same `gameId` and `userId`
  - write `traderIdentityId`
- For each `trd_runs` row:
  - derive `traderIdentityId` from the linked charter
  - backfill the field

Verification:

- All active charters have `traderIdentityId`
- All runs have `traderIdentityId`

### Phase 3: Narrow the trader schema

Breaking cleanup after verification.

Actions:

- Make `traderIdentityId` required on `trd_charters`
- Make `traderIdentityId` required on `trd_runs`
- Remove `traderUserId` from `trd_charters`
- Remove any user-based trader ownership logic from code paths

### Phase 4: Rationalize participation tables

This is a product-dependent schema step.

#### Minimal path

If one active role per user per game remains valid:

- Keep `usr_game_roles`
- Rename later for clarity only if the churn is worth it

#### Full path

If multi-capability participation is needed:

- Introduce `game_memberships`
- Introduce `game_empire_assignments`
- Update authorization helpers to derive membership and assignment separately
- Backfill from `usr_game_roles`
- Remove `usr_game_roles` after migration and validation

### Phase 5: Profile cleanup

Optional cleanup after behavior is stable.

Actions:

- Audit all reads of `users.name` and `users.image`
- Switch UI-facing reads to `usr_profiles`
- Keep auth-provider fields in `users` as fallback only
- Do not remove `users.name` or `users.image`; they remain part of the auth
  package schema and are still useful as provider-derived metadata

## Recommended near-term schema changes

These are the changes I recommend doing first.

1. Keep `users`, `authAccounts`, and `usr_profiles` separate.
2. Make `usr_profiles` the canonical app-facing profile.
3. Add `sim_trader_identities.by_gameId_and_userId`.
4. Add `traderIdentityId` to `trd_charters` and `trd_runs`.
5. Update trader queries and mutations to resolve ownership through
   `traderIdentityId`.
6. Leave `usr_game_roles` alone until the product decides whether one user may
   hold multiple concurrent capabilities in the same game.

## Recommendation

The schema does not need a full ground-up redesign.

It does need targeted rationalization in three areas:

- declare `usr_profiles` as canonical app profile
- stop using `userId` as the canonical owner of trader gameplay rows
- make the participation model explicit instead of leaving `usr_game_roles`
  semantically ambiguous

That gives StarTrade a stable structure for:

- auth and account linking
- player-facing profile management
- empire gameplay
- human traders and NPC traders sharing the same simulation actor model
- future migration to richer participation semantics if the product needs them
