// Demo sequence orchestration - creates the escalating alert scenario

import type { DemoIncident } from "../../hooks/useDemoMode";
import { generateDemoIncident, getRandomTeammate } from "./demoData";

export interface DemoSequenceCallbacks {
  addIncident: (incident: DemoIncident) => void;
  ackIncident: (id: string, actor: string) => void;
  showToast: (message: string, type?: "info" | "success" | "warning") => void;
  playAlert: (severity: "critical" | "warning" | "info") => void;
  onComplete: () => void;
  getIncidents: () => DemoIncident[];
}

interface SequenceState {
  isRunning: boolean;
  timeouts: ReturnType<typeof setTimeout>[];
  checkInterval: ReturnType<typeof setInterval> | null;
}

let sequenceState: SequenceState = {
  isRunning: false,
  timeouts: [],
  checkInterval: null,
};

/**
 * Clear all pending timeouts and intervals
 */
function clearAllTimers(): void {
  sequenceState.timeouts.forEach((t) => clearTimeout(t));
  sequenceState.timeouts = [];
  if (sequenceState.checkInterval) {
    clearInterval(sequenceState.checkInterval);
    sequenceState.checkInterval = null;
  }
}

/**
 * Schedule a function to run after a delay
 */
function scheduleAction(fn: () => void, delayMs: number): void {
  const timeout = setTimeout(fn, delayMs);
  sequenceState.timeouts.push(timeout);
}

/**
 * Start the demo sequence
 *
 * Timeline:
 * 0s    - Demo starts
 * 0.5s  - Warning #1 appears
 * 2s    - Warning #2 appears
 * 4s    - Critical #1 appears (Geiger starts)
 * 5.5s  - Critical #2 appears (Geiger intensifies)
 * 7s    - Critical #3 appears (Geiger high)
 * 10s   - "Teammate" acks Critical #1
 * 12s   - "Teammate" acks Warning #1
 * 15s   - More incidents if < 10 total
 * ...   - User can ack remaining
 * End   - All acked = demo complete
 */
export function startDemoSequence(callbacks: DemoSequenceCallbacks): void {
  if (sequenceState.isRunning) {
    console.log("[Demo] Sequence already running");
    return;
  }

  console.log("[Demo] Starting demo sequence");
  sequenceState.isRunning = true;

  const { addIncident, ackIncident, showToast, playAlert, onComplete, getIncidents } = callbacks;

  // Track created incidents for teammate ack references
  const createdIncidents: DemoIncident[] = [];

  // Helper to add incident and track it
  const addAndTrack = (severity: "critical" | "warning" | "info"): DemoIncident => {
    const incident = generateDemoIncident(severity);
    createdIncidents.push(incident);
    addIncident(incident);
    return incident;
  };

  // Phase 1: Initial warnings (0.5s, 2s)
  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    addAndTrack("warning");
    playAlert("warning");
  }, 500);

  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    addAndTrack("warning");
    playAlert("warning");
  }, 2000);

  // Phase 2: Critical alarms (4s, 5.5s, 7s)
  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    addAndTrack("critical");
    playAlert("critical");
  }, 4000);

  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    addAndTrack("critical");
    playAlert("critical");
  }, 5500);

  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    addAndTrack("critical");
    playAlert("critical");
  }, 7000);

  // Phase 3: Teammate acks (10s, 12s)
  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    // Find first triggered critical
    const criticals = createdIncidents.filter(
      (i) => i.severity === "critical" && getIncidents().find((x) => x.incident_id === i.incident_id)?.state === "triggered"
    );
    if (criticals.length > 0) {
      const teammate = getRandomTeammate();
      const incident = criticals[0];
      ackIncident(incident.incident_id, teammate);
      showToast(`${teammate} acknowledged ${incident.alarm_name}`, "success");
    }
  }, 10000);

  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    // Find first triggered warning
    const warnings = createdIncidents.filter(
      (i) => i.severity === "warning" && getIncidents().find((x) => x.incident_id === i.incident_id)?.state === "triggered"
    );
    if (warnings.length > 0) {
      const teammate = getRandomTeammate();
      const incident = warnings[0];
      ackIncident(incident.incident_id, teammate);
      showToast(`${teammate} acknowledged ${incident.alarm_name}`, "success");
    }
  }, 12000);

  // Phase 4: More incidents to fill up to 8-9 (15s, 18s, 21s)
  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    if (getIncidents().length < 8) {
      addAndTrack(Math.random() < 0.5 ? "critical" : "warning");
      playAlert("warning");
    }
  }, 15000);

  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    if (getIncidents().length < 9) {
      addAndTrack("warning");
      playAlert("warning");
    }
  }, 18000);

  scheduleAction(() => {
    if (!sequenceState.isRunning) return;
    if (getIncidents().length < 10) {
      addAndTrack("info");
      playAlert("info");
    }
  }, 21000);

  // Phase 5: Check for completion every 2 seconds
  sequenceState.checkInterval = setInterval(() => {
    if (!sequenceState.isRunning) {
      clearAllTimers();
      return;
    }

    const incidents = getIncidents();
    const unacked = incidents.filter((i) => i.state === "triggered");

    // Demo complete when all incidents are acked or resolved
    if (incidents.length > 0 && unacked.length === 0) {
      console.log("[Demo] All incidents handled - demo complete!");
      showToast("DEMO COMPLETE - All alerts acknowledged!", "success");
      stopDemoSequence();
      onComplete();
    }
  }, 2000);
}

/**
 * Stop the demo sequence (doesn't reset data)
 */
export function stopDemoSequence(): void {
  console.log("[Demo] Stopping demo sequence");
  sequenceState.isRunning = false;
  clearAllTimers();
}

/**
 * Check if demo sequence is currently running
 */
export function isDemoSequenceRunning(): boolean {
  return sequenceState.isRunning;
}
