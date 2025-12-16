// Demo Mode Context Provider and Hook

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { getDemoSettings, saveDemoSettings, type DemoSettings, DEFAULT_DEMO_SETTINGS } from "../lib/demo/demoSettings";
import { connectDemoStore, disconnectDemoStore } from "../lib/demo/demoApi";

// Demo incident type matches the real incident structure
export interface DemoIncident {
  incident_id: string;
  alarm_name: string;
  alarm_arn: string;
  state: "triggered" | "acked" | "resolved";
  severity: "critical" | "warning" | "info";
  assigned_to: string;
  triggered_at: number;
  acked_at?: number;
  resolved_at?: number;
  timeline: DemoTimelineEntry[];
}

export interface DemoTimelineEntry {
  timestamp: number;
  event: string;
  actor: string;
  note?: string;
}

interface DemoState {
  isRunning: boolean;
  incidents: DemoIncident[];
  teammateAcked: string[]; // IDs acked by "teammate"
}

interface ToastMessage {
  id: string;
  message: string;
  type: "info" | "success" | "warning";
}

interface DemoModeContextType {
  // Settings
  settings: DemoSettings;
  isEnabled: boolean;

  // Demo state
  demoState: DemoState;
  isRunning: boolean;
  incidents: DemoIncident[];

  // Control functions
  setEnabled: (enabled: boolean) => void;
  startDemo: () => void;
  stopDemo: () => void;
  resetDemo: () => void;

  // Incident manipulation (for demo API mock)
  addIncident: (incident: DemoIncident) => void;
  ackIncident: (id: string, actor?: string) => void;
  unackIncident: (id: string) => void;
  resolveIncident: (id: string) => void;
  getIncident: (id: string) => DemoIncident | undefined;

  // Toast notifications
  toasts: ToastMessage[];
  showToast: (message: string, type?: ToastMessage["type"]) => void;
  dismissToast: (id: string) => void;
}

const DemoModeContext = createContext<DemoModeContextType | null>(null);

interface DemoModeProviderProps {
  children: ReactNode;
}

export function DemoModeProvider({ children }: DemoModeProviderProps) {
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_DEMO_SETTINGS);
  const [demoState, setDemoState] = useState<DemoState>({
    isRunning: false,
    incidents: [],
    teammateAcked: [],
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Load settings on mount
  useEffect(() => {
    setSettings(getDemoSettings());
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    const updated = { ...settings, enabled };
    setSettings(updated);
    saveDemoSettings(updated);

    // If disabling, also stop and reset demo
    if (!enabled) {
      setDemoState({
        isRunning: false,
        incidents: [],
        teammateAcked: [],
      });
    }
  }, [settings]);

  const startDemo = useCallback(() => {
    if (!settings.enabled) return;

    setDemoState((prev) => ({
      ...prev,
      isRunning: true,
    }));
  }, [settings.enabled]);

  const stopDemo = useCallback(() => {
    setDemoState((prev) => ({
      ...prev,
      isRunning: false,
    }));
  }, []);

  const resetDemo = useCallback(() => {
    setDemoState({
      isRunning: false,
      incidents: [],
      teammateAcked: [],
    });
  }, []);

  const addIncident = useCallback((incident: DemoIncident) => {
    setDemoState((prev) => {
      // Don't add if we already have 10 incidents
      if (prev.incidents.length >= 10) return prev;

      return {
        ...prev,
        incidents: [...prev.incidents, incident],
      };
    });
  }, []);

  const ackIncident = useCallback((id: string, actor?: string) => {
    setDemoState((prev) => {
      const incident = prev.incidents.find((i) => i.incident_id === id);
      if (!incident || incident.state !== "triggered") return prev;

      const now = Date.now();
      const isTeammate = actor && actor !== "You";

      return {
        ...prev,
        incidents: prev.incidents.map((i) =>
          i.incident_id === id
            ? {
                ...i,
                state: "acked" as const,
                acked_at: now,
                timeline: [
                  ...i.timeline,
                  {
                    timestamp: now,
                    event: "acknowledged",
                    actor: actor || "You",
                  },
                ],
              }
            : i
        ),
        teammateAcked: isTeammate ? [...prev.teammateAcked, id] : prev.teammateAcked,
      };
    });
  }, []);

  const unackIncident = useCallback((id: string) => {
    setDemoState((prev) => {
      const incident = prev.incidents.find((i) => i.incident_id === id);
      if (!incident || incident.state !== "acked") return prev;

      const now = Date.now();

      return {
        ...prev,
        incidents: prev.incidents.map((i) =>
          i.incident_id === id
            ? {
                ...i,
                state: "triggered" as const,
                acked_at: undefined,
                timeline: [
                  ...i.timeline,
                  {
                    timestamp: now,
                    event: "unacknowledged",
                    actor: "You",
                  },
                ],
              }
            : i
        ),
      };
    });
  }, []);

  const resolveIncident = useCallback((id: string) => {
    setDemoState((prev) => {
      const incident = prev.incidents.find((i) => i.incident_id === id);
      if (!incident) return prev;

      const now = Date.now();

      return {
        ...prev,
        incidents: prev.incidents.map((i) =>
          i.incident_id === id
            ? {
                ...i,
                state: "resolved" as const,
                resolved_at: now,
                timeline: [
                  ...i.timeline,
                  {
                    timestamp: now,
                    event: "resolved",
                    actor: "CloudWatch Auto-Resolve",
                  },
                ],
              }
            : i
        ),
      };
    });
  }, []);

  const getIncident = useCallback(
    (id: string) => demoState.incidents.find((i) => i.incident_id === id),
    [demoState.incidents]
  );

  // Sync demo store with context state for API mock layer
  useEffect(() => {
    if (settings.enabled) {
      connectDemoStore(demoState.incidents, ackIncident, unackIncident);
    }
    return () => {
      disconnectDemoStore();
    };
  }, [settings.enabled, demoState.incidents, ackIncident, unackIncident]);

  // Toast management
  const showToast = useCallback((message: string, type: ToastMessage["type"] = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value: DemoModeContextType = {
    settings,
    isEnabled: settings.enabled,
    demoState,
    isRunning: demoState.isRunning,
    incidents: demoState.incidents,
    setEnabled,
    startDemo,
    stopDemo,
    resetDemo,
    addIncident,
    ackIncident,
    unackIncident,
    resolveIncident,
    getIncident,
    toasts,
    showToast,
    dismissToast,
  };

  return <DemoModeContext.Provider value={value}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode(): DemoModeContextType {
  const context = useContext(DemoModeContext);
  if (!context) {
    throw new Error("useDemoMode must be used within a DemoModeProvider");
  }
  return context;
}

// Optional hook that doesn't throw - useful for checking demo mode outside provider
export function useDemoModeOptional(): DemoModeContextType | null {
  return useContext(DemoModeContext);
}
