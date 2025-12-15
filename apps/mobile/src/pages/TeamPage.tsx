import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teamsApi } from "../lib/api";
import { useAudio } from "../hooks/useAudio";

interface Team {
  team_id: string;
  name: string;
  aws_account_ids: string[];
}

export default function TeamPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newAwsAccounts, setNewAwsAccounts] = useState("");
  const queryClient = useQueryClient();
  const { playUISound } = useAudio();

  const { data, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: () => teamsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const accounts = newAwsAccounts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return teamsApi.create(newTeamName, accounts);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setShowCreate(false);
      setNewTeamName("");
      setNewAwsAccounts("");
    },
  });

  const teams: Team[] = data?.teams || [];

  return (
    <div className="h-full bg-zinc-900 p-4 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-amber-500 font-mono tracking-wider">TEAMS</h1>
        <button
          onClick={() => {
            playUISound("click");
            setShowCreate(!showCreate);
          }}
          className="text-amber-500 font-mono font-bold"
        >
          {showCreate ? "[CANCEL]" : "[+ NEW]"}
        </button>
      </div>

      {/* Create team form */}
      {showCreate && (
        <div className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4 mb-4">
          <input
            type="text"
            placeholder="Team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-900 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 mb-3 text-base"
          />
          <input
            type="text"
            placeholder="AWS Account IDs (comma separated)"
            value={newAwsAccounts}
            onChange={(e) => setNewAwsAccounts(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-900 border-2 border-amber-500/30 rounded text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 mb-3 text-base"
          />
          <button
            onClick={() => {
              playUISound("click");
              createMutation.mutate();
            }}
            disabled={!newTeamName || createMutation.isPending}
            className="w-full py-2 bg-amber-500 text-zinc-900 rounded font-mono font-bold disabled:opacity-50"
          >
            {createMutation.isPending ? "CREATING..." : "CREATE TEAM"}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-center text-amber-500 font-mono py-4">{">"} LOADING...</div>
      )}

      {/* Team list */}
      <div className="space-y-3">
        {teams.map((team) => (
          <div key={team.team_id} className="bg-zinc-800 rounded border-2 border-amber-500/30 p-4">
            <h3 className="font-bold text-amber-500 font-mono">{team.name}</h3>
            {team.aws_account_ids.length > 0 && (
              <p className="text-sm text-amber-500/60 mt-1 font-mono">
                AWS: {team.aws_account_ids.join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>

      {teams.length === 0 && !isLoading && !showCreate && (
        <div className="text-center text-amber-500/60 py-8 font-mono">
          <p>NO TEAMS YET</p>
          <p className="text-sm mt-2 text-amber-500/40">CREATE YOUR FIRST TEAM TO GET STARTED</p>
        </div>
      )}
    </div>
  );
}
