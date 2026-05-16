import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type PlayerTopNavControlSlot = "sound" | "panel";

type PlayerTopNavControlsState = Partial<Record<PlayerTopNavControlSlot, ReactNode>>;

type PlayerTopNavControlsContextValue = {
  controls: PlayerTopNavControlsState;
  setMobileControl: (slot: PlayerTopNavControlSlot, control: ReactNode | null) => void;
};

const PlayerTopNavControlsStateContext = createContext<PlayerTopNavControlsState | null>(null);
const PlayerTopNavControlsSetterContext = createContext<
  ((slot: PlayerTopNavControlSlot, control: ReactNode | null) => void) | null
>(null);

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
        if (current[slot] === control) {
          return current;
        }
        return { ...current, [slot]: control };
      });
    },
    [],
  );

  return (
    <PlayerTopNavControlsSetterContext.Provider value={setMobileControl}>
      <PlayerTopNavControlsStateContext.Provider value={controls}>
        {children}
      </PlayerTopNavControlsStateContext.Provider>
    </PlayerTopNavControlsSetterContext.Provider>
  );
}

export function usePlayerTopNavControls() {
  const controls = useContext(PlayerTopNavControlsStateContext);
  const setMobileControl = useContext(PlayerTopNavControlsSetterContext);
  if (controls === null || setMobileControl === null) {
    throw new Error("usePlayerTopNavControls must be used inside PlayerTopNavControlsProvider");
  }
  return { controls, setMobileControl } satisfies PlayerTopNavControlsContextValue;
}

export function useOptionalPlayerTopNavControls() {
  const controls = useContext(PlayerTopNavControlsStateContext);
  const setMobileControl = useContext(PlayerTopNavControlsSetterContext);
  if (controls === null || setMobileControl === null) {
    return null;
  }
  return { controls, setMobileControl } satisfies PlayerTopNavControlsContextValue;
}

export function usePlayerTopNavControlSetter() {
  const setMobileControl = useContext(PlayerTopNavControlsSetterContext);
  if (setMobileControl === null) {
    throw new Error("usePlayerTopNavControlSetter must be used inside PlayerTopNavControlsProvider");
  }
  return setMobileControl;
}

export function useOptionalPlayerTopNavControlSetter() {
  return useContext(PlayerTopNavControlsSetterContext);
}