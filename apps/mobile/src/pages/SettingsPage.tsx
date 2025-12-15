import { useState, useEffect } from "react";
import { useAuth } from "../lib/auth";
import { useNavigation } from "../lib/navigation";
import {
  CloudBackend,
  getBackends,
  addBackend,
  updateBackend,
  deleteBackend,
  getActiveBackendId,
  setActiveBackendId,
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
}

const emptyFormData: BackendFormData = {
  name: "",
  apiUrl: "",
  region: "",
  userPoolId: "",
  userPoolClientId: "",
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

  useEffect(() => {
    setBackends(getBackends());
    setActiveId(getActiveBackendId());
  }, []);

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
    });
    setEditingId(backend.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.apiUrl || !formData.region || !formData.userPoolId || !formData.userPoolClientId) {
      return;
    }

    if (editingId) {
      updateBackend(editingId, formData);
    } else {
      addBackend(formData);
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

  return (
    <div className="min-h-full bg-zinc-900 p-4">
      <h1 className="text-xl font-bold text-amber-500 font-mono tracking-wider mb-4">CONFIG</h1>

      {/* Cloud Backends Section */}
      <div className="bg-zinc-800 rounded border-2 border-amber-500/30 mb-4">
        <div className="p-4 border-b-2 border-amber-500/20">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-amber-500 font-mono">{">"} CLOUD BACKENDS</h2>
            <button
              onClick={showForm ? resetForm : handleAddClick}
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
              <button
                onClick={handleSubmit}
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
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-500 font-mono">{backend.name}</span>
                      {activeId === backend.id && (
                        <span className="text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded border border-green-500/50 font-mono font-bold">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-amber-500/60 truncate mt-1 font-mono">{backend.apiUrl}</p>
                    <p className="text-xs text-amber-500/40 mt-0.5 font-mono">{backend.region}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {activeId !== backend.id && (
                      <button
                        onClick={() => handleSelectBackend(backend.id)}
                        className="text-xs text-green-500 font-mono font-bold px-2 py-1"
                      >
                        [SELECT]
                      </button>
                    )}
                    <button
                      onClick={() => handleEditClick(backend)}
                      className="text-xs text-amber-500 font-mono font-bold px-2 py-1"
                    >
                      [EDIT]
                    </button>
                    <button
                      onClick={() => handleDeleteClick(backend)}
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
              onClick={handleBiometricToggle}
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
        <p className="text-amber-500 font-mono">RIFF-BOY v0.1.0</p>
      </div>

      {/* Sign out or Go to Login */}
      {isAuthenticated ? (
        <button
          onClick={signOut}
          className="w-full py-3 bg-red-500/20 text-red-500 rounded border-2 border-red-500/50 font-mono font-bold"
        >
          SIGN OUT
        </button>
      ) : (
        <button
          onClick={() => navigate("login")}
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
