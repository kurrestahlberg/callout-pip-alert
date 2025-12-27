import { useState, useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";
import { useNavigation } from "../lib/navigation";
import { useAudio } from "../hooks/useAudio";
import { useDemoMode } from "../hooks/useDemoMode";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { startDemoSequence, stopDemoSequence, resetDemoCounter } from "../lib/demo";
import { cloudDemoApi, devicesApi, gameApi } from "../lib/api";
import {
  CloudBackend,
  getBackends,
  addBackend,
  updateBackend,
  deleteBackend,
  getActiveBackendId,
  setActiveBackendId,
  AuthMode,
} from "../lib/backends";
import {
  checkBiometricAvailability,
  isBiometricEnabled,
  setBiometricEnabled,
  getBiometryTypeName,
  clearStoredCredentials,
  hasStoredCredentials,
} from "../lib/biometric";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-zinc-800 rounded-lg border-2 border-red-500/50 max-w-sm w-full p-4">
        <h3 className="text-lg font-bold text-red-500 font-mono mb-2">[WARNING] {title}</h3>
        <p className="text-amber-500/80 text-sm font-mono mb-4">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 px-4 border-2 border-amber-500/50 rounded text-amber-500 font-mono font-bold"
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 px-4 bg-red-500 text-zinc-900 rounded font-mono font-bold"
          >
            DELETE
          </button>
        </div>
      </div>
    </div>
  );
}

interface BackendFormData {
  name: string;
  apiUrl: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  authMode: AuthMode;
  cognitoDomain: string;
  redirectUri: string;
  scopes: string;
}

const emptyFormData: BackendFormData = {
  name: "",
  apiUrl: "",
  region: "",
  userPoolId: "",
  userPoolClientId: "",
  authMode: "password",
  cognitoDomain: "",
  redirectUri: "",
  scopes: "openid,email,profile",
};

