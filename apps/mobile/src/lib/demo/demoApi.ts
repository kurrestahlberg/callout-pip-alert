// Demo API mock layer - intercepts API calls when demo mode is enabled

import type { DemoIncident } from "../../hooks/useDemoMode";

// Demo store - shared state between API mock and DemoModeContext
// The DemoModeProvider will sync its state here for API access
interface DemoStore {
  incidents: DemoIncident[];
  onAck: ((id: string, actor?: string) => void) | null;
  onUnack: ((id: string) => void) | null;
}

const demoStore: DemoStore = {
  incidents: [],
  onAck: null,
  onUnack: null,
};

/**
 * Connect the demo store to the DemoModeContext
 * Called by DemoModeProvider when it mounts/updates
 */
export function connectDemoStore(
  incidents: DemoIncident[],
  onAck: (id: string, actor?: string) => void,
  onUnack: (id: string) => void
): void {
  demoStore.incidents = incidents;
  demoStore.onAck = onAck;
  demoStore.onUnack = onUnack;
}

/**
 * Disconnect the demo store (cleanup)
 */
export function disconnectDemoStore(): void {
  demoStore.incidents = [];
  demoStore.onAck = null;
  demoStore.onUnack = null;
}

/**
 * Demo incidents API - mirrors the real incidentsApi interface
 */
export const demoIncidentsApi = {
  /**
   * List all demo incidents
   */
  list: async (_params?: { state?: string; team_id?: string }) => {
    // Simulate network delay
    await delay(100);

    // Filter by state if provided
    let incidents = [...demoStore.incidents];
    if (_params?.state) {
      incidents = incidents.filter((i) => i.state === _params.state);
    }

    // Sort by triggered_at descending (newest first)
    incidents.sort((a, b) => b.triggered_at - a.triggered_at);

    return { incidents };
  },

  /**
   * Get a single demo incident by ID
   */
  get: async (id: string) => {
    await delay(50);

    const incident = demoStore.incidents.find((i) => i.incident_id === id);
    if (!incident) {
      throw new Error("Incident not found");
    }

    return { incident };
  },

  /**
   * Acknowledge a demo incident
   */
  ack: async (id: string) => {
    await delay(50);

    if (demoStore.onAck) {
      demoStore.onAck(id, "You");
    }

    const incident = demoStore.incidents.find((i) => i.incident_id === id);
    return { incident };
  },

  /**
   * Unacknowledge a demo incident
   */
  unack: async (id: string) => {
    await delay(50);

    if (demoStore.onUnack) {
      demoStore.onUnack(id);
    }

    const incident = demoStore.incidents.find((i) => i.incident_id === id);
    return { incident };
  },

  /**
   * Resolve a demo incident (auto-resolve simulation)
   */
  resolve: async (id: string, _note?: string) => {
    await delay(50);
    // Resolution is handled by the demo sequence
    const incident = demoStore.incidents.find((i) => i.incident_id === id);
    return { incident };
  },

  /**
   * Reassign a demo incident
   */
  reassign: async (id: string, _userId: string) => {
    await delay(50);
    const incident = demoStore.incidents.find((i) => i.incident_id === id);
    return { incident };
  },
};

/**
 * Helper to simulate network delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
