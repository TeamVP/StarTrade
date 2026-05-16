import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { TURN_RESOLUTION_POLL_INTERVAL_SECONDS } from "./sim/turnTiming";

const crons = cronJobs();

crons.interval(
  "advance running StarStrat games",
  { seconds: TURN_RESOLUTION_POLL_INTERVAL_SECONDS },
  internal.sim.cron.tickRunningGames,
  {},
);

crons.interval(
  "sweep inactive StarStrat games",
  { minutes: 60 },
  internal.sim.cron.sweepInactiveGames,
  {},
);

export default crons;
