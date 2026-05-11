import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "advance running StarTrade games",
  { seconds: 15 },
  internal.sim.cron.tickRunningGames,
  {},
);

export default crons;
