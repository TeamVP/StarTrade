import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  createVirtualStageId,
  deserializeStageOperation,
  isVirtualStageId,
  serializeStageOperation,
  STAGED_SIM_TABLES,
  type StageOperation,
  type StagedSimTableName,
} from "./preparationOps";

type AnyStageDoc = Doc<StagedSimTableName>;

type StagePatchPayload = {
  set: Record<string, unknown>;
  unset: string[];
};

type StageSnapshot = Record<StagedSimTableName, Map<string, AnyStageDoc>>;

type StageIndexFilter = {
  field: string;
  value: unknown;
};

const STAGED_INSERT_ONLY_TABLES = new Set<StagedSimTableName>([
  "eco_market_snapshots",
  "eco_system_outputs",
  "sim_events",
]);

const STAGED_INSERT_APPLY_ORDER: readonly StagedSimTableName[] = [
  "sim_game_settings",
  "sim_trader_identities",
  "flt_fleets",
  "col_colony_ships",
  "cmb_battles",
  "flt_garrison_routes",
  "eco_bg_traders",
  "emp_states",
  "emp_system_holdings",
  "gal_systems",
  "eco_system_outputs",
  "eco_market_snapshots",
  "flt_orders",
  "sim_events",
];

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function sortStageDocs(rows: AnyStageDoc[]): AnyStageDoc[] {
  return [...rows].sort((a, b) => {
    if (a._creationTime !== b._creationTime) {
      return a._creationTime - b._creationTime;
    }
    return String(a._id).localeCompare(String(b._id));
  });
}

function emptyStageSnapshot(): StageSnapshot {
  return Object.fromEntries(
    STAGED_SIM_TABLES.map((tableName) => [tableName, new Map<string, AnyStageDoc>()]),
  ) as StageSnapshot;
}

function stripSystemFields(doc: AnyStageDoc): Record<string, unknown> {
  const clone = cloneValue(doc) as Record<string, unknown>;
  delete clone._id;
  delete clone._creationTime;
  return clone;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyPatchToDoc(
  current: AnyStageDoc,
  patch: Record<string, unknown>,
): AnyStageDoc {
  const next = cloneValue(current) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = cloneValue(value);
    }
  }
  return next as AnyStageDoc;
}

function buildPatchPayload(
  original: AnyStageDoc,
  current: AnyStageDoc,
): StagePatchPayload | null {
  const originalData = stripSystemFields(original);
  const currentData = stripSystemFields(current);
  const fields = new Set([...Object.keys(originalData), ...Object.keys(currentData)]);
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const field of fields) {
    const hasOriginal = Object.prototype.hasOwnProperty.call(originalData, field);
    const hasCurrent = Object.prototype.hasOwnProperty.call(currentData, field);
    if (!hasCurrent && hasOriginal) {
      unset.push(field);
      continue;
    }
    if (!hasCurrent) {
      continue;
    }
    const originalValue = hasOriginal ? (originalData as Record<string, unknown>)[field] : undefined;
    const currentValue = (currentData as Record<string, unknown>)[field];
    if (!hasOriginal || !valuesEqual(originalValue, currentValue)) {
      set[field] = cloneValue(currentValue);
    }
  }

  if (unset.length === 0 && Object.keys(set).length === 0) {
    return null;
  }
  return { set, unset };
}

class StageIndexBuilder {
  readonly filters: StageIndexFilter[] = [];

