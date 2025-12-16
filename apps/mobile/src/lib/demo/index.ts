// Demo mode exports

export {
  type DemoSettings,
  DEFAULT_DEMO_SETTINGS,
  getDemoSettings,
  saveDemoSettings,
  isDemoMode,
  setDemoMode,
} from "./demoSettings";

export {
  generateDemoIncident,
  generateDemoIncidentBatch,
  addTimelineEntry,
  getRandomTeammate,
  isDemoIncidentId,
  resetDemoCounter,
  DEMO_TEAMMATES,
} from "./demoData";

export {
  connectDemoStore,
  disconnectDemoStore,
  demoIncidentsApi,
} from "./demoApi";

export {
  startDemoSequence,
  stopDemoSequence,
  isDemoSequenceRunning,
  type DemoSequenceCallbacks,
} from "./demoSequence";
