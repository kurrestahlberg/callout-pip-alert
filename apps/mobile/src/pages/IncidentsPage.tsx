import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { incidentsApi } from "../lib/api";
import { useNavigation } from "../lib/navigation";
import { useAudio } from "../hooks/useAudio";
import { useCriticalAlertDetection } from "../hooks/useCriticalAlertDetection";

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
  assigned_to?: string;
  acked_by?: string;
}

const severityOrder: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const severityConfig: Record<Severity, { dot: string; text: string; cardBg: string; border: string }> = {
  critical: {
    dot: "bg-red-500 animate-pulse",
    text: "text-red-500",
    cardBg: "bg-red-500/15",
    border: "border-l-red-500",
  },
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-500",
    cardBg: "bg-amber-500/10",
    border: "border-l-amber-500",
  },
  info: {
    dot: "bg-green-500",
    text: "text-green-500",
    cardBg: "bg-green-500/10",
    border: "border-l-green-500",
  },
};

// Tab configuration
type TabKey = "alarms" | "unacked" | "history";
const FILTER_TABS: { key: TabKey; label: string; states: IncidentState[] }[] = [
  { key: "alarms", label: "ALARMS", states: ["triggered", "acked"] },
  { key: "unacked", label: "UNACKED", states: ["triggered"] },
  { key: "history", label: "HISTORY", states: ["resolved"] },
];

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

