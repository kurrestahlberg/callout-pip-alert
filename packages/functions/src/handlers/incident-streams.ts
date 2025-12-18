import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { docClient, QueryCommand, ScanCommand } from "../lib/dynamo.js";
import { Incident, Device } from "../types/index.js";
import { sendPushNotification, PushNotification } from "../lib/apns.js";

const DEVICES_TABLE = process.env.DEVICES_TABLE!;
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;

type IncidentState = "triggered" | "acked" | "resolved";

interface StateChange {
  type: "INSERT" | "MODIFY" | "REMOVE";
  oldState?: IncidentState;
  newState?: IncidentState;
  incident: Incident;
  oldIncident?: Incident;
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const change = parseStateChange(record);
      if (!change) continue;

      console.log(`[Streams] ${change.type}: ${change.incident.incident_id} ${change.oldState || "new"} → ${change.newState}`);

      // Determine notification based on state change
      const notification = buildNotification(change);
      if (!notification) continue;

      // Get devices to notify
      const devices = await getDevicesToNotify(change);
      if (devices.length === 0) {
        console.log("[Streams] No devices to notify");
        continue;
      }

      // Get badge count (unacked incidents for this user)
      const badgeCount = await getUnackedIncidentCount(change.incident.assigned_to);
      console.log(`[Streams] Badge count for ${change.incident.assigned_to}: ${badgeCount}`);

      // Send push to all devices
      for (const device of devices) {
        await sendPushNotification(device, {
          ...notification,
          badge: badgeCount,
          data: {
            incident_id: change.incident.incident_id,
            severity: change.incident.severity,
            state: change.incident.state,
          },
        });
      }

    } catch (error) {
      console.error("[Streams] Error processing record:", error);
    }
  }
}

function parseStateChange(record: DynamoDBRecord): StateChange | null {
  if (!record.dynamodb) return null;

  const eventName = record.eventName as "INSERT" | "MODIFY" | "REMOVE";

  // Parse new image
  const newImage = record.dynamodb.NewImage
    ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>) as Incident
    : undefined;

  // Parse old image
  const oldImage = record.dynamodb.OldImage
    ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>) as Incident
    : undefined;

  if (eventName === "INSERT" && newImage) {
    return {
      type: "INSERT",
      newState: newImage.state,
      incident: newImage,
    };
  }

  if (eventName === "MODIFY" && newImage && oldImage) {
    // Only care about state changes
    if (oldImage.state === newImage.state) return null;

    return {
      type: "MODIFY",
      oldState: oldImage.state,
      newState: newImage.state,
      incident: newImage,
      oldIncident: oldImage,
    };
  }

  if (eventName === "REMOVE" && oldImage) {
    return {
      type: "REMOVE",
      oldState: oldImage.state,
      incident: oldImage,
    };
  }

  return null;
}

function buildNotification(change: StateChange): PushNotification | null {
  const { incident } = change;
  const severityEmoji = incident.severity === "critical" ? "🔴" : incident.severity === "warning" ? "🟡" : "🟢";

  // New incident triggered
  if (change.type === "INSERT" && change.newState === "triggered") {
    return {
      title: `${severityEmoji} ${incident.severity.toUpperCase()}: ${incident.alarm_name}`,
      body: incident.timeline[0]?.note || "New alarm triggered",
      sound: incident.severity === "critical" ? "critical_alarm.caf" : "default",
      interruptionLevel: incident.severity === "critical" ? "critical" : "time-sensitive",
    };
  }

  // State transitions
  if (change.type === "MODIFY") {
    // triggered → acked
    if (change.oldState === "triggered" && change.newState === "acked") {
      return {
        title: `✓ Acknowledged: ${incident.alarm_name}`,
        body: `Acked by ${incident.acked_by || "teammate"}`,
        sound: "default",
        interruptionLevel: "active",
      };
    }

    // acked → resolved
    if (change.oldState === "acked" && change.newState === "resolved") {
      return {
        title: `✓ Resolved: ${incident.alarm_name}`,
        body: "Incident has been resolved",
        sound: "default",
        interruptionLevel: "passive",
      };
    }

    // acked → triggered (unack)
    if (change.oldState === "acked" && change.newState === "triggered") {
      return {
        title: `⚠ Unacked: ${incident.alarm_name}`,
        body: "Incident requires attention again",
        sound: incident.severity === "critical" ? "critical_alarm.caf" : "default",
        interruptionLevel: incident.severity === "critical" ? "critical" : "time-sensitive",
      };
    }
  }

  return null;
}

async function getDevicesToNotify(change: StateChange): Promise<Device[]> {
  const { incident } = change;

  // For new incidents, notify the assigned user
  if (change.type === "INSERT") {
    return getUserDevices(incident.assigned_to);
  }

  // For state changes, could notify:
  // - All team members (for acks/resolves)
  // - Or just the assigned user
  // For now, notify assigned user
  return getUserDevices(incident.assigned_to);
}

async function getUserDevices(userId: string): Promise<Device[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: DEVICES_TABLE,
      KeyConditionExpression: "user_id = :uid",
      ExpressionAttributeValues: { ":uid": userId },
    })
  );
  return (result.Items as Device[]) || [];
}

async function getUnackedIncidentCount(userId: string): Promise<number> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: INCIDENTS_TABLE,
      FilterExpression: "assigned_to = :uid AND #state = :state",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: { ":uid": userId, ":state": "triggered" },
      Select: "COUNT",
    })
  );
  return result.Count || 0;
}
