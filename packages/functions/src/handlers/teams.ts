import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { docClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } from "../lib/dynamo.js";
import { jsonResponse, getUserIdFromEvent, Team, User } from "../types/index.js";
import { ulid } from "ulid";

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
    // GET /teams - List user's teams
    if (method === "GET" && path === "/teams") {
      // First get the user to find their team_ids
      const userResult = await docClient.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { user_id: userId },
        })
      );

      const user = userResult.Item as User | undefined;
      const teamIds = user?.team_ids || [];

      if (teamIds.length === 0) {
        return jsonResponse(200, { teams: [] });
      }

      // Fetch each team (could optimize with BatchGetItem)
      const teams = await Promise.all(
        teamIds.map(async (teamId) => {
          const result = await docClient.send(
            new GetCommand({
              TableName: TEAMS_TABLE,
              Key: { team_id: teamId },
            })
          );
          return result.Item;
        })
      );

      return jsonResponse(200, { teams: teams.filter(Boolean) });
    }

    // POST /teams - Create team
    if (method === "POST" && path === "/teams") {
      const body = JSON.parse(event.body || "{}");
      const { name, aws_account_ids } = body;

      if (!name) {
        return jsonResponse(400, { error: "Missing name" });
      }

      const team: Team = {
        team_id: ulid(),
        name,
        aws_account_ids: aws_account_ids || [],
        escalation_policy: {
          levels: [
            { delay_minutes: 5, target: "on_call" },
            { delay_minutes: 15, target: "all_team" },
          ],
        },
        created_at: Date.now(),
      };

      await docClient.send(
        new PutCommand({
          TableName: TEAMS_TABLE,
          Item: team,
        })
      );

      // Add creator to the team
      await docClient.send(
        new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { user_id: userId },
          UpdateExpression: "SET team_ids = list_append(if_not_exists(team_ids, :empty), :team)",
          ExpressionAttributeValues: {
            ":empty": [],
            ":team": [team.team_id],
          },
        })
      );

      return jsonResponse(201, { team });
    }

    // GET /teams/{id} - Get team details
    if (method === "GET" && path.match(/^\/teams\/[^/]+$/) && !path.includes("/members")) {
      const teamId = event.pathParameters?.id;
      if (!teamId) {
        return jsonResponse(400, { error: "Missing team ID" });
      }

      const result = await docClient.send(
        new GetCommand({
          TableName: TEAMS_TABLE,
          Key: { team_id: teamId },
        })
      );

      if (!result.Item) {
        return jsonResponse(404, { error: "Team not found" });
      }

      return jsonResponse(200, { team: result.Item });
    }

    // PUT /teams/{id} - Update team
    if (method === "PUT" && path.match(/^\/teams\/[^/]+$/)) {
      const teamId = event.pathParameters?.id;
      if (!teamId) {
        return jsonResponse(400, { error: "Missing team ID" });
      }

      const body = JSON.parse(event.body || "{}");
      const updates: string[] = [];
      const exprValues: Record<string, unknown> = {};
      const exprNames: Record<string, string> = {};

      if (body.name) {
        updates.push("#name = :name");
        exprNames["#name"] = "name";
        exprValues[":name"] = body.name;
      }
      if (body.aws_account_ids) {
        updates.push("aws_account_ids = :accounts");
        exprValues[":accounts"] = body.aws_account_ids;
      }
      if (body.escalation_policy) {
        updates.push("escalation_policy = :policy");
        exprValues[":policy"] = body.escalation_policy;
      }

      if (updates.length === 0) {
        return jsonResponse(400, { error: "No updates provided" });
      }

      const result = await docClient.send(
        new UpdateCommand({
          TableName: TEAMS_TABLE,
          Key: { team_id: teamId },
          UpdateExpression: `SET ${updates.join(", ")}`,
          ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
          ExpressionAttributeValues: exprValues,
          ReturnValues: "ALL_NEW",
        })
      );

      return jsonResponse(200, { team: result.Attributes });
    }

    // POST /teams/{id}/members - Add member
    if (method === "POST" && path.match(/^\/teams\/[^/]+\/members$/)) {
      const teamId = event.pathParameters?.id;
      if (!teamId) {
        return jsonResponse(400, { error: "Missing team ID" });
      }

      const body = JSON.parse(event.body || "{}");
      const { user_id: memberUserId } = body;
      if (!memberUserId) {
        return jsonResponse(400, { error: "Missing user_id" });
      }

      await docClient.send(
        new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { user_id: memberUserId },
          UpdateExpression: "SET team_ids = list_append(if_not_exists(team_ids, :empty), :team)",
          ExpressionAttributeValues: {
            ":empty": [],
            ":team": [teamId],
          },
        })
      );

      return jsonResponse(200, { message: "Member added" });
    }

    // DELETE /teams/{id}/members/{uid} - Remove member
    if (method === "DELETE" && path.match(/^\/teams\/[^/]+\/members\/[^/]+$/)) {
      const teamId = event.pathParameters?.id;
      const memberUserId = event.pathParameters?.uid;
      if (!teamId || !memberUserId) {
        return jsonResponse(400, { error: "Missing team ID or user ID" });
      }

      // Get user's current teams
      const userResult = await docClient.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { user_id: memberUserId },
        })
      );

      const user = userResult.Item as User | undefined;
      if (user && user.team_ids) {
        const newTeamIds = user.team_ids.filter((id) => id !== teamId);
        await docClient.send(
          new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { user_id: memberUserId },
            UpdateExpression: "SET team_ids = :teams",
            ExpressionAttributeValues: { ":teams": newTeamIds },
          })
        );
      }

      return jsonResponse(200, { message: "Member removed" });
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (error) {
    console.error("Error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
