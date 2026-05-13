/* eslint-disable react-refresh/only-export-components -- provider + hooks in one module */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Id } from "../../../../convex/_generated/dataModel";

type FocusHandler = (empireId: Id<"emp_states">) => void;

export type GalaxyMapNavContextValue = {
  requestEmpireHomeworldFocus: FocusHandler;
  setEmpireHomeworldFocusHandler: (handler: FocusHandler | null) => void;
};

const GalaxyMapNavContext = createContext<GalaxyMapNavContextValue | null>(null);

export function GalaxyMapNavProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<FocusHandler | null>(null);

  const setEmpireHomeworldFocusHandler = useCallback((handler: FocusHandler | null) => {
    handlerRef.current = handler;
  }, []);

  const requestEmpireHomeworldFocus = useCallback((empireId: Id<"emp_states">) => {
    handlerRef.current?.(empireId);
  }, []);

  const value = useMemo(
    () => ({ requestEmpireHomeworldFocus, setEmpireHomeworldFocusHandler }),
    [requestEmpireHomeworldFocus, setEmpireHomeworldFocusHandler],
  );

  return <GalaxyMapNavContext.Provider value={value}>{children}</GalaxyMapNavContext.Provider>;
}

export function useGalaxyMapNav(): GalaxyMapNavContextValue | null {
  return useContext(GalaxyMapNavContext);
}
