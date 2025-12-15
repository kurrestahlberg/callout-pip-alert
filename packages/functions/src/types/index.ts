export interface User {
  user_id: string;
  email: string;
  name: string;
  team_ids: string[];
  created_at: number;
}

export interface Team {
  team_id: string;
  name: string;
  aws_account_ids: string[];
  escalation_policy: EscalationPolicy;
  created_at: number;
}

export interface EscalationPolicy {
  levels: EscalationLevel[];
}

export interface EscalationLevel {
  delay_minutes: number;
  target: "on_call" | "all_team";
}

export interface Schedule {
  team_id: string;
  slot_id: string;
  user_id: string;
  start: number;
  end: number;
}

export interface Incident {
  incident_id: string;
  team_id: string;
  alarm_arn: string;
  alarm_name: string;
  state: "triggered" | "acked" | "resolved";
  severity: "critical" | "warning" | "info";
  assigned_to: string;
  escalation_level: number;
  escalation_rule_id?: string;
  triggered_at: number;
  acked_at?: number;
  resolved_at?: number;
  timeline: TimelineEntry[];
}

export interface TimelineEntry {
  timestamp: number;
  event: "triggered" | "acked" | "resolved" | "escalated" | "reassigned";
  actor: string;
  note?: string;
}

export interface Device {
  user_id: string;
  device_token: string;
  platform: "ios" | "android" | "web";
  created_at: number;
}

export interface ApiResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function jsonResponse<T>(statusCode: number, body: T): ApiResponse<T> {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

export function getUserIdFromEvent(event: { requestContext?: { authorizer?: { jwt?: { claims?: { sub?: string } } } } }): string | null {
  return event.requestContext?.authorizer?.jwt?.claims?.sub ?? null;
}
