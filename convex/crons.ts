import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { TURN_RECOVERY_SWEEP_INTERVAL_SECONDS } from "./sim/turnTiming";

const crons = cronJobs();

crons.interval(
  "recover overdue StarStrat games",
  { seconds: TURN_RECOVERY_SWEEP_INTERVAL_SECONDS },
  internal.sim.cron.tickRunningGames,
  {},
);

crons.interval(
  "sweep inactive StarStrat games",
  { minutes: 60 },
  internal.sim.cron.sweepInactiveGames,
  {},
);

crons.interval(
  "backfill StarStrat metadata",
  { minutes: 15 },
  internal.admin.internal.runMetadataBackfillSweep,
  {},
);

export default crons;
