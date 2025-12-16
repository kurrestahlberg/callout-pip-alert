// Demo data generator - creates realistic mock incidents

import type { DemoIncident } from "../../hooks/useDemoMode";

// Realistic CloudWatch-style alarm names
const ALARM_NAMES = {
  critical: [
    "CPU-Utilization-Critical",
    "Memory-Pressure-Critical",
    "DiskSpace-Critical",
    "API-Latency-Critical",
    "Database-Connections-Critical",
    "Error-Rate-Critical",
    "Health-Check-Failed",
    "OOM-Kill-Detected",
  ],
  warning: [
    "CPU-Utilization-Warning",
    "Memory-Usage-Warning",
    "DiskSpace-Warning",
    "Response-Time-Warning",
    "Queue-Depth-Warning",
    "Cache-Miss-Rate-High",
    "Network-Bandwidth-Warning",
    "Request-Rate-Warning",
  ],
  info: [
    "Autoscaling-Event",
    "Deployment-Started",
    "Backup-Completed",
    "Certificate-Expiry-30d",
    "Maintenance-Window",
    "Cost-Threshold-Reached",
  ],
};

// Fictional AWS account and regions for demo
const DEMO_AWS_ACCOUNT = "123456789012";
const DEMO_REGIONS = ["us-east-1", "eu-west-1", "ap-northeast-1"];

// Fictional teammate names (Fallout-themed)
export const DEMO_TEAMMATES = [
  "VaultDweller-42",
  "LoneWanderer",
  "Courier-Six",
  "SoleSurvivor",
  "OverSeer-101",
];

let incidentCounter = 0;

/**
 * Generate a demo incident with realistic data
 */
export function generateDemoIncident(
  severity: "critical" | "warning" | "info",
  index?: number
): DemoIncident {
  const alarmNames = ALARM_NAMES[severity];
  const alarmName = alarmNames[Math.floor(Math.random() * alarmNames.length)];
  const region = DEMO_REGIONS[Math.floor(Math.random() * DEMO_REGIONS.length)];

  const id = index !== undefined ? index : incidentCounter++;
  const now = Date.now();

  // Generate a realistic ARN
  const alarmArn = `arn:aws:cloudwatch:${region}:${DEMO_AWS_ACCOUNT}:alarm:${alarmName}`;

  const incident: DemoIncident = {
    incident_id: `demo-${id}-${now}`,
    alarm_name: alarmName,
    alarm_arn: alarmArn,
    state: "triggered",
    severity,
    assigned_to: "",
    triggered_at: now,
    timeline: [
      {
        timestamp: now,
        event: "triggered",
        actor: "CloudWatch",
        note: `Alarm threshold breached in ${region}`,
      },
    ],
  };

  return incident;
}

/**
 * Generate a batch of demo incidents with mixed severities
 */
export function generateDemoIncidentBatch(count: number): DemoIncident[] {
  const incidents: DemoIncident[] = [];

  for (let i = 0; i < count; i++) {
    // Vary severity: more warnings than criticals, few info
    let severity: "critical" | "warning" | "info";
    const roll = Math.random();
    if (roll < 0.35) {
      severity = "critical";
    } else if (roll < 0.75) {
      severity = "warning";
    } else {
      severity = "info";
    }

    incidents.push(generateDemoIncident(severity, i));
  }

  return incidents;
}

/**
 * Add a timeline entry to an incident
 */
export function addTimelineEntry(
  incident: DemoIncident,
  event: string,
  actor: string,
  note?: string
): DemoIncident {
  return {
    ...incident,
    timeline: [
      ...incident.timeline,
      {
        timestamp: Date.now(),
        event,
        actor,
        note,
      },
    ],
  };
}

/**
 * Get a random teammate name for "teammate ack" simulation
 */
export function getRandomTeammate(): string {
  return DEMO_TEAMMATES[Math.floor(Math.random() * DEMO_TEAMMATES.length)];
}

/**
 * Check if an incident ID is a demo incident
 */
export function isDemoIncidentId(id: string): boolean {
  return id.startsWith("demo-");
}

/**
 * Reset the incident counter (for clean demo restarts)
 */
export function resetDemoCounter(): void {
  incidentCounter = 0;
}
