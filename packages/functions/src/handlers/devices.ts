import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { docClient, PutCommand, DeleteCommand } from "../lib/dynamo.js";
import { jsonResponse, getUserIdFromEvent, Device } from "../types/index.js";

const DEVICES_TABLE = process.env.DEVICES_TABLE!;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getUserIdFromEvent(event);
  if (!userId) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    // POST /devices - Register device
    if (method === "POST" && path === "/devices") {
      const body = JSON.parse(event.body || "{}");
      const { token, platform } = body;

      if (!token || !platform) {
        return jsonResponse(400, { error: "Missing token or platform" });
      }

      if (!["ios", "android", "web"].includes(platform)) {
        return jsonResponse(400, { error: "Invalid platform" });
      }

      const device: Device = {
        user_id: userId,
        device_token: token,
        platform,
        created_at: Date.now(),
      };

      await docClient.send(
        new PutCommand({
          TableName: DEVICES_TABLE,
          Item: device,
        })
      );

      return jsonResponse(201, { message: "Device registered", device });
    }

    // DELETE /devices/{token} - Unregister device
    if (method === "DELETE" && path.startsWith("/devices/")) {
      const token = event.pathParameters?.token;
      if (!token) {
        return jsonResponse(400, { error: "Missing token" });
      }

      await docClient.send(
        new DeleteCommand({
          TableName: DEVICES_TABLE,
          Key: {
            user_id: userId,
            device_token: decodeURIComponent(token),
          },
        })
      );

      return jsonResponse(200, { message: "Device unregistered" });
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (error) {
    console.error("Error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
}
