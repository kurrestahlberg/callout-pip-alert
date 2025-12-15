import { getActiveBackend } from "./backends";

function getApiUrl(): string {
  const backend = getActiveBackend();
  return backend?.apiUrl || import.meta.env.VITE_API_URL || "";
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
  register: (token: string, platform: string) =>
    fetchWithAuth("/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform }),
    }),
  unregister: (token: string) =>
    fetchWithAuth(`/devices/${encodeURIComponent(token)}`, { method: "DELETE" }),
};

// Incidents
export const incidentsApi = {
  list: (params?: { state?: string; team_id?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return fetchWithAuth(`/incidents${query ? `?${query}` : ""}`);
  },
  get: (id: string) => fetchWithAuth(`/incidents/${id}`),
  ack: (id: string) => fetchWithAuth(`/incidents/${id}/ack`, { method: "POST" }),
  unack: (id: string) => fetchWithAuth(`/incidents/${id}/unack`, { method: "POST" }),
  resolve: (id: string, note?: string) =>
    fetchWithAuth(`/incidents/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  reassign: (id: string, userId: string) =>
    fetchWithAuth(`/incidents/${id}/reassign`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
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
