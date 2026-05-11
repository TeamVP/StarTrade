/* eslint-disable react-refresh/only-export-components -- provider + context module */
import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Id } from "../../../../convex/_generated/dataModel";

const STORAGE_KEY = "startrade:activeGameId";

export type ActiveGameContextValue = {
  selectedGameId: Id<"sim_games"> | null;
  setSelectedGameId: (id: Id<"sim_games"> | null) => void;
};

export const ActiveGameContext = createContext<ActiveGameContextValue | null>(null);

function readStoredGameId(): Id<"sim_games"> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null && raw.length > 0) {
      return raw as Id<"sim_games">;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function ActiveGameProvider({ children }: { children: ReactNode }) {
  const [selectedGameId, setSelectedGameIdState] = useState<Id<"sim_games"> | null>(
    readStoredGameId,
  );

  const setSelectedGameId = useCallback((id: Id<"sim_games"> | null) => {
    setSelectedGameIdState(id);
    try {
      if (id === null) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    (): ActiveGameContextValue => ({ selectedGameId, setSelectedGameId }),
    [selectedGameId, setSelectedGameId],
  );

  return <ActiveGameContext.Provider value={value}>{children}</ActiveGameContext.Provider>;
}