export default function IncidentsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("alarms");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const { navigate } = useNavigation();
  const queryClient = useQueryClient();
  const { playAlert, playUISound, settings, startAmbient, stopAmbient, setAmbientIntensity, isInitialized } = useAudio();

  const currentTab = FILTER_TABS.find(t => t.key === activeTab)!;

  // Fetch all incidents and filter client-side for tabs with multiple states
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["incidents"],
    queryFn: () => incidentsApi.list(),
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Pre-fetch all incident details when list loads
  useEffect(() => {
    if (data?.incidents) {
      data.incidents.forEach((incident: Incident) => {
        // Prefetch full incident details
        queryClient.prefetchQuery({
          queryKey: ["incident", incident.incident_id],
          queryFn: () => incidentsApi.get(incident.incident_id),
          staleTime: 1000 * 30, // 30 seconds
        });
      });
    }
  }, [data?.incidents, queryClient]);

  // Handle new critical incident alert
  const handleNewCritical = useCallback((incident: Incident) => {
    playAlert("critical");
    console.log("[ALERT] New critical incident:", incident.alarm_name);
  }, [playAlert]);

  // Detect new critical incidents and play alert sound
  useCriticalAlertDetection(data?.incidents, {
    onNewCritical: handleNewCritical,
    enabled: settings.categories.alerts,
  });

  // Filter by active tab's states, then sort by severity and time
  const incidents = useMemo(() => {
    const items: Incident[] = data?.incidents || [];
    return items
      .filter((i) => currentTab.states.includes(i.state))
      .sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.triggered_at - a.triggered_at;
      });
  }, [data?.incidents, currentTab.states]);

  // Count unacked critical for badge (from all data, not filtered)
  const unackedCriticalCount = useMemo(() => {
    const items: Incident[] = data?.incidents || [];
    return items.filter((i) => i.state === "triggered" && i.severity === "critical").length;
  }, [data?.incidents]);

  // Geiger ambient based on critical unacked count
  useEffect(() => {
    if (!isInitialized || !settings.categories.ambient) {
      stopAmbient();
      return;
    }

    if (unackedCriticalCount > 0) {
      // Start ambient and set intensity based on count
      // More criticals = more frequent clicks (max intensity at 5+ criticals)
      const intensity = Math.min(1, unackedCriticalCount / 5);
      startAmbient();
      setAmbientIntensity(intensity);
    } else {
      stopAmbient();
    }

    return () => {
      stopAmbient();
    };
  }, [unackedCriticalCount, isInitialized, settings.categories.ambient, startAmbient, stopAmbient, setAmbientIntensity]);

  // Count alarms (triggered + acked)
  const alarmsCount = useMemo(() => {
    const items: Incident[] = data?.incidents || [];
    return items.filter((i) => i.state === "triggered" || i.state === "acked").length;
  }, [data?.incidents]);

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
      const currentIndex = FILTER_TABS.findIndex(t => t.key === activeTab);
      if (deltaX < 0 && currentIndex < FILTER_TABS.length - 1) {
        // Swipe left -> next tab
        setActiveTab(FILTER_TABS[currentIndex + 1].key);
      } else if (deltaX > 0 && currentIndex > 0) {
        // Swipe right -> previous tab
        setActiveTab(FILTER_TABS[currentIndex - 1].key);
      }
    }

    touchStartRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      className="h-full bg-zinc-900 overflow-auto"
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
          {unackedCriticalCount > 0 && (
            <span className="bg-red-500/20 text-red-500 text-sm font-bold font-mono px-2 py-1 rounded border border-red-500/50 pulse-glow-red text-glow-red flex items-center gap-2">
              {unackedCriticalCount} <span className="text-xl leading-none -mt-0.5">☢</span>
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 pb-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                if (activeTab !== tab.key) {
                  playUISound("click");
                  setActiveTab(tab.key);
                }
              }}
              className={`flex-1 px-3 py-1.5 rounded text-sm font-bold font-mono whitespace-nowrap transition-colors border ${
                activeTab === tab.key
                  ? "bg-amber-500 text-zinc-900 border-amber-500"
                  : "bg-zinc-900 text-amber-500/70 border-amber-500/30 hover:border-amber-500/50"
              }`}
            >
              {tab.key === "alarms" && alarmsCount > 0 ? `${tab.label} (${alarmsCount})` : tab.label}
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
              onClick={() => {
                playUISound("click");
                navigate("incident-detail", { incidentId: incident.incident_id });
              }}
            />
          ))}
        </AnimatePresence>
      </div>

      {incidents.length === 0 && !isLoading && (
        <div className="text-center py-12">
          {activeTab === "alarms" ? (
            <>
              <div className="text-green-500 text-4xl mb-2 font-mono text-glow-green">[OK]</div>
              <p className="text-amber-500/60 font-mono">NO ACTIVE ALARMS</p>
            </>
          ) : activeTab === "unacked" ? (
            <>
              <div className="text-green-500 text-4xl mb-2 font-mono text-glow-green">[OK]</div>
              <p className="text-amber-500/60 font-mono">ALL ALARMS ACKNOWLEDGED</p>
            </>
          ) : (
            <>
              <div className="text-amber-500/50 text-4xl mb-2 font-mono">[...]</div>
              <p className="text-amber-500/60 font-mono">NO HISTORY</p>
            </>
          )}
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
  const isAcked = incident.state === "acked";
  const isResolved = incident.state === "resolved";
  const isCriticalTriggered = incident.severity === "critical" && incident.state === "triggered";

  // Card styling based on state
  const cardClasses = isAcked || isResolved
    ? "bg-zinc-800/60 opacity-75" // Muted for acked/resolved
    : config.cardBg; // Severity-based background for triggered

  return (
    <motion.div
      layout="position"
      layoutId={incident.incident_id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15, layout: { duration: 0.15 } }}
      onClick={onClick}
      className={`${cardClasses} rounded border-l-4 ${config.border} cursor-pointer active:bg-zinc-700 overflow-hidden border border-amber-500/20 ${isCriticalTriggered ? "pulse-glow-red" : ""}`}
    >
      <div className="p-3">
        {/* Top row: severity indicator + time + ack badge */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isAcked || isResolved ? "bg-zinc-500" : config.dot}`} />
            <span className={`text-sm font-bold font-mono uppercase tracking-wider ${isAcked || isResolved ? "text-zinc-400" : config.text}`}>
              {incident.severity}
            </span>
            {/* Ack checkmark badge with person's name */}
            {isAcked && (
              <span className="flex items-center gap-1 text-xs font-mono text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {incident.acked_by || incident.assigned_to || "ACK"}
              </span>
            )}
            {/* Resolved badge */}
            {isResolved && (
              <span className="flex items-center gap-1 text-xs font-mono text-green-500/70 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/30">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                OK
              </span>
            )}
          </div>
          <span className="text-sm text-amber-500/50 font-mono">
            {relativeTime(incident.triggered_at)}
          </span>
        </div>

        {/* Alarm name */}
        <h3 className={`font-medium mb-2 leading-snug font-mono text-base ${isAcked || isResolved ? "text-amber-500/60" : "text-amber-500"}`}>
          {incident.alarm_name}
        </h3>

        {/* Bottom row: AWS account */}
        {incident.aws_account_id && (
          <div className="flex items-center justify-end">
            <span className="text-sm text-amber-500/40 font-mono">
              {incident.aws_account_id}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
