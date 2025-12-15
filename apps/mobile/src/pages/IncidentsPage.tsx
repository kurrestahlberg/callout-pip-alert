import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { incidentsApi } from "../lib/api";
import { useNavigation } from "../lib/navigation";

type IncidentState = "triggered" | "acked" | "resolved";
type Severity = "critical" | "warning" | "info";

interface Incident {
  incident_id: string;
  alarm_name: string;
  state: IncidentState;
  severity: Severity;
  triggered_at: number;
  team_id: string;
  aws_account_id?: string;
}

const severityOrder: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const severityConfig: Record<Severity, { dot: string; text: string; bg: string; border: string }> = {
  critical: {
    dot: "bg-red-500 animate-pulse",
    text: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-l-red-500",
  },
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-l-amber-500",
  },
  info: {
    dot: "bg-green-500",
    text: "text-green-500",
    bg: "bg-green-500/10",
    border: "border-l-green-500",
  },
};

const stateConfig: Record<IncidentState, { label: string; bg: string }> = {
  triggered: { label: "TRIGGERED", bg: "bg-red-500/20 text-red-500 border border-red-500/50" },
  acked: { label: "ACKNOWLEDGED", bg: "bg-amber-500/20 text-amber-500 border border-amber-500/50" },
  resolved: { label: "RESOLVED", bg: "bg-green-500/20 text-green-500 border border-green-500/50" },
};

function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

const FILTER_TABS = ["all", "triggered", "acked", "resolved"] as const;

export default function IncidentsPage() {
  const [filter, setFilter] = useState<IncidentState | "all">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const { navigate } = useNavigation();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["incidents", filter],
    queryFn: () => incidentsApi.list(filter !== "all" ? { state: filter } : undefined),
  });

  // Sort: severity first (critical > warning > info), then by time (newest first)
  const incidents = useMemo(() => {
    const items: Incident[] = data?.incidents || [];
    return [...items].sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.triggered_at - a.triggered_at;
    });
  }, [data?.incidents]);

  const triggeredCount = incidents.filter((i) => i.state === "triggered").length;

  // Touch handlers for pull-to-refresh and tab swiping
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    // Pull to refresh (vertical)
    if (containerRef.current?.scrollTop === 0) {
      const distance = e.touches[0].clientY - touchStartRef.current.y;
      if (distance > 0 && distance < 150) {
        setPullDistance(distance);
      }
    }
  };

  const handleTouchEnd = async (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - touchStartRef.current.x;
    const deltaY = endY - touchStartRef.current.y;

    // Pull to refresh
    if (pullDistance > 80) {
      setIsRefreshing(true);
      await refetch();
      setIsRefreshing(false);
    }
    setPullDistance(0);

    // Horizontal swipe for tab navigation (only if horizontal movement > vertical)
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      const currentIndex = FILTER_TABS.indexOf(filter);
      if (deltaX < 0 && currentIndex < FILTER_TABS.length - 1) {
        // Swipe left -> next tab
        setFilter(FILTER_TABS[currentIndex + 1]);
      } else if (deltaX > 0 && currentIndex > 0) {
        // Swipe right -> previous tab
        setFilter(FILTER_TABS[currentIndex - 1]);
      }
    }

    touchStartRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      className="min-h-full bg-zinc-900 overflow-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull to refresh indicator */}
      <div
        className="flex justify-center items-center overflow-hidden transition-all"
        style={{ height: pullDistance > 0 ? pullDistance : 0 }}
      >
        <div className={`${isRefreshing ? 'animate-spin' : ''}`}>
          <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
      </div>

      {/* Header */}
      <div className="bg-zinc-800 border-b-2 border-amber-500/30 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-amber-500 font-mono tracking-wider text-glow">ALERTS</h1>
          {triggeredCount > 0 && (
            <span className="bg-red-500/20 text-red-500 text-sm font-bold font-mono px-2 py-1 rounded border border-red-500/50 pulse-glow-red text-glow-red">
              {triggeredCount} ACTIVE
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["all", "triggered", "acked", "resolved"] as const).map((state) => (
            <button
              key={state}
              onClick={() => setFilter(state)}
              className={`px-3 py-1.5 rounded text-sm font-bold font-mono whitespace-nowrap transition-colors border ${
                filter === state
                  ? "bg-amber-500 text-zinc-900 border-amber-500"
                  : "bg-zinc-900 text-amber-500/70 border-amber-500/30 hover:border-amber-500/50"
              }`}
            >
              {state === "all" ? "ALL" : stateConfig[state].label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center text-amber-500 font-mono py-8">{">"} LOADING INCIDENTS...</div>
      )}

      {/* Incident list */}
      <div className="p-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.incident_id}
              incident={incident}
              onClick={() => navigate("incident-detail", { incidentId: incident.incident_id })}
            />
          ))}
        </AnimatePresence>
      </div>

      {incidents.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <div className="text-green-500 text-4xl mb-2 font-mono text-glow-green">[OK]</div>
          <p className="text-amber-500/60 font-mono">NO ACTIVE INCIDENTS</p>
        </div>
      )}

      {/* Swipe hint for tab navigation */}
      {incidents.length > 0 && (
        <p className="text-sm text-amber-500/40 text-center py-4 font-mono">
          {"<"} SWIPE TO CHANGE FILTER {">"}
        </p>
      )}
    </div>
  );
}

function IncidentCard({
  incident,
  onClick
}: {
  incident: Incident;
  onClick: () => void;
}) {
  const config = severityConfig[incident.severity];
  const state = stateConfig[incident.state];

  const isCriticalTriggered = incident.severity === "critical" && incident.state === "triggered";

  return (
    <motion.div
      layout="position"
      layoutId={incident.incident_id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15, layout: { duration: 0.15 } }}
      onClick={onClick}
      className={`bg-zinc-800 rounded border-l-4 ${config.border} cursor-pointer active:bg-zinc-700 overflow-hidden border border-amber-500/20 ${isCriticalTriggered ? "pulse-glow-red" : ""}`}
    >
      <div className="p-3">
        {/* Top row: severity indicator + time */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${config.dot}`} />
            <span className={`text-sm font-bold font-mono uppercase tracking-wider ${config.text}`}>
              {incident.severity}
            </span>
          </div>
          <span className="text-sm text-amber-500/50 font-mono">
            {relativeTime(incident.triggered_at)}
          </span>
        </div>

        {/* Alarm name */}
        <h3 className="font-medium text-amber-500 mb-2 leading-snug font-mono text-base">
          {incident.alarm_name}
        </h3>

        {/* Bottom row: state badge */}
        <div className="flex items-center justify-between">
          <span className={`text-sm font-bold font-mono px-2 py-0.5 rounded ${state.bg}`}>
            {state.label}
          </span>
          {incident.aws_account_id && (
            <span className="text-sm text-amber-500/40 font-mono">
              {incident.aws_account_id}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
