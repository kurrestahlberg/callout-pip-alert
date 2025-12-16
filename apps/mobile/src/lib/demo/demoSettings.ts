// Demo mode settings persistence

const DEMO_SETTINGS_KEY = "riffboy-demo-settings";

export interface DemoSettings {
  enabled: boolean;
}

export const DEFAULT_DEMO_SETTINGS: DemoSettings = {
  enabled: false,
};

export function getDemoSettings(): DemoSettings {
  try {
    const stored = localStorage.getItem(DEMO_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_DEMO_SETTINGS,
        ...parsed,
      };
    }
    return DEFAULT_DEMO_SETTINGS;
  } catch {
    return DEFAULT_DEMO_SETTINGS;
  }
}

export function saveDemoSettings(settings: DemoSettings): void {
  try {
    localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("[Demo] Failed to save demo settings:", e);
  }
}

export function isDemoMode(): boolean {
  return getDemoSettings().enabled;
}

export function setDemoMode(enabled: boolean): void {
  saveDemoSettings({ ...getDemoSettings(), enabled });
}
