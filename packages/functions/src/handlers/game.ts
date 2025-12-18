import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { docClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } from "../lib/dynamo.js";
import { jsonResponse, getUserIdFromEvent } from "../types/index.js";
import { randomUUID } from "crypto";

const SCORES_TABLE = process.env.SCORES_TABLE!;
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;
const GAME_MODE_ENABLED = process.env.GAME_MODE_ENABLED === "true";

// Game settings
const ROUND_DURATION_MS = 60000; // 60 seconds
const TRIGGER_COOLDOWN_MS = 200;
const GLOBAL_SESSION_KEY = "GLOBAL_SESSION";

const SEVERITIES: Record<string, number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

// Get global session
async function getGlobalSession(): Promise<{ active: boolean; endsAt?: number; startedBy?: string }> {
  const result = await docClient.send(
    new GetCommand({
      TableName: SCORES_TABLE,
      Key: { user_id: GLOBAL_SESSION_KEY },
    })
  );

  const item = result.Item;
  if (!item?.session_ends_at) return { active: false };

  if (Date.now() > item.session_ends_at) {
    return { active: false };
  }

  return {
    active: true,
    endsAt: item.session_ends_at,
    startedBy: item.started_by,
  };
}

// Cleanup all game incidents
async function cleanupGameIncidents(): Promise<number> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: INCIDENTS_TABLE,
      FilterExpression: "game = :game",
      ExpressionAttributeValues: { ":game": true },
      ProjectionExpression: "incident_id",
    })
  );

  const items = result.Items || [];
  for (const item of items) {
    await docClient.send(
      new DeleteCommand({
        TableName: INCIDENTS_TABLE,
        Key: { incident_id: item.incident_id },
      })
    );
  }

  return items.length;
}

