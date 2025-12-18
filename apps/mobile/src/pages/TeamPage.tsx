import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teamsApi, gameApi } from "../lib/api";
import { useAudio } from "../hooks/useAudio";
import { useAuth } from "../lib/auth";

interface Team {
  team_id: string;
  name: string;
  aws_account_ids: string[];
}

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  high_score: number;
  total_points: number;
  total_acks: number;
}

export default function TeamPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newAwsAccounts, setNewAwsAccounts] = useState("");
  const [gameEnabled, setGameEnabled] = useState(false);
  const queryClient = useQueryClient();
  const { playUISound } = useAudio();
  const { user, isAuthenticated } = useAuth();

  // Check if game mode is enabled
  useEffect(() => {
    async function checkGameConfig() {
      try {
        const config = await gameApi.getConfig();
        setGameEnabled(config.enabled);
      } catch (e) {
        console.log("[Game] Config check failed:", e);
      }
    }
    if (isAuthenticated) {
      checkGameConfig();
    }
  }, [isAuthenticated]);

  // Leaderboard query
  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => gameApi.getLeaderboard(),
    enabled: gameEnabled && isAuthenticated,
    refetchInterval: 30000, // Refresh every 30s
  });

  // Teams query
  const { data: teamsData, isLoading: teamsLoading } = useQuery({
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

  const teams: Team[] = teamsData?.teams || [];
  const leaderboard: LeaderboardEntry[] = leaderboardData?.leaderboard || [];
  const userScore = leaderboardData?.user;
  const currentUserId = user?.getUsername();

  return (
    <div className="h-full bg-zinc-900 p-4 overflow-auto">
      {/* Leaderboard Section */}
      {gameEnabled && isAuthenticated && (
        <div className="mb-6">
          <h1 className="text-xl font-bold text-green-500 font-mono tracking-wider mb-4">LEADERBOARD</h1>

          {leaderboardLoading && (
            <div className="text-center text-green-500 font-mono py-4">{">"} LOADING...</div>
          )}

          {/* User's score */}
          {userScore && (
            <div className="bg-zinc-800 rounded border-2 border-green-500/50 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-green-500/60 font-mono">YOUR STATS</p>
                  <p className="text-lg font-bold text-green-500 font-mono">{userScore.display_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-500 font-mono">{userScore.total_points}</p>
                  <p className="text-xs text-green-500/60 font-mono">TOTAL POINTS</p>
                </div>
              </div>
              <div className="flex justify-between mt-2 text-xs text-green-500/60 font-mono">
                <span>ACKS: {userScore.total_acks}</span>
              </div>
            </div>
          )}

          {/* Top players */}
          {leaderboard.length > 0 ? (
            <div className="space-y-2">
              {leaderboard.map((entry) => (
                <div
                  key={entry.user_id}
                  className={`bg-zinc-800 rounded border-2 p-3 flex items-center justify-between ${
                    entry.user_id === currentUserId
                      ? "border-green-500/50 bg-green-500/10"
                      : "border-amber-500/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xl font-bold font-mono w-8 ${
                        entry.rank === 1
                          ? "text-yellow-500"
                          : entry.rank === 2
                          ? "text-gray-400"
                          : entry.rank === 3
                          ? "text-amber-700"
                          : "text-amber-500/50"
                      }`}
                    >
                      #{entry.rank}
                    </span>
                    <div>
                      <p className={`font-bold font-mono ${entry.user_id === currentUserId ? "text-green-500" : "text-amber-500"}`}>
                        {entry.display_name}
                      </p>
                      <p className="text-xs text-amber-500/40 font-mono">
                        {entry.total_points} pts • {entry.total_acks} acks
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-bold font-mono ${entry.user_id === currentUserId ? "text-green-500" : "text-amber-500"}`}>
                      {entry.total_points}
                    </p>
                    <p className="text-xs text-amber-500/40 font-mono">pts</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !leaderboardLoading && (
              <div className="text-center text-green-500/60 py-4 font-mono">
                <p>NO SCORES YET</p>
                <p className="text-sm mt-2 text-green-500/40">PLAY A GAME TO GET ON THE BOARD!</p>
              </div>
            )
          )}
        </div>
      )}

      {/* Teams Section */}
      <div>
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

        {teamsLoading && (
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

        {teams.length === 0 && !teamsLoading && !showCreate && (
          <div className="text-center text-amber-500/60 py-8 font-mono">
            <p>NO TEAMS YET</p>
            <p className="text-sm mt-2 text-amber-500/40">CREATE YOUR FIRST TEAM TO GET STARTED</p>
          </div>
        )}
      </div>
    </div>
  );
}
