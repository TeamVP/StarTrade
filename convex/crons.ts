import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { DEFAULT_TURN_DURATION_SECONDS } from "./sim/turnTiming";

const crons = cronJobs();

crons.interval(
  "advance running StarStrat games",
  { seconds: DEFAULT_TURN_DURATION_SECONDS },
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
