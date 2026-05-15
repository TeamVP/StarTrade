/* eslint-disable react-refresh/only-export-components -- provider + context module */
import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Id } from "../../../../convex/_generated/dataModel";

const DEFAULT_STORAGE_KEY = "starstrat:activeGameId";

export type ActiveGameContextValue = {
  selectedGameId: Id<"sim_games"> | null;
  setSelectedGameId: (id: Id<"sim_games"> | null) => void;
};

export const ActiveGameContext = createContext<ActiveGameContextValue | null>(null);

function readStoredGameId(storageKey: string): Id<"sim_games"> | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw !== null && raw.length > 0) {
      return raw as Id<"sim_games">;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function ActiveGameProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY,
  initialSelectedGameId = null,
}: {
  children: ReactNode;
  storageKey?: string;
  initialSelectedGameId?: Id<"sim_games"> | null;
}) {
  const [selectedGameId, setSelectedGameIdState] = useState<Id<"sim_games"> | null>(
    () => initialSelectedGameId ?? readStoredGameId(storageKey),
  );

  const setSelectedGameId = useCallback((id: Id<"sim_games"> | null) => {
    setSelectedGameIdState(id);
    try {
      if (id === null) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, id);
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const value = useMemo(
    (): ActiveGameContextValue => ({ selectedGameId, setSelectedGameId }),
    [selectedGameId, setSelectedGameId],
  );

  return <ActiveGameContext.Provider value={value}>{children}</ActiveGameContext.Provider>;
}