  eq(field: string, value: unknown): StageIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class StageQuery {
  private filters: StageIndexFilter[] = [];
  private direction: "asc" | "desc" = "asc";

  constructor(private readonly readRows: () => AnyStageDoc[]) {}

  withIndex(_indexName: string, apply: (q: StageIndexBuilder) => StageIndexBuilder): StageQuery {
    const builder = new StageIndexBuilder();
    apply(builder);
    this.filters = builder.filters;
    return this;
  }

  order(direction: "asc" | "desc"): StageQuery {
    this.direction = direction;
    return this;
  }

  async collect(): Promise<AnyStageDoc[]> {
    return this.materialize();
  }

  async take(count: number): Promise<AnyStageDoc[]> {
    return (await this.materialize()).slice(0, count);
  }

  async unique(): Promise<AnyStageDoc | null> {
    const rows = await this.materialize();
    if (rows.length === 0) {
      return null;
    }
    if (rows.length > 1) {
      throw new Error("Stage query expected a unique row but found multiple results.");
    }
    return rows[0];
  }

  private async materialize(): Promise<AnyStageDoc[]> {
    let rows = sortStageDocs(this.readRows()).map((row) => cloneValue(row));
    for (const filter of this.filters) {
      rows = rows.filter((row) => valuesEqual((row as Record<string, unknown>)[filter.field], filter.value));
    }
    if (this.direction === "desc") {
      rows.reverse();
    }
    return rows;
  }
}

async function loadTableRows(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  turnNumber: number,
  tableName: StagedSimTableName,
): Promise<AnyStageDoc[]> {
  if (STAGED_INSERT_ONLY_TABLES.has(tableName)) {
    return [];
  }

  switch (tableName) {
    case "eco_bg_traders": {
      const [enRoute, delivered, cancelled] = await Promise.all([
        ctx.db
          .query("eco_bg_traders")
          .withIndex("by_gameId_and_status", (q) =>
            q.eq("gameId", gameId).eq("status", "enRoute"),
          )
          .take(2048),
        ctx.db
          .query("eco_bg_traders")
          .withIndex("by_gameId_and_status", (q) =>
            q.eq("gameId", gameId).eq("status", "delivered"),
          )
          .take(2048),
        ctx.db
          .query("eco_bg_traders")
          .withIndex("by_gameId_and_status", (q) =>
            q.eq("gameId", gameId).eq("status", "cancelled"),
          )
          .take(2048),
      ]);
      return [...enRoute, ...delivered, ...cancelled] as AnyStageDoc[];
    }
    case "flt_orders":
      return (await ctx.db
        .query("flt_orders")
        .withIndex("by_gameId_and_turnNumber", (q) =>
          q.eq("gameId", gameId).eq("turnNumber", turnNumber),
        )
        .take(2048)) as AnyStageDoc[];
    case "sim_game_settings": {
      const row = await ctx.db
        .query("sim_game_settings")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .unique();
      return row === null ? [] : [row as AnyStageDoc];
    }
    default:
      return (await (ctx.db as any)
        .query(tableName)
        .withIndex("by_gameId", (q: any) => q.eq("gameId", gameId))
        .collect()) as AnyStageDoc[];
  }
}

function translateVirtualIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") {
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => translateVirtualIds(entry, idMap));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = translateVirtualIds(child, idMap);
    }
    return result;
  }
  return value;
}

function insertOrderIndex(tableName: StagedSimTableName): number {
  const index = STAGED_INSERT_APPLY_ORDER.indexOf(tableName);
  return index === -1 ? STAGED_INSERT_APPLY_ORDER.length : index;
}

export async function createStagedTurnContext(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; turnNumber: number },
): Promise<{
  ctx: MutationCtx;
  buildOperations: () => StageOperation[];
}> {
  const original = emptyStageSnapshot();
  for (const tableName of STAGED_SIM_TABLES) {
    const rows = await loadTableRows(ctx, params.gameId, params.turnNumber, tableName);
    for (const row of rows) {
      original[tableName].set(String(row._id), cloneValue(row));
    }
  }

  const current = emptyStageSnapshot();
  for (const tableName of STAGED_SIM_TABLES) {
    for (const [rowId, row] of original[tableName]) {
      current[tableName].set(rowId, cloneValue(row));
    }
  }

  let nextInsertOrdinal = 1;
  let nextCreationTime = Date.now();

  const stageDb = {
    ...(ctx.db as any),
    get: async (tableName: string, rowId: string) => {
      if ((STAGED_SIM_TABLES as readonly string[]).includes(tableName)) {
        const row = current[tableName as StagedSimTableName].get(String(rowId));
        return row === undefined ? null : cloneValue(row);
      }
      return await (ctx.db as any).get(tableName, rowId);
    },
    query: (tableName: string) => {
      if ((STAGED_SIM_TABLES as readonly string[]).includes(tableName)) {
        const stagedTable = tableName as StagedSimTableName;
        return new StageQuery(() => Array.from(current[stagedTable].values()));
      }
      return (ctx.db as any).query(tableName);
    },
    insert: async (tableName: string, value: Record<string, unknown>) => {
      if (!(STAGED_SIM_TABLES as readonly string[]).includes(tableName)) {
        throw new Error(`Stage write attempted against unstaged table ${tableName}.`);
      }
      const stagedTable = tableName as StagedSimTableName;
      const rowId = createVirtualStageId(stagedTable, nextInsertOrdinal++);
      current[stagedTable].set(rowId, {
        ...(cloneValue(value) as Record<string, unknown>),
        _id: rowId,
        _creationTime: ++nextCreationTime,
      } as AnyStageDoc);
      return rowId;
    },
    patch: async (tableName: string, rowId: string, value: Record<string, unknown>) => {
      if (!(STAGED_SIM_TABLES as readonly string[]).includes(tableName)) {
        throw new Error(`Stage write attempted against unstaged table ${tableName}.`);
      }
      const stagedTable = tableName as StagedSimTableName;
      const existing = current[stagedTable].get(String(rowId));
      if (existing === undefined) {
        throw new Error(`Stage patch target ${tableName}:${rowId} not found.`);
      }
      current[stagedTable].set(String(rowId), applyPatchToDoc(existing, value));
    },
    delete: async (tableName: string, rowId: string) => {
      if (!(STAGED_SIM_TABLES as readonly string[]).includes(tableName)) {
        throw new Error(`Stage write attempted against unstaged table ${tableName}.`);
      }
      current[tableName as StagedSimTableName].delete(String(rowId));
    },
  };

  const buildOperations = (): StageOperation[] => {
    const ops: StageOperation[] = [];
    for (const tableName of STAGED_SIM_TABLES) {
      const originalRows = original[tableName];
      const currentRows = current[tableName];

      for (const [rowId, originalRow] of sortStageDocs(Array.from(originalRows.values())).map((row) => [String(row._id), row] as const)) {
        if (!currentRows.has(rowId)) {
          ops.push({
            opType: "delete",
            tableName,
            targetId: String(originalRow._id),
          });
        }
      }

      for (const currentRow of sortStageDocs(Array.from(currentRows.values()))) {
        const rowId = String(currentRow._id);
        if (isVirtualStageId(rowId)) {
          ops.push({
            opType: "insert",
            tableName,
            targetId: rowId,
            payloadJson: JSON.stringify(stripSystemFields(currentRow)),
          });
          continue;
        }
        const originalRow = originalRows.get(rowId);
        if (originalRow === undefined) {
          continue;
        }
        const patchPayload = buildPatchPayload(originalRow, currentRow);
        if (patchPayload !== null) {
          ops.push({
            opType: "patch",
            tableName,
            targetId: rowId,
            payloadJson: JSON.stringify(patchPayload),
          });
        }
      }
    }
    return ops;
  };

  return { ctx: { ...ctx, db: stageDb } as unknown as MutationCtx, buildOperations };
}

