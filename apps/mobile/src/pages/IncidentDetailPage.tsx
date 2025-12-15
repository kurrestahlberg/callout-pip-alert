import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { incidentsApi } from "../lib/api";
import { useNavigation } from "../lib/navigation";

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

  const { data, isLoading } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => incidentsApi.get(incidentId!),
    enabled: !!incidentId,
  });

  const ackMutation = useMutation({
    mutationFn: () => incidentsApi.ack(incidentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => incidentsApi.resolve(incidentId!),
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
      <div className="min-h-full bg-zinc-900 p-4 text-center text-amber-500 font-mono">{">"} LOADING...</div>
    );
  }

  if (!incident) {
    return (
      <div className="min-h-full bg-zinc-900 p-4 text-center text-red-500 font-mono">[ERROR] INCIDENT NOT FOUND</div>
    );
  }

  const severityColors = {
    critical: "bg-red-500/20 text-red-500 border border-red-500/50",
    warning: "bg-amber-500/20 text-amber-500 border border-amber-500/50",
    info: "bg-green-500/20 text-green-500 border border-green-500/50",
  };

  return (
    <div className="min-h-full bg-zinc-900 p-4 overflow-auto">
      {/* Back button */}
      <button
        onClick={goBack}
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

      {/* Status and actions */}
      <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-6">
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
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-6">
        {incident.state === "triggered" && (
          <button
            onClick={() => ackMutation.mutate()}
            disabled={ackMutation.isPending}
            className="flex-1 py-3 bg-amber-500/20 text-amber-500 rounded border-2 border-amber-500 font-mono font-bold disabled:opacity-50"
          >
            {ackMutation.isPending ? "..." : "ACKNOWLEDGE"}
          </button>
        )}
        {incident.state !== "resolved" && (
          <button
            onClick={() => resolveMutation.mutate()}
            disabled={resolveMutation.isPending}
            className="flex-1 py-3 bg-green-500 text-zinc-900 rounded font-mono font-bold disabled:opacity-50"
          >
            {resolveMutation.isPending ? "..." : "RESOLVE"}
          </button>
        )}
      </div>

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