export default function SettingsPage() {
  const { user, signOut, isAuthenticated } = useAuth();
  const { navigate } = useNavigation();
  const [backends, setBackends] = useState<CloudBackend[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BackendFormData>(emptyFormData);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; backendId: string | null; backendName: string }>({
    isOpen: false,
    backendId: null,
    backendName: "",
  });

  // Biometric state
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricType, setBiometricType] = useState("Biometrics");
  const [hasCredentials, setHasCredentials] = useState(false);

  // Audio settings
  const { settings: audioSettings, updateSettings, toggleCategory, setMasterVolume, playUISound, playAlert, startAmbient, stopAmbient, setAmbientIntensity } = useAudio();
  const [geigerTestRunning, setGeigerTestRunning] = useState(false);

  // Cloud demo state
  const [cloudDemoEnabled, setCloudDemoEnabled] = useState(false);
  const [cloudDemoRunning, setCloudDemoRunning] = useState(false); // True after setup/start until reset
  const [cloudDemoLoading, setCloudDemoLoading] = useState(false);
  const [cloudDemoResult, setCloudDemoResult] = useState<{ success: boolean; message: string } | null>(null);

  // Push notifications
  const { token: pushToken, isRegistered: pushRegistered, error: pushError, status: pushStatus } = usePushNotifications(isAuthenticated);

  // Game mode state
  const [gameAvailable, setGameAvailable] = useState(false); // Backend supports game mode
  const [gameEnabled, setGameEnabled] = useState(false); // User has toggled it on
  const [gameLoading, setGameLoading] = useState(false);
  const [gameSession, setGameSession] = useState<{ active: boolean; endsAt?: number; startedBy?: string } | null>(null);
  const [gameTimeLeft, setGameTimeLeft] = useState(0);
  const [gameSeverity, setGameSeverity] = useState("warning");
  const [gameAlarmTitle, setGameAlarmTitle] = useState("");
  const [gameCooldown, setGameCooldown] = useState(false);
  const [gameResult, setGameResult] = useState<{ success: boolean; message: string } | null>(null);
  const [pushTestLoading, setPushTestLoading] = useState(false);
  const [pushTestResult, setPushTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Demo mode
  const {
    isEnabled: demoEnabled,
    isRunning: demoRunning,
    setEnabled: setDemoEnabled,
    startDemo,
    stopDemo,
    resetDemo,
    addIncident,
    ackIncident,
    resolveIncident,
    incidents: demoIncidents,
  } = useDemoMode();

  // Ref to always get latest incidents (avoids stale closure in demo callbacks)
  const demoIncidentsRef = useRef(demoIncidents);
  useEffect(() => {
    demoIncidentsRef.current = demoIncidents;
  }, [demoIncidents]);

  useEffect(() => {
    setBackends(getBackends());
    setActiveId(getActiveBackendId());
  }, []);

  // Check game mode availability and session status
  useEffect(() => {
    async function checkGame() {
      try {
        const config = await gameApi.getConfig();
        setGameAvailable(config.enabled);
        if (config.enabled && gameEnabled) {
          const session = await gameApi.getSession();
          setGameSession(session);
          if (session.active && session.ends_at) {
            setGameTimeLeft(Math.max(0, session.ends_at - Date.now()));
          }
        }
      } catch (e) {
        console.log("[Game] Check failed:", e);
      }
    }
    if (isAuthenticated) {
      checkGame();
      // Poll session status every 2 seconds when game is enabled
      const interval = setInterval(checkGame, 2000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, gameEnabled]);

  // Countdown timer
  useEffect(() => {
    if (!gameSession?.active || !gameSession.endsAt) return;
    const interval = setInterval(() => {
      const left = Math.max(0, gameSession.endsAt! - Date.now());
      setGameTimeLeft(left);
      if (left === 0) {
        setGameSession({ active: false });
        setGameResult({ success: true, message: "Game ended!" });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [gameSession?.active, gameSession?.endsAt]);

  useEffect(() => {
    async function loadBiometricStatus() {
      const status = await checkBiometricAvailability();
      setBiometricAvailable(status.available);
      setBiometricType(getBiometryTypeName(status.biometryType));

      const enabled = await isBiometricEnabled();
      setBiometricEnabledState(enabled);

      const hasCreds = await hasStoredCredentials();
      setHasCredentials(hasCreds);
    }
    loadBiometricStatus();
  }, []);

  const handleBiometricToggle = async () => {
    const newValue = !biometricEnabled;
    await setBiometricEnabled(newValue);
    setBiometricEnabledState(newValue);

    // If disabling, also clear stored credentials
    if (!newValue) {
      await clearStoredCredentials();
      setHasCredentials(false);
    }
  };

  const resetForm = () => {
    setFormData(emptyFormData);
    setShowForm(false);
    setEditingId(null);
  };

  const handleAddClick = () => {
    setFormData(emptyFormData);
    setEditingId(null);
    setShowForm(true);
  };

  const handleEditClick = (backend: CloudBackend) => {
    setFormData({
      name: backend.name,
      apiUrl: backend.apiUrl,
      region: backend.region,
      userPoolId: backend.userPoolId,
      userPoolClientId: backend.userPoolClientId,
      authMode: backend.authMode ?? "password",
      cognitoDomain: backend.cognitoDomain || "",
      redirectUri: backend.redirectUri || "",
      scopes: backend.scopes?.join(",") || "openid,email,profile",
    });
    setEditingId(backend.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.apiUrl || !formData.region || !formData.userPoolId || !formData.userPoolClientId) {
      return;
    }

    if (formData.authMode === "oidc" && (!formData.cognitoDomain || !formData.redirectUri)) {
      return;
    }

    const scopes = formData.scopes
      ? formData.scopes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["openid", "email", "profile"];

    if (editingId) {
      updateBackend(editingId, {
        ...formData,
        scopes,
      });
    } else {
      addBackend({
        ...formData,
        scopes,
      });
    }

    setBackends(getBackends());
    setActiveId(getActiveBackendId());
    resetForm();
  };

  const handleDeleteClick = (backend: CloudBackend) => {
    setDeleteConfirm({
      isOpen: true,
      backendId: backend.id,
      backendName: backend.name,
    });
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirm.backendId) {
      deleteBackend(deleteConfirm.backendId);
      setBackends(getBackends());
      setActiveId(getActiveBackendId());
    }
    setDeleteConfirm({ isOpen: false, backendId: null, backendName: "" });
  };

  const handleSelectBackend = (id: string) => {
    setActiveBackendId(id);
    setActiveId(id);
    window.location.reload();
  };

  const handleDemoToggle = () => {
    const newValue = !demoEnabled;
    setDemoEnabled(newValue);
    playUISound(newValue ? "toggle_on" : "toggle_off");
    // Turn off cloud demo when enabling local demo
    if (newValue && cloudDemoEnabled) {
      setCloudDemoEnabled(false);
      setCloudDemoResult(null);
    }
  };

  const handleStartDemo = () => {
    playUISound("click");
    startDemo();
    resetDemoCounter();
    startDemoSequence({
      addIncident,
      ackIncident,
      resolveIncident,
      playAlert: (severity) => {
        playAlert(severity);
      },
      onComplete: () => {
        stopDemo();
      },
      getIncidents: () => demoIncidentsRef.current,
    });
  };

  const handleStopDemo = () => {
    playUISound("click");
    stopDemoSequence();
    stopDemo();
  };

  const handleResetDemo = () => {
    playUISound("click");
    stopDemoSequence();
    resetDemo();
    resetDemoCounter();
  };

  const handleCloudDemoSetup = async () => {
    playUISound("click");
    setCloudDemoLoading(true);
    setCloudDemoResult(null);

    try {
      const result = await cloudDemoApi.setup();
      setCloudDemoRunning(true);
      setCloudDemoResult({
        success: true,
        message: `Team ready: ${result.team_id}. On-call until ${new Date(result.on_call_until).toLocaleTimeString()}`,
      });
      playUISound("success");
    } catch (error) {
      setCloudDemoResult({
        success: false,
        message: error instanceof Error ? error.message : "Setup failed",
      });
      playUISound("error");
    } finally {
      setCloudDemoLoading(false);
    }
  };

  const handleCloudDemoStart = async () => {
    playUISound("click");
    setCloudDemoLoading(true);
    setCloudDemoResult(null);

    try {
      const result = await cloudDemoApi.start();
      setCloudDemoRunning(true);
      setCloudDemoResult({
        success: true,
        message: `Published ${result.alarm_count} alarms to SNS`,
      });
      playUISound("success");
    } catch (error) {
      setCloudDemoResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to start demo",
      });
      playUISound("error");
    } finally {
      setCloudDemoLoading(false);
    }
  };

  const handleCloudDemoReset = async () => {
    playUISound("click");
    setCloudDemoLoading(true);
    setCloudDemoResult(null);

    try {
      const result = await cloudDemoApi.reset();
      setCloudDemoRunning(false);
      setCloudDemoResult({
        success: true,
        message: `Reset: ${result.deleted_incidents} incidents, ${result.deleted_schedules} schedules`,
      });
      playUISound("success");
    } catch (error) {
      setCloudDemoResult({
        success: false,
        message: error instanceof Error ? error.message : "Reset failed",
      });
      playUISound("error");
    } finally {
      setCloudDemoLoading(false);
    }
  };

  const handleTestPush = async () => {
    if (!pushToken) return;
    playUISound("click");
    setPushTestLoading(true);
    setPushTestResult(null);

    try {
      await devicesApi.testPush(pushToken);
      setPushTestResult({
        success: true,
        message: "Test notification sent!",
      });
      playUISound("success");
    } catch (error) {
      setPushTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to send test",
      });
      playUISound("error");
    } finally {
      setPushTestLoading(false);
    }
  };

  const handleStartGame = async () => {
    playUISound("click");
    setGameLoading(true);
    setGameResult(null);
    try {
      const result = await gameApi.start(user?.getUsername());
      setGameSession({ active: true, endsAt: result.ends_at, startedBy: result.started_by });
      setGameTimeLeft(result.duration_ms);
      setGameResult({ success: true, message: "Game started! 60 seconds!" });
      playUISound("success");
    } catch (error) {
      setGameResult({ success: false, message: error instanceof Error ? error.message : "Failed to start" });
      playUISound("error");
    } finally {
      setGameLoading(false);
    }
  };

  const handleEndGame = async () => {
    playUISound("click");
    setGameLoading(true);
    try {
      await gameApi.end();
      setGameSession({ active: false });
      setGameResult({ success: true, message: "Game ended!" });
      playUISound("success");
    } catch (error) {
      setGameResult({ success: false, message: error instanceof Error ? error.message : "Failed to end" });
      playUISound("error");
    } finally {
      setGameLoading(false);
    }
  };

  const handleTriggerAlarm = async () => {
    if (!gameAlarmTitle.trim()) {
      setGameResult({ success: false, message: "Enter an alarm title!" });
      playUISound("error");
      return;
    }
    playUISound("click");
    setGameCooldown(true);
    setGameResult(null);
    try {
      await gameApi.trigger(gameAlarmTitle.trim(), gameSeverity, user?.getUsername());
      setGameAlarmTitle("");
      playUISound("success");
      navigate("incidents");
    } catch (error) {
      setGameResult({ success: false, message: error instanceof Error ? error.message : "Failed" });
      playUISound("error");
    } finally {
      setTimeout(() => setGameCooldown(false), 500);
    }
  };

  return (
    <div className="h-full bg-zinc-900 p-4 overflow-auto">
      <h1 className="text-xl font-bold text-amber-500 font-mono tracking-wider mb-4">CONFIG</h1>

      {/* Cloud Backends Section */}
      <div className="bg-zinc-800 rounded border-2 border-amber-500/30 mb-4">
        <div className="p-4 border-b-2 border-amber-500/20">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-amber-500 font-mono">{">"} CLOUD BACKENDS</h2>
            <button
              onClick={() => {
                playUISound("click");
                showForm ? resetForm() : handleAddClick();
              }}
              className="text-sm text-amber-500 font-mono font-bold"
            >
              {showForm ? "[CANCEL]" : "[+ ADD]"}
            </button>
          </div>
        </div>

        {/* Add/Edit Form */}
        {showForm && (
          <div className="p-4 border-b-2 border-amber-500/20 bg-zinc-900/50">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} NAME</label>
                <input
                  type="text"
                  placeholder="e.g., Production"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} API URL</label>
                <input
                  type="text"
                  placeholder="https://xxx.execute-api.region.amazonaws.com"
                  value={formData.apiUrl}
                  onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} REGION</label>
                <input
                  type="text"
                  placeholder="e.g., eu-west-1"
                  value={formData.region}
                  onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} USER POOL ID</label>
                <input
                  type="text"
                  placeholder="e.g., eu-west-1_xxxxxxxxx"
                  value={formData.userPoolId}
                  onChange={(e) => setFormData({ ...formData, userPoolId: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} USER POOL CLIENT ID</label>
                <input
                  type="text"
                  placeholder="e.g., xxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={formData.userPoolClientId}
                  onChange={(e) => setFormData({ ...formData, userPoolClientId: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} AUTH MODE</label>
                <select
                  value={formData.authMode}
                  onChange={(e) => setFormData({ ...formData, authMode: e.target.value as AuthMode })}
                  className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono focus:outline-none focus:border-amber-500 text-base"
                >
                  <option value="password">Password (SRP)</option>
                  <option value="oidc">OIDC / Hosted UI (Entra)</option>
                </select>
              </div>
              {formData.authMode === "oidc" && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} COGNITO DOMAIN</label>
                    <input
                      type="text"
                      placeholder="https://your-domain.auth.region.amazoncognito.com"
                      value={formData.cognitoDomain}
                      onChange={(e) => setFormData({ ...formData, cognitoDomain: e.target.value })}
                      className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} REDIRECT URI</label>
                    <input
                      type="text"
                      placeholder="tauri://localhost/callback"
                      value={formData.redirectUri}
                      onChange={(e) => setFormData({ ...formData, redirectUri: e.target.value })}
                      className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-amber-500/70 font-mono mb-1">{">"} SCOPES (CSV)</label>
                    <input
                      type="text"
                      placeholder="openid,email,profile"
                      value={formData.scopes}
                      onChange={(e) => setFormData({ ...formData, scopes: e.target.value })}
                      className="w-full px-3 py-2 bg-zinc-800 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                    />
                  </div>
                </>
              )}
              <button
                onClick={() => {
                  playUISound("click");
                  handleSubmit();
                }}
                className="w-full py-2 bg-amber-500 text-zinc-900 rounded font-mono font-bold"
              >
                {editingId ? "SAVE CHANGES" : "ADD BACKEND"}
              </button>
            </div>
          </div>
        )}

        {/* Backend List */}
        {backends.length === 0 ? (
          <div className="p-4 text-center text-amber-500/50 text-sm font-mono">
            NO BACKENDS CONFIGURED. ADD ONE TO GET STARTED.
          </div>
        ) : (
          <div className="divide-y-2 divide-amber-500/20">
            {backends.map((backend) => (
              <div
                key={backend.id}
                className={`p-4 ${activeId === backend.id ? "bg-green-500/10" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-amber-500 font-mono">{backend.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded border font-mono font-bold border-amber-500/40 text-amber-500/80">
                        {backend.authMode === "oidc" ? "OIDC" : "PASSWORD"}
                      </span>
                      {activeId === backend.id && (
                        <span className="text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded border border-green-500/50 font-mono font-bold">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-amber-500/60 truncate mt-1 font-mono">{backend.apiUrl}</p>
                    <p className="text-xs text-amber-500/40 mt-0.5 font-mono">{backend.region}</p>
                    {backend.authMode === "oidc" && (
                      <p className="text-[10px] text-amber-500/50 mt-0.5 font-mono truncate">
                        {backend.cognitoDomain || "Missing domain"} • {backend.redirectUri || "Missing redirect"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {activeId !== backend.id && (
                      <button
                        onClick={() => {
                          playUISound("click");
                          handleSelectBackend(backend.id);
                        }}
                        className="text-xs text-green-500 font-mono font-bold px-2 py-1"
                      >
                        [SELECT]
                      </button>
                    )}
                    <button
                      onClick={() => {
                        playUISound("click");
                        handleEditClick(backend);
                      }}
                      className="text-xs text-amber-500 font-mono font-bold px-2 py-1"
                    >
                      [EDIT]
                    </button>
                    <button
                      onClick={() => {
                        playUISound("click");
                        handleDeleteClick(backend);
                      }}
                      className="text-xs text-red-500 font-mono font-bold px-2 py-1"
                    >
                      [DEL]
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Biometric Settings */}
      {biometricAvailable && (
        <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-amber-500 font-mono">{">"} USE {biometricType.toUpperCase()}</h2>
              <p className="text-xs text-amber-500/60 mt-0.5 font-mono">
                {biometricEnabled && hasCredentials
                  ? "QUICK SIGN IN ENABLED"
                  : biometricEnabled
                  ? "SIGN IN ONCE TO ENABLE"
                  : "ENABLE FOR FASTER SIGN IN"}
              </p>
            </div>
            <button
              onClick={() => {
                playUISound(biometricEnabled ? "toggle_off" : "toggle_on");
                handleBiometricToggle();
              }}
              className={`relative w-12 h-7 rounded-full transition-colors border-2 ${
                biometricEnabled ? "bg-green-500/20 border-green-500" : "bg-zinc-900 border-amber-500/30"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                  biometricEnabled ? "translate-x-5 bg-green-500" : "bg-amber-500/50"
                }`}
              />
            </button>
          </div>
          {biometricEnabled && hasCredentials && (
            <p className="text-xs text-green-500 mt-2 font-mono">[READY] {biometricType} AUTHENTICATION ACTIVE</p>
          )}
        </div>
      )}

      {/* Push Notifications */}
      <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-4">
        <h2 className="text-sm font-bold text-amber-500 font-mono mb-3">{">"} PUSH NOTIFICATIONS</h2>

        {/* Status indicators */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-500/70 font-mono">STATUS</span>
            <span className={`text-xs font-mono font-bold ${
              pushStatus === "granted" ? "text-green-500" :
              pushStatus === "denied" || pushStatus === "error" ? "text-red-500" :
              pushStatus === "requesting" ? "text-amber-500" :
              "text-amber-500/50"
            }`}>
              {pushStatus.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-500/70 font-mono">DEVICE TOKEN</span>
            <span className={`text-xs font-mono font-bold ${pushToken ? "text-green-500" : "text-amber-500/50"}`}>
              {pushToken ? `${pushToken.substring(0, 8)}...` : "NONE"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-500/70 font-mono">BACKEND</span>
            <span className={`text-xs font-mono font-bold ${pushRegistered ? "text-green-500" : "text-amber-500/50"}`}>
              {pushRegistered ? "REGISTERED" : isAuthenticated ? "NOT REGISTERED" : "SIGN IN REQUIRED"}
            </span>
          </div>
        </div>

        {/* Error display */}
        {pushError && (
          <div className="p-2 bg-red-500/10 border border-red-500/30 rounded mb-3">
            <p className="text-xs text-red-500 font-mono">{pushError}</p>
          </div>
        )}

        {/* Test result */}
        {pushTestResult && (
          <div className={`p-2 rounded mb-3 border ${pushTestResult.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
            <p className={`text-xs font-mono text-center ${pushTestResult.success ? "text-green-500" : "text-red-500"}`}>
              {pushTestResult.message}
            </p>
          </div>
        )}

        {/* Test button */}
        <button
          onClick={handleTestPush}
          disabled={!pushToken || !pushRegistered || pushTestLoading}
          className="w-full py-2 bg-amber-500/20 text-amber-500 rounded border border-amber-500/50 font-mono text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
        >
          {pushTestLoading ? "SENDING..." : "TEST PUSH NOTIFICATION"}
        </button>
        {!pushToken && (
          <p className="text-xs text-amber-500/50 font-mono text-center mt-2">ALLOW NOTIFICATIONS TO ENABLE</p>
        )}
      </div>

      {/* Audio Settings */}
      <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-amber-500 font-mono">{">"} AUDIO</h2>
            <p className="text-xs text-amber-500/60 mt-0.5 font-mono">
              {audioSettings.enabled ? "PIP-ALERT AUDIO ENABLED" : "AUDIO DISABLED"}
            </p>
          </div>
          <button
            onClick={() => {
              updateSettings({ enabled: !audioSettings.enabled });
              playUISound(audioSettings.enabled ? "toggle_off" : "toggle_on");
            }}
            className={`relative w-12 h-7 rounded-full transition-colors border-2 ${
              audioSettings.enabled ? "bg-green-500/20 border-green-500" : "bg-zinc-900 border-amber-500/30"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                audioSettings.enabled ? "translate-x-5 bg-green-500" : "bg-amber-500/50"
              }`}
            />
          </button>
        </div>

        {audioSettings.enabled && (
          <>
            {/* Master Volume */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-amber-500/70 font-mono mb-2">
                {">"} MASTER VOLUME: {Math.round(audioSettings.masterVolume * 100)}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(audioSettings.masterVolume * 100)}
                onChange={(e) => setMasterVolume(Number(e.target.value) / 100)}
                className="w-full h-2 bg-zinc-900 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Category Toggles */}
            <div className="space-y-3">
              {/* UI Sounds */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-500/80 font-mono">UI SOUNDS</span>
                <button
                  onClick={() => {
                    toggleCategory("ui");
                    playUISound(audioSettings.categories.ui ? "toggle_off" : "toggle_on");
                  }}
                  className={`relative w-10 h-6 rounded-full transition-colors border ${
                    audioSettings.categories.ui ? "bg-green-500/20 border-green-500/50" : "bg-zinc-900 border-amber-500/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
                      audioSettings.categories.ui ? "translate-x-4 bg-green-500" : "bg-amber-500/40"
                    }`}
                  />
                </button>
              </div>

              {/* Boot Sounds */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-500/80 font-mono">BOOT SEQUENCE</span>
                <button
                  onClick={() => {
                    toggleCategory("boot");
                    playUISound(audioSettings.categories.boot ? "toggle_off" : "toggle_on");
                  }}
                  className={`relative w-10 h-6 rounded-full transition-colors border ${
                    audioSettings.categories.boot ? "bg-green-500/20 border-green-500/50" : "bg-zinc-900 border-amber-500/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
                      audioSettings.categories.boot ? "translate-x-4 bg-green-500" : "bg-amber-500/40"
                    }`}
                  />
                </button>
              </div>

              {/* Alert Sounds */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-500/80 font-mono">ALERTS</span>
                <button
                  onClick={() => {
                    toggleCategory("alerts");
                    playUISound(audioSettings.categories.alerts ? "toggle_off" : "toggle_on");
                  }}
                  className={`relative w-10 h-6 rounded-full transition-colors border ${
                    audioSettings.categories.alerts ? "bg-red-500/20 border-red-500/50" : "bg-zinc-900 border-amber-500/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
                      audioSettings.categories.alerts ? "translate-x-4 bg-red-500" : "bg-amber-500/40"
                    }`}
                  />
                </button>
              </div>

              {/* Ambient Sounds */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-500/80 font-mono">AMBIENT</span>
                <button
                  onClick={() => {
                    toggleCategory("ambient");
                    playUISound(audioSettings.categories.ambient ? "toggle_off" : "toggle_on");
                  }}
                  className={`relative w-10 h-6 rounded-full transition-colors border ${
                    audioSettings.categories.ambient ? "bg-green-500/20 border-green-500/50" : "bg-zinc-900 border-amber-500/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
                      audioSettings.categories.ambient ? "translate-x-4 bg-green-500" : "bg-amber-500/40"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Test Sounds */}
            <div className="mt-4 pt-4 border-t border-amber-500/20 space-y-2">
              <label className="block text-xs font-bold text-amber-500/70 font-mono mb-2">
                {">"} TEST SOUNDS
              </label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => playUISound("toggle_on")}
                  className="px-3 py-1.5 bg-zinc-900 border border-amber-500/30 rounded text-amber-500 font-mono text-sm active:scale-95 active:bg-amber-500/20 transition-all"
                >
                  TOGGLE ON
                </button>
                <button
                  onClick={() => playUISound("toggle_off")}
                  className="px-3 py-1.5 bg-zinc-900 border border-amber-500/30 rounded text-amber-500 font-mono text-sm active:scale-95 active:bg-amber-500/20 transition-all"
                >
                  TOGGLE OFF
                </button>
                <button
                  onClick={() => playUISound("success")}
                  className="px-3 py-1.5 bg-zinc-900 border border-green-500/30 rounded text-green-500 font-mono text-sm active:scale-95 active:bg-green-500/20 transition-all"
                >
                  SUCCESS
                </button>
                <button
                  onClick={() => playUISound("error")}
                  className="px-3 py-1.5 bg-zinc-900 border border-red-500/30 rounded text-red-500 font-mono text-sm active:scale-95 active:bg-red-500/20 transition-all"
                >
                  ERROR
                </button>
                <button
                  onClick={() => playAlert("critical")}
                  className="px-3 py-1.5 bg-red-500/20 border border-red-500/50 rounded text-red-500 font-mono text-sm active:scale-95 active:bg-red-500/40 transition-all"
                >
                  CRITICAL ALARM
                </button>
                <button
                  onClick={() => playAlert("warning")}
                  className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/50 rounded text-amber-500 font-mono text-sm active:scale-95 active:bg-amber-500/40 transition-all"
                >
                  WARNING
                </button>
              </div>

              {/* Geiger Test */}
              <label className="block text-xs font-bold text-amber-500/70 font-mono mb-2 mt-3">
                {">"} GEIGER TEST
              </label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    if (geigerTestRunning) {
                      stopAmbient();
                      setGeigerTestRunning(false);
                    } else {
                      setAmbientIntensity(0.2);
                      startAmbient();
                      setGeigerTestRunning(true);
                    }
                  }}
                  className={`px-3 py-1.5 border rounded font-mono text-sm ${geigerTestRunning ? "bg-green-500/20 border-green-500/50 text-green-500" : "bg-zinc-900 border-amber-500/30 text-amber-500"}`}
                >
                  LOW (1)
                </button>
                <button
                  onClick={() => {
                    if (geigerTestRunning) {
                      stopAmbient();
                      setGeigerTestRunning(false);
                    } else {
                      setAmbientIntensity(0.6);
                      startAmbient();
                      setGeigerTestRunning(true);
                    }
                  }}
                  className={`px-3 py-1.5 border rounded font-mono text-sm ${geigerTestRunning ? "bg-green-500/20 border-green-500/50 text-green-500" : "bg-zinc-900 border-amber-500/30 text-amber-500"}`}
                >
                  MED (3)
                </button>
                <button
                  onClick={() => {
                    if (geigerTestRunning) {
                      stopAmbient();
                      setGeigerTestRunning(false);
                    } else {
                      setAmbientIntensity(1.0);
                      startAmbient();
                      setGeigerTestRunning(true);
                    }
                  }}
                  className={`px-3 py-1.5 border rounded font-mono text-sm ${geigerTestRunning ? "bg-green-500/20 border-green-500/50 text-green-500" : "bg-zinc-900 border-red-500/30 text-red-500"}`}
                >
                  HIGH (5+)
                </button>
                {geigerTestRunning && (
                  <button
                    onClick={() => {
                      stopAmbient();
                      setGeigerTestRunning(false);
                    }}
                    className="px-3 py-1.5 bg-red-500/20 border border-red-500/50 rounded text-red-500 font-mono text-sm"
                  >
                    STOP
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Demo Mode */}
      <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-4">
        <h2 className="text-sm font-bold text-amber-500 font-mono mb-3">{">"} DEMO MODE</h2>

        {/* Local Demo Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs font-bold text-amber-500/80 font-mono">LOCAL DEMO</h3>
              <p className="text-xs text-amber-500/50 mt-0.5 font-mono">
                {cloudDemoRunning ? "CLOUD DEMO ACTIVE" : demoEnabled ? (demoRunning ? "DEMO RUNNING" : "CLIENT-SIDE ACTIVE") : "CLIENT-SIDE ONLY"}
              </p>
            </div>
            <button
              onClick={() => {
                if (cloudDemoRunning) {
                  playUISound("error");
                  return;
                }
                handleDemoToggle();
              }}
              className={`relative w-12 h-7 rounded-full transition-colors border-2 ${
                demoEnabled ? "bg-amber-500/20 border-amber-500" : "bg-zinc-900 border-amber-500/30"
              } ${cloudDemoRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                  demoEnabled ? "translate-x-5 bg-amber-500" : "bg-amber-500/50"
                }`}
              />
            </button>
          </div>

          {demoEnabled && (
            <>
              {/* Warning box */}
              <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded mb-3">
                <p className="text-xs text-amber-500/80 font-mono text-center">
                  LOCAL DEMO — NOT CONNECTED TO BACKEND
                </p>
              </div>

              {/* Demo status */}
              {demoIncidents.length > 0 && (
                <div className="p-2 bg-zinc-900 border border-amber-500/20 rounded mb-3">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-red-500">
                      UNACKED: {demoIncidents.filter(i => i.state === "triggered").length}
                    </span>
                    <span className="text-amber-500">
                      ACKED: {demoIncidents.filter(i => i.state === "acked").length}
                    </span>
                    <span className="text-green-500">
                      RESOLVED: {demoIncidents.filter(i => i.state === "resolved").length}
                    </span>
                  </div>
                </div>
              )}

              {/* Demo controls */}
              <div className="flex gap-2">
                {!demoRunning ? (
                  <button
                    onClick={handleStartDemo}
                    className="flex-1 py-2 bg-amber-500/20 text-amber-500 rounded border border-amber-500/50 font-mono text-sm font-bold"
                  >
                    START
                  </button>
                ) : (
                  <button
                    onClick={handleStopDemo}
                    className="flex-1 py-2 bg-red-500/20 text-red-500 rounded border border-red-500/50 font-mono text-sm font-bold"
                  >
                    STOP
                  </button>
                )}
                <button
                  onClick={handleResetDemo}
                  className="flex-1 py-2 bg-zinc-900 text-amber-500/70 rounded border border-amber-500/30 font-mono text-sm font-bold"
                >
                  RESET
                </button>
              </div>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-amber-500/20 my-4" />

        {/* Cloud Demo Section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs font-bold text-amber-500/80 font-mono">CLOUD DEMO (E2E)</h3>
              <p className="text-xs text-amber-500/50 mt-0.5 font-mono">
                {cloudDemoRunning ? "RUNNING — RESET TO DISABLE" : cloudDemoEnabled ? "SNS → LAMBDA → DYNAMODB" : "FULL E2E TEST"}
              </p>
            </div>
            <button
              onClick={() => {
                // Can't turn off while running
                if (cloudDemoEnabled && cloudDemoRunning) {
                  playUISound("error");
                  return;
                }
                const newValue = !cloudDemoEnabled;
                setCloudDemoEnabled(newValue);
                playUISound(newValue ? "toggle_on" : "toggle_off");
                // Turn off local demo when enabling cloud demo
                if (newValue && demoEnabled) {
                  stopDemoSequence();
                  resetDemo();
                  setDemoEnabled(false);
                }
                if (!newValue) setCloudDemoResult(null);
              }}
              disabled={!isAuthenticated}
              className={`relative w-12 h-7 rounded-full transition-colors border-2 ${
                cloudDemoEnabled ? "bg-green-500/20 border-green-500" : "bg-zinc-900 border-amber-500/30"
              } ${!isAuthenticated ? "opacity-50" : ""} ${cloudDemoRunning ? "cursor-not-allowed" : ""}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                  cloudDemoEnabled ? "translate-x-5 bg-green-500" : "bg-amber-500/50"
                }`}
              />
            </button>
          </div>

          {cloudDemoEnabled && (
            <>
              <div className="p-2 bg-green-500/10 border border-green-500/30 rounded mb-3">
                <p className="text-xs text-green-500/80 font-mono text-center">
                  FULL E2E: ALARMS → SNS → INCIDENTS
                </p>
              </div>
              {cloudDemoResult && (
                <div className={`p-2 rounded mb-3 border ${cloudDemoResult.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                  <p className={`text-xs font-mono text-center ${cloudDemoResult.success ? "text-green-500" : "text-red-500"}`}>
                    {cloudDemoResult.message}
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCloudDemoSetup}
                  disabled={cloudDemoLoading}
                  className="flex-1 py-2 bg-amber-500/20 text-amber-500 rounded border border-amber-500/50 font-mono text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
                >
                  {cloudDemoLoading ? "..." : "1. SETUP"}
                </button>
                <button
                  onClick={handleCloudDemoStart}
                  disabled={cloudDemoLoading}
                  className="flex-1 py-2 bg-green-500/20 text-green-500 rounded border border-green-500/50 font-mono text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
                >
                  {cloudDemoLoading ? "..." : "2. START"}
                </button>
                <button
                  onClick={handleCloudDemoReset}
                  disabled={cloudDemoLoading}
                  className="flex-1 py-2 bg-red-500/20 text-red-500 rounded border border-red-500/50 font-mono text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
                >
                  {cloudDemoLoading ? "..." : "3. RESET"}
                </button>
              </div>
            </>
          )}
          {!isAuthenticated && (
            <p className="text-xs text-amber-500/50 font-mono text-center mt-2">SIGN IN TO USE</p>
          )}
        </div>
      </div>

      {/* Game Mode */}
      {gameAvailable && isAuthenticated && (
        <div className="bg-zinc-800 rounded border-2 border-green-500/30 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-green-500 font-mono">{">"} GAME MODE</h2>
              <p className="text-xs text-green-500/50 mt-0.5 font-mono">
                {gameEnabled ? (gameSession?.active ? "GAME ACTIVE" : "MULTIPLAYER READY") : "60s ROUNDS"}
              </p>
            </div>
            <button
              onClick={() => {
                const newValue = !gameEnabled;
                setGameEnabled(newValue);
                playUISound(newValue ? "toggle_on" : "toggle_off");
                if (!newValue) {
                  setGameResult(null);
                  setGameSession(null);
                }
              }}
              className={`relative w-12 h-7 rounded-full transition-colors border-2 ${
                gameEnabled ? "bg-green-500/20 border-green-500" : "bg-zinc-900 border-green-500/30"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                  gameEnabled ? "translate-x-5 bg-green-500" : "bg-green-500/50"
                }`}
              />
            </button>
          </div>

          {gameEnabled && (
            <>
              {/* Game result */}
              {gameResult && (
                <div className={`p-2 rounded mb-3 border ${gameResult.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                  <p className={`text-xs font-mono text-center ${gameResult.success ? "text-green-500" : "text-red-500"}`}>
                    {gameResult.message}
                  </p>
                </div>
              )}

              {!gameSession?.active ? (
                /* No active game - show START button */
                <div>
                  <p className="text-xs text-green-500/60 font-mono mb-3 text-center">60 SECOND ROUNDS • TRIGGER ALARMS • RACE TO ACK!</p>
                  <button
                    onClick={handleStartGame}
                    disabled={gameLoading}
                    className="w-full py-4 bg-green-500/20 text-green-500 rounded border-2 border-green-500 font-mono text-lg font-bold disabled:opacity-50 active:scale-95 transition-all"
                  >
                    {gameLoading ? "STARTING..." : "START GAME"}
                  </button>
                </div>
              ) : (
                /* Active game - show timer, trigger form, and end button */
                <div>
                  {/* Countdown timer */}
                  <div className="text-center mb-4">
                    <p className="text-4xl font-bold text-green-500 font-mono">
                      {Math.ceil(gameTimeLeft / 1000)}s
                    </p>
                    <p className="text-xs text-green-500/60 font-mono">
                      Started by {gameSession.startedBy}
                    </p>
                  </div>

                  {/* Alarm trigger form */}
                  <div className="mb-3">
                    <input
                      type="text"
                      placeholder="Alarm title..."
                      value={gameAlarmTitle}
                      onChange={(e) => setGameAlarmTitle(e.target.value.slice(0, 50))}
                      maxLength={50}
                      disabled={gameCooldown}
                      className="w-full px-3 py-2 bg-zinc-900 border-2 border-green-500/30 rounded text-green-500 font-mono placeholder-green-500/30 focus:outline-none focus:border-green-500 text-base disabled:opacity-50"
                    />
                  </div>

                  {/* Severity buttons */}
                  <div className="flex gap-2 mb-3">
                    {[
                      { id: "info", label: "1x", color: "blue" },
                      { id: "warning", label: "2x", color: "amber" },
                      { id: "critical", label: "3x", color: "red" },
                    ].map((sev) => (
                      <button
                        key={sev.id}
                        onClick={() => setGameSeverity(sev.id)}
                        disabled={gameCooldown}
                        className={`flex-1 py-2 rounded border font-mono text-sm font-bold ${
                          gameSeverity === sev.id
                            ? sev.color === "blue" ? "bg-blue-500/20 border-blue-500 text-blue-500"
                            : sev.color === "amber" ? "bg-amber-500/20 border-amber-500 text-amber-500"
                            : "bg-red-500/20 border-red-500 text-red-500"
                            : "bg-zinc-900 border-green-500/30 text-green-500/50"
                        }`}
                      >
                        {sev.label}
                      </button>
                    ))}
                  </div>

                  {/* Send alarm button */}
                  <button
                    onClick={handleTriggerAlarm}
                    disabled={gameCooldown || !gameAlarmTitle.trim()}
                    className={`w-full py-3 rounded border font-mono font-bold mb-3 ${
                      gameCooldown
                        ? "bg-amber-500/20 text-amber-500 border-amber-500/50 animate-pulse"
                        : "bg-green-500/20 text-green-500 border-green-500/50"
                    }`}
                  >
                    {gameCooldown ? "SENDING..." : "SEND ALARM"}
                  </button>

                  {/* End game button */}
                  <button
                    onClick={handleEndGame}
                    disabled={gameLoading}
                    className="w-full py-2 bg-red-500/20 text-red-500 rounded border border-red-500/50 font-mono text-sm font-bold"
                  >
                    END GAME
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* User info */}
      {isAuthenticated && (
        <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-4">
          <h2 className="text-sm font-bold text-amber-500/70 font-mono mb-2">{">"} ACCOUNT</h2>
          <p className="font-bold text-amber-500 font-mono">{user?.getUsername() || "NOT SIGNED IN"}</p>
        </div>
      )}

      {/* App info */}
      <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-4">
        <h2 className="text-sm font-bold text-amber-500/70 font-mono mb-2">{">"} SYSTEM INFO</h2>
        <p className="text-amber-500 font-mono">PIP-ALERT v0.1.0</p>
      </div>

      {/* Sign out or Go to Login */}
      {isAuthenticated ? (
        <button
          onClick={() => {
            playUISound("click");
            signOut();
          }}
          className="w-full py-3 bg-red-500/20 text-red-500 rounded border-2 border-red-500/50 font-mono font-bold flex items-center justify-center gap-2"
        >
          <span className="text-2xl leading-none -mt-1">☢</span>
          SIGN OUT
        </button>
      ) : (
        <button
          onClick={() => {
            playUISound("click");
            navigate("login");
          }}
          className="w-full py-3 bg-amber-500 text-zinc-900 rounded font-mono font-bold"
        >
          GO TO LOGIN
        </button>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Backend"
        message={`Are you sure you want to delete "${deleteConfirm.backendName}"? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm({ isOpen: false, backendId: null, backendName: "" })}
      />
    </div>
  );
}
