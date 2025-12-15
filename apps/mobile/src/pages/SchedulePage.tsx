import { useQuery } from "@tanstack/react-query";
import { schedulesApi, teamsApi } from "../lib/api";

interface OnCallEntry {
  user_id: string;
  slot: {
    start: number;
    end: number;
  };
}

interface Team {
  team_id: string;
  name: string;
}

export default function SchedulePage() {
  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: () => teamsApi.list(),
  });

  const { data: currentData, isLoading } = useQuery({
    queryKey: ["schedules", "current"],
    queryFn: () => schedulesApi.current(),
  });

  const teams: Team[] = teamsData?.teams || [];
  const onCall: Record<string, OnCallEntry | null> = currentData?.on_call || {};

  return (
    <div className="h-full bg-zinc-900 p-4 overflow-auto">
      <h1 className="text-xl font-bold text-amber-500 font-mono tracking-wider mb-4">SCHEDULE</h1>

      {isLoading && (
        <div className="text-center text-amber-500 font-mono py-4">{">"} LOADING...</div>
      )}

      {/* Current on-call by team */}
      <div className="space-y-4">
        {teams.map((team) => {
          const entry = onCall[team.team_id];
          return (
            <div key={team.team_id} className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4">
              <h3 className="font-bold text-amber-500 font-mono">{team.name}</h3>
              {entry ? (
                <div className="mt-2">
                  <p className="text-green-500 font-bold font-mono">
                    [ACTIVE] {entry.user_id}
                  </p>
                  <p className="text-sm text-amber-500/60 font-mono">
                    UNTIL {new Date(entry.slot.end).toLocaleString().toUpperCase()}
                  </p>
                </div>
              ) : (
                <p className="text-amber-500/50 mt-2 font-mono">[NONE] NO ONE ON-CALL</p>
              )}
            </div>
          );
        })}
      </div>

      {teams.length === 0 && !isLoading && (
        <div className="text-center text-amber-500/60 py-8 font-mono">
          <p>NO TEAMS FOUND</p>
          <p className="text-sm mt-2 text-amber-500/40">CREATE A TEAM TO MANAGE SCHEDULES</p>
        </div>
      )}
    </div>
  );
}
