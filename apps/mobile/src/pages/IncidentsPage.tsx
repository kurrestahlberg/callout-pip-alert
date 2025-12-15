import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { incidentsApi } from "../lib/api";

type IncidentState = "triggered" | "acked" | "resolved";

interface Incident {
  incident_id: string;
  alarm_name: string;
  state: IncidentState;
  severity: "critical" | "warning" | "info";
  triggered_at: number;
  team_id: string;
}

const severityDotColors: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

const severityTextColors: Record<string, string> = {
  critical: "text-red-600",
  warning: "text-amber-600",
  info: "text-blue-600",
};

const stateBadgeColors: Record<IncidentState, string> = {
  triggered: "bg-red-100 text-red-700",
  acked: "bg-amber-100 text-amber-700",
  resolved: "bg-green-100 text-green-700",
};

export default function IncidentsPage() {
  const [filter, setFilter] = useState<IncidentState | "all">("all");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["incidents", filter],
    queryFn: () => incidentsApi.list(filter !== "all" ? { state: filter } : undefined),
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) => incidentsApi.ack(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incidents"] }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => incidentsApi.resolve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incidents"] }),
  });

  const incidents: Incident[] = data?.incidents || [];

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Incidents</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {(["all", "triggered", "acked", "resolved"] as const).map((state) => (
          <button
            key={state}
            onClick={() => setFilter(state)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
              filter === state
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {state.charAt(0).toUpperCase() + state.slice(1)}
          </button>
        ))}
      </div>

      {/* Pull to refresh indicator */}
      {isLoading && (
        <div className="text-center text-gray-500 py-4">Loading...</div>
      )}

      {/* Incident list */}
      <div className="space-y-3">
        <AnimatePresence>
          {incidents.map((incident) => (
            <motion.div
              key={incident.incident_id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              drag="x"
              dragConstraints={{ left: -100, right: 100 }}
              onDragEnd={(_, info) => {
                if (info.offset.x < -50 && incident.state === "triggered") {
                  ackMutation.mutate(incident.incident_id);
                } else if (info.offset.x > 50 && incident.state !== "resolved") {
                  resolveMutation.mutate(incident.incident_id);
                }
              }}
              onClick={() => navigate(`/incidents/${incident.incident_id}`)}
              className="bg-white rounded-lg shadow p-4 cursor-pointer active:bg-gray-50"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-3 h-3 rounded-full mt-1.5 ${severityDotColors[incident.severity]}`}
                />
                <div className="flex-1 min-w-0">
                  <h3 className={`font-medium truncate ${severityTextColors[incident.severity]}`}>
                    {incident.alarm_name}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {new Date(incident.triggered_at).toLocaleString()}
                  </p>
                  <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${stateBadgeColors[incident.state]}`}>
                    {incident.state}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {incidents.length === 0 && !isLoading && (
        <div className="text-center text-gray-500 py-8">
          No incidents found
        </div>
      )}

      {/* Swipe hint */}
      <p className="text-xs text-gray-400 text-center mt-6">
        Swipe left to acknowledge, right to resolve
      </p>
    </div>
  );
}
