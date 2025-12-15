import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import { incidentsApi } from "../lib/api";
import { useNavigation } from "../lib/navigation";
import { useAudio } from "../hooks/useAudio";

// Helper to get cached incident data
function getCachedIncident(queryClient: QueryClient, incidentId: string) {
  return queryClient.getQueryData<{ incident: Incident }>(["incident", incidentId]);
}

interface TimelineEntry {
  timestamp: number;
  event: string;
  actor: string;
  note?: string;
}

interface Incident {
  incident_id: string;
  alarm_name: string;
  alarm_arn: string;
  state: "triggered" | "acked" | "resolved";
  severity: "critical" | "warning" | "info";
  assigned_to: string;
  triggered_at: number;
  acked_at?: number;
  resolved_at?: number;
  timeline: TimelineEntry[];
}

interface IncidentDetailPageProps {
  incidentId: string | null;
}

export default function IncidentDetailPage({ incidentId }: IncidentDetailPageProps) {
  const { goBack } = useNavigation();
  const queryClient = useQueryClient();
  const { playUISound } = useAudio();

  const { data, isLoading } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => incidentsApi.get(incidentId!),
    enabled: !!incidentId,
    // Use cached data for instant display
    initialData: () => incidentId ? getCachedIncident(queryClient, incidentId) : undefined,
    // Keep showing cached data while refetching
    placeholderData: (previousData) => previousData,
    // Background refresh
    refetchInterval: 5000,
  });

  const ackMutation = useMutation({
    mutationFn: () => incidentsApi.ack(incidentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
  });

  const unackMutation = useMutation({
    mutationFn: () => incidentsApi.unack(incidentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
  });

  const incident: Incident | undefined = data?.incident;

  if (!incidentId) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="h-full bg-zinc-900 p-4 text-center text-amber-500 font-mono">{">"} LOADING...</div>
    );
  }

  if (!incident) {
    return (
      <div className="h-full bg-zinc-900 p-4 text-center text-red-500 font-mono">[ERROR] INCIDENT NOT FOUND</div>
    );
  }

  const severityColors = {
    critical: "bg-red-500/20 text-red-500 border border-red-500/50",
    warning: "bg-amber-500/20 text-amber-500 border border-amber-500/50",
    info: "bg-green-500/20 text-green-500 border border-green-500/50",
  };

  return (
    <div className="h-full bg-zinc-900 p-4 overflow-auto">
      {/* Back button */}
      <button
        onClick={() => {
          playUISound("click");
          goBack();
        }}
        className="text-amber-500 font-mono font-bold mb-4 flex items-center gap-1"
      >
        {"<"} BACK
      </button>

      {/* Header */}
      <div className="mb-6">
        <span
          className={`inline-block px-2 py-1 rounded text-sm font-bold font-mono mb-2 ${severityColors[incident.severity]}`}
        >
          {incident.severity.toUpperCase()}
        </span>
        <h1 className="text-xl font-bold text-amber-500 font-mono text-glow">{incident.alarm_name}</h1>
        <p className="text-sm text-amber-500/50 mt-1 break-all font-mono">{incident.alarm_arn}</p>
      </div>

      {/* Status and actions - tap to go back */}
      <div
        onClick={() => {
          playUISound("click");
          goBack();
        }}
        className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-6 cursor-pointer active:bg-zinc-700"
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-amber-500/70 font-mono">STATUS</span>
          <span className="font-bold text-amber-500 font-mono uppercase">{incident.state}</span>
        </div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-amber-500/70 font-mono">ASSIGNED</span>
          <span className="font-bold text-amber-500 font-mono">{incident.assigned_to || "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-amber-500/70 font-mono">TRIGGERED</span>
          <span className="font-bold text-amber-500 font-mono">
            {new Date(incident.triggered_at).toLocaleString()}
          </span>
        </div>
        <p className="text-xs text-amber-500/40 font-mono text-center mt-3">TAP TO GO BACK</p>
      </div>

      {/* Action button - only acknowledge, resolve happens automatically */}
      {incident.state === "triggered" && (
        <div className="mb-6">
          <button
            onClick={() => {
              playUISound("click");
              ackMutation.mutate();
            }}
            disabled={ackMutation.isPending}
            className="w-full py-3 bg-amber-500/20 text-amber-500 rounded border-2 border-amber-500 font-mono font-bold disabled:opacity-50"
          >
            {ackMutation.isPending ? "..." : "ACKNOWLEDGE"}
          </button>
        </div>
      )}

      {/* Status info and unack button for acked incidents */}
      {incident.state === "acked" && (
        <div className="mb-6">
          <div className="p-3 bg-amber-500/10 rounded-t border border-amber-500/30 border-b-0">
            <p className="text-amber-500/80 font-mono text-sm text-center">
              ✓ ACKNOWLEDGED — WAITING FOR AUTO-RESOLVE
            </p>
          </div>
          <button
            onClick={() => {
              playUISound("click");
              unackMutation.mutate();
            }}
            disabled={unackMutation.isPending}
            className="w-full py-2 bg-zinc-800 text-amber-500/70 rounded-b border border-amber-500/30 font-mono text-sm disabled:opacity-50"
          >
            {unackMutation.isPending ? "..." : "UNACKNOWLEDGE"}
          </button>
        </div>
      )}

      {/* Status info for resolved incidents */}
      {incident.state === "resolved" && (
        <div className="mb-6 p-3 bg-green-500/10 rounded border border-green-500/30">
          <p className="text-green-500/80 font-mono text-sm text-center">
            ✓ RESOLVED
          </p>
        </div>
      )}

      {/* Timeline */}
      <div>
        <h2 className="font-bold text-amber-500 font-mono mb-3">{">"} TIMELINE</h2>
        <div className="space-y-3">
          {incident.timeline?.map((entry, i) => (
            <div key={i} className="flex gap-3 text-sm font-mono">
              <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5" />
              <div>
                <p className="font-bold text-amber-500 uppercase">{entry.event}</p>
                <p className="text-amber-500/60">
                  {new Date(entry.timestamp).toLocaleString()} · {entry.actor}
                </p>
                {entry.note && (
                  <p className="text-amber-500/80 mt-1">{entry.note}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
