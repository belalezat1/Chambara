import { createContext, useContext, type ReactNode } from "react";

import type { Screen, ScreenNavigationCommit } from "../types";

export interface ScreenNavigation {
  navigateToScreen: (
    target: Screen,
    onCommit?: ScreenNavigationCommit,
  ) => void;
}

const ScreenNavigationContext = createContext<ScreenNavigation | null>(null);

export function ScreenNavigationProvider({
  navigateToScreen,
  children,
}: ScreenNavigation & { children: ReactNode }) {
  return (
    <ScreenNavigationContext.Provider value={{ navigateToScreen }}>
      {children}
    </ScreenNavigationContext.Provider>
  );
}

export function useScreenNavigation(): ScreenNavigation {
  const navigation = useContext(ScreenNavigationContext);
  if (!navigation) {
    throw new Error("useScreenNavigation must be used within ScreenNavigationProvider");
  }
  return navigation;
}
