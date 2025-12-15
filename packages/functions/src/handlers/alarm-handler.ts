import type { SNSEvent } from "aws-lambda";
import { docClient, PutCommand, QueryCommand, ScanCommand } from "../lib/dynamo.js";
import { Incident, Team, Schedule, Device, TimelineEntry } from "../types/index.js";
import { ulid } from "ulid";

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;
const TEAMS_TABLE = process.env.TEAMS_TABLE!;
const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE!;
const DEVICES_TABLE = process.env.DEVICES_TABLE!;

interface CloudWatchAlarmMessage {
  AlarmName: string;
  AlarmArn: string;
  NewStateValue: "ALARM" | "OK" | "INSUFFICIENT_DATA";
  NewStateReason: string;
  StateChangeTime: string;
  Region: string;
  AWSAccountId: string;
}

export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.Sns.Message) as CloudWatchAlarmMessage;

      // Only process ALARM state
      if (message.NewStateValue !== "ALARM") {
        console.log(`Ignoring alarm state: ${message.NewStateValue}`);
        continue;
      }

      console.log(`Processing alarm: ${message.AlarmName} from account ${message.AWSAccountId}`);

      // Find team by AWS account ID
      const team = await findTeamByAwsAccount(message.AWSAccountId);
      if (!team) {
        console.error(`No team found for AWS account: ${message.AWSAccountId}`);
        continue;
      }

      // Find on-call user
      const onCallUserId = await findOnCallUser(team.team_id);
      if (!onCallUserId) {
        console.error(`No on-call user for team: ${team.team_id}`);
        // Could notify all team members as fallback
        continue;
      }

      // Create incident
      const now = Date.now();
      const incident: Incident = {
        incident_id: ulid(),
        team_id: team.team_id,
        alarm_arn: message.AlarmArn,
        alarm_name: message.AlarmName,
        state: "triggered",
        severity: determineSeverity(message.AlarmName),
        assigned_to: onCallUserId,
        escalation_level: 0,
        triggered_at: now,
        timeline: [
          {
            timestamp: now,
            event: "triggered",
            actor: "system",
            note: message.NewStateReason,
          },
        ],
      };

      await docClient.send(
        new PutCommand({
          TableName: INCIDENTS_TABLE,
          Item: incident,
        })
      );

      console.log(`Created incident: ${incident.incident_id}`);

      // Get user's devices and send push
      const devices = await getUserDevices(onCallUserId);
      for (const device of devices) {
        await sendPushNotification(device, incident);
      }

      // TODO: Schedule escalation via EventBridge
    } catch (error) {
      console.error("Error processing alarm:", error);
    }
  }
}

async function findTeamByAwsAccount(accountId: string): Promise<Team | null> {
  // Scan teams to find one with matching aws_account_ids
  // In production, consider a GSI or caching
  const result = await docClient.send(
    new ScanCommand({
      TableName: TEAMS_TABLE,
      FilterExpression: "contains(aws_account_ids, :accountId)",
      ExpressionAttributeValues: { ":accountId": accountId },
    })
  );

  return (result.Items?.[0] as Team) || null;
}

async function findOnCallUser(teamId: string): Promise<string | null> {
  const now = Date.now();
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

  const slot = result.Items?.[0] as Schedule | undefined;
  return slot?.user_id || null;
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

function determineSeverity(alarmName: string): "critical" | "warning" | "info" {
  const lowerName = alarmName.toLowerCase();
  if (lowerName.includes("critical") || lowerName.includes("error")) {
    return "critical";
  }
  if (lowerName.includes("warning") || lowerName.includes("warn")) {
    return "warning";
  }
  return "info";
}

async function sendPushNotification(device: Device, incident: Incident): Promise<void> {
  // TODO: Implement APNs push
  // For now, just log
  console.log(`Would send push to ${device.platform} device for incident ${incident.incident_id}`);

  if (device.platform === "ios") {
    // APNs HTTP/2 push
    // const payload = {
    //   aps: {
    //     alert: {
    //       title: `🔴 ALARM: ${incident.alarm_name}`,
    //       body: incident.timeline[0]?.note || "Alarm triggered",
    //     },
    //     sound: "default",
    //     "interruption-level": "critical",
    //     category: "INCIDENT_ACTIONS",
    //   },
    //   incident_id: incident.incident_id,
    //   severity: incident.severity,
    // };
  }
}
