import type { Doc } from "../_generated/dataModel";

export const STAGED_SIM_TABLES = [
  "cmb_battles",
  "col_colony_ships",
  "eco_bg_traders",
  "eco_market_snapshots",
  "eco_system_outputs",
  "emp_states",
  "emp_system_holdings",
  "flt_fleets",
  "flt_garrison_routes",
  "flt_orders",
  "gal_systems",
  "sim_events",
  "sim_game_settings",
  "sim_trader_identities",
] as const;

export type StagedSimTableName = (typeof STAGED_SIM_TABLES)[number];

export type StagedRowSnapshot = {
  tableName: StagedSimTableName;
  rowId: string;
  docJson: string;
};

export type StageInsertOperation = {
  opType: "insert";
  tableName: StagedSimTableName;
  targetId: string;
  payloadJson: string;
};

export type StagePatchOperation = {
  opType: "patch";
  tableName: StagedSimTableName;
  targetId: string;
  payloadJson: string;
};

export type StageDeleteOperation = {
  opType: "delete";
  tableName: StagedSimTableName;
  targetId: string;
};

export type StageOperation =
  | StageInsertOperation
  | StagePatchOperation
  | StageDeleteOperation;

const VIRTUAL_STAGE_ID_PREFIX = "staged:";

export function createVirtualStageId(
  tableName: StagedSimTableName,
  ordinal: number,
): string {
  return `${VIRTUAL_STAGE_ID_PREFIX}${tableName}:${ordinal}`;
}

export function isVirtualStageId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(VIRTUAL_STAGE_ID_PREFIX);
}

export function isStagedSimTableName(value: string): value is StagedSimTableName {
  return (STAGED_SIM_TABLES as readonly string[]).includes(value);
}

export function serializeStageOperation(op: StageOperation): {
  tableName: string;
  opType: StageOperation["opType"];
  targetId?: string;
  payloadJson?: string;
} {
  if (op.opType === "delete") {
    return {
      tableName: op.tableName,
      opType: op.opType,
      targetId: op.targetId,
    };
  }
  return {
    tableName: op.tableName,
    opType: op.opType,
    targetId: op.targetId,
    payloadJson: op.payloadJson,
  };
}

export function deserializeStageOperation(row: Doc<"sim_turn_preparation_ops">): StageOperation {
  if (!isStagedSimTableName(row.tableName)) {
    throw new Error(`Unknown staged sim table ${row.tableName}.`);
  }
  if (row.opType === "delete") {
    if (row.targetId === undefined) {
      throw new Error("Delete stage operation missing target id.");
    }
    return {
      opType: "delete",
      tableName: row.tableName,
      targetId: row.targetId,
    };
  }
  if (row.targetId === undefined || row.payloadJson === undefined) {
    throw new Error(`Stage operation ${row.opType} missing payload.`);
  }
  return {
    opType: row.opType,
    tableName: row.tableName,
    targetId: row.targetId,
    payloadJson: row.payloadJson,
  };
}