export async function replacePreparationOperations(
  ctx: MutationCtx,
  params: {
    preparationId: Id<"sim_turn_preparations">;
    gameId: Id<"sim_games">;
    turnNumber: number;
    operations: StageOperation[];
  },
): Promise<void> {
  const existing = await ctx.db
    .query("sim_turn_preparation_ops")
    .withIndex("by_preparationId_and_opOrder", (q) => q.eq("preparationId", params.preparationId))
    .collect();
  for (const row of existing) {
    await ctx.db.delete("sim_turn_preparation_ops", row._id);
  }
  for (let index = 0; index < params.operations.length; index += 1) {
    const op = serializeStageOperation(params.operations[index]);
    await ctx.db.insert("sim_turn_preparation_ops", {
      preparationId: params.preparationId,
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      opOrder: index,
      tableName: op.tableName,
      opType: op.opType,
      targetId: op.targetId,
      payloadJson: op.payloadJson,
    });
  }
}

export async function loadPreparationOperations(
  ctx: MutationCtx,
  preparationId: Id<"sim_turn_preparations">,
): Promise<StageOperation[]> {
  const rows = await ctx.db
    .query("sim_turn_preparation_ops")
    .withIndex("by_preparationId_and_opOrder", (q) => q.eq("preparationId", preparationId))
    .collect();
  rows.sort((a, b) => a.opOrder - b.opOrder);
  return rows.map((row) => deserializeStageOperation(row));
}

export async function applyPreparationOperations(
  ctx: MutationCtx,
  preparationId: Id<"sim_turn_preparations">,
): Promise<{ applied: number }> {
  const operations = await loadPreparationOperations(ctx, preparationId);
  const idMap = new Map<string, string>();

  const insertOps = operations
    .filter((op): op is Extract<StageOperation, { opType: "insert" }> => op.opType === "insert")
    .sort((left, right) => {
      const tableOrder = insertOrderIndex(left.tableName) - insertOrderIndex(right.tableName);
      if (tableOrder !== 0) {
        return tableOrder;
      }
      return left.targetId.localeCompare(right.targetId);
    });

  for (const op of insertOps) {
    const payload = translateVirtualIds(JSON.parse(op.payloadJson), idMap) as Record<string, unknown>;
    const insertedId = await (ctx.db as any).insert(op.tableName, payload);
    idMap.set(op.targetId, String(insertedId));
  }

  for (const op of operations) {
    if (op.opType === "insert") {
      continue;
    }
    const targetId = idMap.get(op.targetId) ?? op.targetId;
    if (op.opType === "patch") {
      const patchPayload = JSON.parse(op.payloadJson) as StagePatchPayload;
      const patch: Record<string, unknown> = translateVirtualIds(patchPayload.set, idMap) as Record<string, unknown>;
      for (const field of patchPayload.unset) {
        patch[field] = undefined;
      }
      await (ctx.db as any).patch(op.tableName, targetId, patch);
      continue;
    }
    if (isVirtualStageId(targetId)) {
      continue;
    }
    await (ctx.db as any).delete(op.tableName, targetId);
  }

  return { applied: operations.length };
}