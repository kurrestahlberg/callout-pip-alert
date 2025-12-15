import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { docClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand } from "../lib/dynamo.js";
import { jsonResponse, getUserIdFromEvent, Schedule, User } from "../types/index.js";
import { ulid } from "ulid";

const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE!;
const TEAMS_TABLE = process.env.TEAMS_TABLE!;
const USERS_TABLE = process.env.USERS_TABLE!;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getUserIdFromEvent(event);
  if (!userId) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /schedules/current - Who's on-call per team
    if (method === "GET" && path === "/schedules/current") {
      // Get user's teams first
      const userResult = await docClient.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { user_id: userId },
        })
      );

      const user = userResult.Item as User | undefined;
      const teamIds = user?.team_ids || [];

      const now = Date.now();
      const onCallByTeam: Record<string, { user_id: string; slot: Schedule } | null> = {};

      for (const teamId of teamIds) {
        const result = await docClient.send(
          new QueryCommand({
            TableName: SCHEDULES_TABLE,
            KeyConditionExpression: "team_id = :tid",
            FilterExpression: "#start <= :now AND #end > :now",
            ExpressionAttributeNames: {
              "#start": "start",
              "#end": "end",
            },
            ExpressionAttributeValues: {
              ":tid": teamId,
              ":now": now,
            },
          })
        );

        const currentSlot = result.Items?.[0] as Schedule | undefined;
        onCallByTeam[teamId] = currentSlot
          ? { user_id: currentSlot.user_id, slot: currentSlot }
          : null;
      }

      return jsonResponse(200, { on_call: onCallByTeam });
    }

    // GET /schedules/{team_id} - Team schedule
    if (method === "GET" && path.match(/^\/schedules\/[^/]+$/) && !path.includes("/current")) {
      const teamId = event.pathParameters?.team_id;
      if (!teamId) {
        return jsonResponse(400, { error: "Missing team ID" });
      }

      const result = await docClient.send(
        new QueryCommand({
          TableName: SCHEDULES_TABLE,
          KeyConditionExpression: "team_id = :tid",
          ExpressionAttributeValues: { ":tid": teamId },
        })
      );

      return jsonResponse(200, { schedules: result.Items || [] });
    }

    // POST /schedules/{team_id} - Create schedule slot
    if (method === "POST" && path.match(/^\/schedules\/[^/]+$/)) {
      const teamId = event.pathParameters?.team_id;
      if (!teamId) {
        return jsonResponse(400, { error: "Missing team ID" });
      }

      const body = JSON.parse(event.body || "{}");
      const { user_id: slotUserId, start, end } = body;

      if (!slotUserId || !start || !end) {
        return jsonResponse(400, { error: "Missing user_id, start, or end" });
      }

      if (start >= end) {
        return jsonResponse(400, { error: "start must be before end" });
      }

      const schedule: Schedule = {
        team_id: teamId,
        slot_id: ulid(),
        user_id: slotUserId,
        start,
        end,
      };

      await docClient.send(
        new PutCommand({
          TableName: SCHEDULES_TABLE,
          Item: schedule,
        })
      );

      return jsonResponse(201, { schedule });
    }

    // DELETE /schedules/{team_id}/{slot_id} - Delete schedule slot
    if (method === "DELETE" && path.match(/^\/schedules\/[^/]+\/[^/]+$/)) {
      const teamId = event.pathParameters?.team_id;
      const slotId = event.pathParameters?.slot_id;
      if (!teamId || !slotId) {
        return jsonResponse(400, { error: "Missing team ID or slot ID" });
      }

      await docClient.send(
        new DeleteCommand({
          TableName: SCHEDULES_TABLE,
          Key: {
            team_id: teamId,
            slot_id: slotId,
          },
        })
      );

      return jsonResponse(200, { message: "Schedule slot deleted" });
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (error) {
    console.error("Error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
