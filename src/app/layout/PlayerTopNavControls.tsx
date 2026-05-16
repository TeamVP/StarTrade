import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type PlayerTopNavControlSlot = "sound" | "panel";

type PlayerTopNavControlsState = Partial<Record<PlayerTopNavControlSlot, ReactNode>>;

type PlayerTopNavControlsContextValue = {
  controls: PlayerTopNavControlsState;
  setMobileControl: (slot: PlayerTopNavControlSlot, control: ReactNode | null) => void;
};

const PlayerTopNavControlsContext = createContext<PlayerTopNavControlsContextValue | null>(null);

export function PlayerTopNavControlsProvider({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<PlayerTopNavControlsState>({});

  const setMobileControl = useCallback(
    (slot: PlayerTopNavControlSlot, control: ReactNode | null) => {
      setControls((current) => {
        if (control === null) {
          if (!(slot in current)) {
            return current;
          }
          const next = { ...current };
          delete next[slot];
          return next;
        }
        return { ...current, [slot]: control };
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ controls, setMobileControl }),
    [controls, setMobileControl],
  );

  return (
    <PlayerTopNavControlsContext.Provider value={value}>
      {children}
    </PlayerTopNavControlsContext.Provider>
  );
}

export function usePlayerTopNavControls() {
  const value = useContext(PlayerTopNavControlsContext);
  if (value === null) {
    throw new Error("usePlayerTopNavControls must be used inside PlayerTopNavControlsProvider");
  }
  return value;
}

export function useOptionalPlayerTopNavControls() {
  return useContext(PlayerTopNavControlsContext);
}