// End global session and cleanup
async function endGlobalSession(): Promise<{ deleted: number }> {
  // Clear session
  await docClient.send(
    new DeleteCommand({
      TableName: SCORES_TABLE,
      Key: { user_id: GLOBAL_SESSION_KEY },
    })
  );

  // Cleanup all game incidents
  const deleted = await cleanupGameIncidents();

  return { deleted };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getUserIdFromEvent(event);
  if (!userId) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /game/config
    if (method === "GET" && path === "/game/config") {
      return jsonResponse(200, {
        enabled: GAME_MODE_ENABLED,
        roundDurationMs: ROUND_DURATION_MS,
      });
    }

    if (!GAME_MODE_ENABLED) {
      return jsonResponse(403, { error: "Game mode is disabled" });
    }

    // Check if session expired and auto-cleanup
    const session = await getGlobalSession();
    if (!session.active) {
      // Check if there's an expired session to cleanup
      const rawSession = await docClient.send(
        new GetCommand({
          TableName: SCORES_TABLE,
          Key: { user_id: GLOBAL_SESSION_KEY },
        })
      );
      if (rawSession.Item?.session_ends_at) {
        await endGlobalSession();
      }
    }

    // POST /game/start - Start global 60s round
    if (method === "POST" && path === "/game/start") {
      const currentSession = await getGlobalSession();
      if (currentSession.active) {
        return jsonResponse(400, {
          error: "Game already in progress",
          ends_at: currentSession.endsAt,
          started_by: currentSession.startedBy,
          time_remaining_ms: currentSession.endsAt! - Date.now(),
        });
      }

      const body = JSON.parse(event.body || "{}");
      const displayName = body.display_name || userId.split("@")[0];
      const now = Date.now();
      const endsAt = now + ROUND_DURATION_MS;

      await docClient.send(
        new PutCommand({
          TableName: SCORES_TABLE,
          Item: {
            user_id: GLOBAL_SESSION_KEY,
            game_type: "session",
            session_ends_at: endsAt,
            started_at: now,
            started_by: displayName,
          },
        })
      );

      return jsonResponse(200, {
        ends_at: endsAt,
        duration_ms: ROUND_DURATION_MS,
        started_by: displayName,
      });
    }

    // POST /game/end - End game early
    if (method === "POST" && path === "/game/end") {
      const currentSession = await getGlobalSession();
      if (!currentSession.active) {
        return jsonResponse(400, { error: "No active game" });
      }

      const { deleted } = await endGlobalSession();

      return jsonResponse(200, {
        message: "Game ended",
        incidents_deleted: deleted,
      });
    }

    // GET /game/session - Get current session status
    if (method === "GET" && path === "/game/session") {
      const currentSession = await getGlobalSession();
      if (!currentSession.active) {
        return jsonResponse(200, { active: false });
      }

      return jsonResponse(200, {
        active: true,
        ends_at: currentSession.endsAt,
        time_remaining_ms: currentSession.endsAt! - Date.now(),
        started_by: currentSession.startedBy,
      });
    }

    // POST /game/trigger - Trigger alarm
    if (method === "POST" && path === "/game/trigger") {
      const currentSession = await getGlobalSession();
      if (!currentSession.active) {
        return jsonResponse(400, { error: "No active game. Start a game first!" });
      }

      const body = JSON.parse(event.body || "{}");
      const title = body.title?.trim();
      const severity = body.severity || "warning";
      const displayName = body.display_name || userId.split("@")[0];

      if (!title) {
        return jsonResponse(400, { error: "Title is required" });
      }

      if (title.length > 50) {
        return jsonResponse(400, { error: "Title too long (max 50 chars)" });
      }

      const multiplier = SEVERITIES[severity] || 2;
      const incidentId = `game-${randomUUID()}`;
      const now = Date.now();

      await docClient.send(
        new PutCommand({
          TableName: INCIDENTS_TABLE,
          Item: {
            incident_id: incidentId,
            alarm_name: `[GAME] ${title}`,
            severity,
            state: "triggered",
            team_id: "game",
            triggered_by: userId,
            triggered_by_name: displayName,
            created_at: now,
            game: true,
            point_multiplier: multiplier,
          },
        })
      );

      // Cooldown before responding
      await new Promise((resolve) => setTimeout(resolve, TRIGGER_COOLDOWN_MS));

      return jsonResponse(200, {
        incident_id: incidentId,
        title: `[GAME] ${title}`,
        time_remaining_ms: currentSession.endsAt! - Date.now(),
      });
    }

    // POST /game/ack/{id} - Ack alarm
    if (method === "POST" && path.match(/^\/game\/ack\/[^/]+$/)) {
      const currentSession = await getGlobalSession();
      if (!currentSession.active) {
        return jsonResponse(400, { error: "No active game" });
      }

      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        return jsonResponse(400, { error: "Missing incident ID" });
      }

      const body = JSON.parse(event.body || "{}");
      const displayName = body.display_name || userId.split("@")[0];

      const incidentResult = await docClient.send(
        new GetCommand({
          TableName: INCIDENTS_TABLE,
          Key: { incident_id: incidentId },
        })
      );

      if (!incidentResult.Item) {
        return jsonResponse(404, { error: "Incident not found" });
      }

      const incident = incidentResult.Item;

      if (!incident.game) {
        return jsonResponse(400, { error: "Not a game incident" });
      }

      if (incident.state !== "triggered") {
        return jsonResponse(200, {
          success: false,
          message: `Too slow! ${incident.acked_by_name || "Someone"} got it first`,
          points: 0,
        });
      }

      // Calculate points
      const ackTime = Date.now() - incident.created_at;
      const speedBonus = ackTime < 2000 ? 2 : ackTime < 4000 ? 1.5 : 1;
      const points = Math.round(10 * (incident.point_multiplier || 1) * speedBonus);

      // Conditional update
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: INCIDENTS_TABLE,
            Key: { incident_id: incidentId },
            UpdateExpression: "SET #state = :acked, acked_by = :uid, acked_by_name = :name, acked_at = :now",
            ConditionExpression: "#state = :triggered",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: {
              ":acked": "acked",
              ":triggered": "triggered",
              ":uid": userId,
              ":name": displayName,
              ":now": Date.now(),
            },
          })
        );
      } catch (e: unknown) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
          return jsonResponse(200, {
            success: false,
            message: "Too slow! Someone else got it first",
            points: 0,
          });
        }
        throw e;
      }

      // Update user score
      await docClient.send(
        new UpdateCommand({
          TableName: SCORES_TABLE,
          Key: { user_id: userId },
          UpdateExpression: `
            SET display_name = if_not_exists(display_name, :name),
                game_type = :gt,
                high_score = if_not_exists(high_score, :zero),
                total_points = if_not_exists(total_points, :zero) + :points,
                total_acks = if_not_exists(total_acks, :zero) + :one
          `,
          ExpressionAttributeValues: {
            ":name": displayName,
            ":gt": "default",
            ":zero": 0,
            ":points": points,
            ":one": 1,
          },
        })
      );

      return jsonResponse(200, {
        success: true,
        points,
        message: `+${points} points!`,
        time_remaining_ms: currentSession.endsAt! - Date.now(),
      });
    }

    // GET /game/incidents - Get active game incidents
    if (method === "GET" && path === "/game/incidents") {
      const result = await docClient.send(
        new ScanCommand({
          TableName: INCIDENTS_TABLE,
          FilterExpression: "game = :game AND #state = :triggered",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":game": true, ":triggered": "triggered" },
        })
      );

      return jsonResponse(200, {
        incidents: result.Items || [],
      });
    }

    // GET /game/leaderboard
    if (method === "GET" && path === "/game/leaderboard") {
      const result = await docClient.send(
        new QueryCommand({
          TableName: SCORES_TABLE,
          IndexName: "leaderboard-index",
          KeyConditionExpression: "game_type = :gt",
          ExpressionAttributeValues: { ":gt": "default" },
          ScanIndexForward: false,
          Limit: 20,
        })
      );

      const leaderboard = (result.Items || []).map((item, index) => ({
        rank: index + 1,
        user_id: item.user_id,
        display_name: item.display_name || item.user_id.split("@")[0],
        total_points: item.total_points || 0,
        total_acks: item.total_acks || 0,
      }));

      // Get current user's score
      const userResult = await docClient.send(
        new GetCommand({
          TableName: SCORES_TABLE,
          Key: { user_id: userId },
        })
      );

      const user = userResult.Item
        ? {
            user_id: userResult.Item.user_id,
            display_name: userResult.Item.display_name || userId.split("@")[0],
            total_points: userResult.Item.total_points || 0,
            total_acks: userResult.Item.total_acks || 0,
          }
        : null;

      return jsonResponse(200, { leaderboard, user });
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (error) {
    console.error("Error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
