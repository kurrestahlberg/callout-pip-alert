import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type Page = "incidents" | "schedule" | "team" | "settings" | "login" | "incident-detail";

interface NavigationState {
  currentPage: Page;
  incidentId: string | null;
  previousPage: Page | null;
}

interface NavigationContextType {
  state: NavigationState;
  navigate: (page: Page, params?: { incidentId?: string }) => void;
  goBack: () => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavigationState>({
    currentPage: "incidents",
    incidentId: null,
    previousPage: null,
  });

  const navigate = useCallback((page: Page, params?: { incidentId?: string }) => {
    setState((prev) => ({
      currentPage: page,
      incidentId: params?.incidentId ?? null,
      previousPage: prev.currentPage,
    }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({
      currentPage: prev.previousPage ?? "incidents",
      incidentId: null,
      previousPage: null,
    }));
  }, []);

  return (
    <NavigationContext.Provider value={{ state, navigate, goBack }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return context;
}
