import { useEffect, useMemo, useState } from "react";
import {
  estimateServerClockOffsetMs,
  getServerAlignedNowMs,
  getTurnEffectiveNowMs,
} from "./turnClock";

type TurnClockStatus = "lobby" | "running" | "paused" | "finished" | null | undefined;

export function useTurnClock(params: {
  gameStatus: TurnClockStatus;
  turnPausedAtMs?: number | null;
  serverNowMs?: number | null;
  tickMs?: number;
}) {
  const { gameStatus, turnPausedAtMs, serverNowMs, tickMs = 250 } = params;
  const [clientNowMs, setClientNowMs] = useState(() => Date.now());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);

  useEffect(() => {
    if (serverNowMs === undefined || serverNowMs === null) return;
    const receivedAtMs = Date.now();
    setClientNowMs(receivedAtMs);
    setServerClockOffsetMs(
      estimateServerClockOffsetMs({
        serverNowMs,
        clientReceivedAtMs: receivedAtMs,
      }),
    );
  }, [serverNowMs]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setClientNowMs(Date.now());
    }, Math.max(16, tickMs));
    return () => window.clearInterval(id);
  }, [tickMs]);

  const alignedNowMs = useMemo(
    () => getServerAlignedNowMs({ clientNowMs, serverClockOffsetMs }),
    [clientNowMs, serverClockOffsetMs],
  );

  const effectiveNowMs = useMemo(
    () =>
      getTurnEffectiveNowMs({
        nowMs: alignedNowMs,
        gameStatus,
        turnPausedAtMs,
      }),
    [alignedNowMs, gameStatus, turnPausedAtMs],
  );

  return {
    clientNowMs,
    alignedNowMs,
    effectiveNowMs,
    serverClockOffsetMs,
  };
}