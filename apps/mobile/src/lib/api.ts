import { getActiveBackend } from "./backends";
import { isDemoMode, demoIncidentsApi } from "./demo";

function getApiUrl(): string {
  const backend = getActiveBackend();
  return backend?.apiUrl || import.meta.env.VITE_API_URL || "";
}

export function getAuthMode(): "password" | "oidc" {
  const backend = getActiveBackend();
  return backend?.authMode ?? "password";
}

type GetTokenFn = () => Promise<string | null>;
let getTokenFn: GetTokenFn | null = null;

export function setTokenGetter(fn: GetTokenFn) {
  getTokenFn = fn;
}

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const token = getTokenFn ? await getTokenFn() : null;
  const apiUrl = getApiUrl();

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Devices
export const devicesApi = {
  register: (token: string, platform: string, sandbox = false) =>
    fetchWithAuth("/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform, sandbox }),
    }),
  unregister: (token: string) =>
    fetchWithAuth(`/devices/${encodeURIComponent(token)}`, { method: "DELETE" }),
  testPush: (token: string) =>
    fetchWithAuth("/devices/test-push", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
};

// Incidents - intercepts demo mode
export const incidentsApi = {
  list: (params?: { state?: string; team_id?: string }) => {
    if (isDemoMode()) return demoIncidentsApi.list(params);
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return fetchWithAuth(`/incidents${query ? `?${query}` : ""}`);
  },
  get: (id: string) => {
    if (isDemoMode()) return demoIncidentsApi.get(id);
    return fetchWithAuth(`/incidents/${id}`);
  },
  ack: (id: string, ackedByName?: string) => {
    if (isDemoMode()) return demoIncidentsApi.ack(id);
    return fetchWithAuth(`/incidents/${id}/ack`, {
      method: "POST",
      body: JSON.stringify({ acked_by_name: ackedByName }),
    });
  },
  unack: (id: string) => {
    if (isDemoMode()) return demoIncidentsApi.unack(id);
    return fetchWithAuth(`/incidents/${id}/unack`, { method: "POST" });
  },
  resolve: (id: string, note?: string) => {
    if (isDemoMode()) return demoIncidentsApi.resolve(id, note);
    return fetchWithAuth(`/incidents/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  },
  reassign: (id: string, userId: string) => {
    if (isDemoMode()) return demoIncidentsApi.reassign(id, userId);
    return fetchWithAuth(`/incidents/${id}/reassign`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  },
};

// Teams
export const teamsApi = {
  list: () => fetchWithAuth("/teams"),
  get: (id: string) => fetchWithAuth(`/teams/${id}`),
  create: (name: string, awsAccountIds?: string[]) =>
    fetchWithAuth("/teams", {
      method: "POST",
      body: JSON.stringify({ name, aws_account_ids: awsAccountIds }),
    }),
  update: (id: string, data: { name?: string; aws_account_ids?: string[]; escalation_policy?: unknown }) =>
    fetchWithAuth(`/teams/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  addMember: (teamId: string, userId: string) =>
    fetchWithAuth(`/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
  removeMember: (teamId: string, userId: string) =>
    fetchWithAuth(`/teams/${teamId}/members/${userId}`, { method: "DELETE" }),
};

// Schedules
export const schedulesApi = {
  current: () => fetchWithAuth("/schedules/current"),
  getByTeam: (teamId: string) => fetchWithAuth(`/schedules/${teamId}`),
  create: (teamId: string, userId: string, start: number, end: number) =>
    fetchWithAuth(`/schedules/${teamId}`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, start, end }),
    }),
  delete: (teamId: string, slotId: string) =>
    fetchWithAuth(`/schedules/${teamId}/${slotId}`, { method: "DELETE" }),
};

// Cloud Demo API (triggers real backend incidents)
export const cloudDemoApi = {
  // Setup creates default team and makes current user on-call
  setup: (awsAccountId?: string) =>
    fetchWithAuth("/demo/setup", {
      method: "POST",
      body: JSON.stringify({ aws_account_id: awsAccountId }),
    }),
  // Start publishes demo alarms to SNS for e2e processing
  start: (awsAccountId?: string) =>
    fetchWithAuth("/demo/start", {
      method: "POST",
      body: JSON.stringify({ aws_account_id: awsAccountId }),
    }),
  // Reset cleans up all demo data (incidents, schedules, team)
  reset: () =>
    fetchWithAuth("/demo/reset", {
      method: "POST",
    }),
};

// Game Mode API
export const gameApi = {
  getConfig: () => fetchWithAuth("/game/config"),
  getSession: () => fetchWithAuth("/game/session"),
  start: (displayName?: string) =>
    fetchWithAuth("/game/start", {
      method: "POST",
      body: JSON.stringify({ display_name: displayName }),
    }),
  end: () => fetchWithAuth("/game/end", { method: "POST" }),
  trigger: (title: string, severity: string, displayName?: string) =>
    fetchWithAuth("/game/trigger", {
      method: "POST",
      body: JSON.stringify({ title, severity, display_name: displayName }),
    }),
  ack: (incidentId: string, displayName?: string) =>
    fetchWithAuth(`/game/ack/${incidentId}`, {
      method: "POST",
      body: JSON.stringify({ display_name: displayName }),
    }),
  getIncidents: () => fetchWithAuth("/game/incidents"),
  getLeaderboard: () => fetchWithAuth("/game/leaderboard"),
};
