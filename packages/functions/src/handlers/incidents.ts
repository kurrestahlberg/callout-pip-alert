import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { docClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "../lib/dynamo.js";
import { jsonResponse, getUserIdFromEvent, Incident, TimelineEntry } from "../types/index.js";

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getUserIdFromEvent(event);
  if (!userId) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // GET /incidents - List incidents
    if (method === "GET" && path === "/incidents") {
      const state = event.queryStringParameters?.state;
      const teamId = event.queryStringParameters?.team_id;

      let result;
      if (teamId && state) {
        result = await docClient.send(
          new QueryCommand({
            TableName: INCIDENTS_TABLE,
            IndexName: "team-state-index",
            KeyConditionExpression: "team_id = :tid AND #state = :state",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":tid": teamId, ":state": state },
          })
        );
      } else if (teamId) {
        result = await docClient.send(
          new QueryCommand({
            TableName: INCIDENTS_TABLE,
            IndexName: "team-state-index",
            KeyConditionExpression: "team_id = :tid",
            ExpressionAttributeValues: { ":tid": teamId },
          })
        );
      } else {
        // Scan all (not ideal but ok for MVP)
        result = await docClient.send(
          new QueryCommand({
            TableName: INCIDENTS_TABLE,
            IndexName: "team-state-index",
            KeyConditionExpression: "team_id = :tid",
            ExpressionAttributeValues: { ":tid": "default" }, // TODO: filter by user's teams
          })
        );
      }

      return jsonResponse(200, { incidents: result.Items || [] });
    }

    // GET /incidents/{id} - Get single incident
    if (method === "GET" && path.match(/^\/incidents\/[^/]+$/)) {
      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        return jsonResponse(400, { error: "Missing incident ID" });
      }

      const result = await docClient.send(
        new GetCommand({
          TableName: INCIDENTS_TABLE,
          Key: { incident_id: incidentId },
        })
      );

      if (!result.Item) {
        return jsonResponse(404, { error: "Incident not found" });
      }

      return jsonResponse(200, { incident: result.Item });
    }

    // POST /incidents/{id}/ack - Acknowledge
    if (method === "POST" && path.match(/^\/incidents\/[^/]+\/ack$/)) {
      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        return jsonResponse(400, { error: "Missing incident ID" });
      }

      const now = Date.now();
      const timelineEntry: TimelineEntry = {
        timestamp: now,
        event: "acked",
        actor: userId,
      };

      const result = await docClient.send(
        new UpdateCommand({
          TableName: INCIDENTS_TABLE,
          Key: { incident_id: incidentId },
          UpdateExpression: "SET #state = :state, acked_at = :acked_at, timeline = list_append(timeline, :entry)",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":state": "acked",
            ":acked_at": now,
            ":entry": [timelineEntry],
          },
          ReturnValues: "ALL_NEW",
        })
      );

      // TODO: Cancel EventBridge escalation rule

      return jsonResponse(200, { incident: result.Attributes });
    }

    // POST /incidents/{id}/resolve - Resolve
    if (method === "POST" && path.match(/^\/incidents\/[^/]+\/resolve$/)) {
      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        return jsonResponse(400, { error: "Missing incident ID" });
      }

      const body = JSON.parse(event.body || "{}");
      const now = Date.now();
      const timelineEntry: TimelineEntry = {
        timestamp: now,
        event: "resolved",
        actor: userId,
        note: body.note,
      };

      const result = await docClient.send(
        new UpdateCommand({
          TableName: INCIDENTS_TABLE,
          Key: { incident_id: incidentId },
          UpdateExpression: "SET #state = :state, resolved_at = :resolved_at, timeline = list_append(timeline, :entry)",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":state": "resolved",
            ":resolved_at": now,
            ":entry": [timelineEntry],
          },
          ReturnValues: "ALL_NEW",
        })
      );

      // TODO: Cancel EventBridge escalation rule

      return jsonResponse(200, { incident: result.Attributes });
    }

    // POST /incidents/{id}/reassign - Reassign
    if (method === "POST" && path.match(/^\/incidents\/[^/]+\/reassign$/)) {
      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        return jsonResponse(400, { error: "Missing incident ID" });
      }

      const body = JSON.parse(event.body || "{}");
      const { user_id: newUserId } = body;
      if (!newUserId) {
        return jsonResponse(400, { error: "Missing user_id" });
      }

      const now = Date.now();
      const timelineEntry: TimelineEntry = {
        timestamp: now,
        event: "reassigned",
        actor: userId,
        note: `Reassigned to ${newUserId}`,
      };

      const result = await docClient.send(
        new UpdateCommand({
          TableName: INCIDENTS_TABLE,
          Key: { incident_id: incidentId },
          UpdateExpression: "SET assigned_to = :assigned, timeline = list_append(timeline, :entry)",
          ExpressionAttributeValues: {
            ":assigned": newUserId,
            ":entry": [timelineEntry],
          },
          ReturnValues: "ALL_NEW",
        })
      );

      return jsonResponse(200, { incident: result.Attributes });
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (error) {
    console.error("Error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
