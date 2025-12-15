# CloudWatch Alarm Mobile App — Design Document

## Overview

A mobile-first alerting application for AWS CloudWatch Alarms, targeting iOS, Android, Web, and Desktop platforms. Built with Tauri 2.0 and React, providing PagerDuty-quality UX for on-call teams.

---

## Goals

- Real-time push notifications for CloudWatch Alarm state changes
- One-tap acknowledge/resolve from notification or app
- Team-based on-call scheduling and escalation
- Snappy, native-feel multi-page SPA
- Minimal AWS infrastructure, direct FCM/APNs integration

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    TAURI CLIENT                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  React 19 + Vite + React Router                   │  │
│  │  ├── TanStack Query (cache, optimistic updates)   │  │
│  │  ├── Tailwind CSS                                 │  │
│  │  ├── Framer Motion (gestures, animations)         │  │
│  │  └── tauri-plugin-remote-push (FCM/APNs)          │  │
│  └───────────────────────────────────────────────────┘  │
│                         │                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Tauri Rust Core                                  │  │
│  │  └── Native push token handling                   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    AWS BACKEND                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  API Gateway HTTP API                             │  │
│  │  └── JWT Authorizer (Cognito)                     │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Lambda (Node.js)                                 │  │
│  │  ├── Device registration                          │  │
│  │  ├── Incident CRUD                                │  │
│  │  ├── Schedule queries                             │  │
│  │  └── Push sender (FCM/APNs direct)                │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  DynamoDB                                         │  │
│  │  ├── users                                        │  │
│  │  ├── teams                                        │  │
│  │  ├── schedules                                    │  │
│  │  ├── incidents                                    │  │
│  │  └── devices                                      │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  EventBridge                                      │  │
│  │  └── Escalation scheduler                         │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 ALARM SOURCE                            │
│  CloudWatch Alarm → SNS → Lambda (alarm-handler)        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 PUSH DELIVERY                           │
│  Lambda → FCM (Android) / APNs (iOS)                    │
└─────────────────────────────────────────────────────────┘
```

---

## Data Model

### users

| Field      | Type     | Description           |
| ---------- | -------- | --------------------- |
| user_id    | String   | PK, Cognito sub       |
| email      | String   | User email            |
| name       | String   | Display name          |
| team_ids   | String[] | Teams user belongs to |
| created_at | Number   | Timestamp             |

### teams

| Field             | Type     | Description                    |
| ----------------- | -------- | ------------------------------ |
| team_id           | String   | PK, ULID                       |
| name              | String   | Team display name              |
| aws_account_ids   | String[] | AWS accounts routed to team    |
| escalation_policy | Object   | Escalation rules               |
| created_at        | Number   | Timestamp                      |

**escalation_policy structure:**

```json
{
  "levels": [
    { "delay_minutes": 5, "target": "on_call" },
    { "delay_minutes": 15, "target": "all_team" }
  ]
}
```

> **Alarm Routing Rule:** CloudWatch Alarms are routed to teams based on the AWS account ID from the alarm ARN. Each team lists which AWS accounts it owns. Use a GSI or scan with filter for account lookup (low cardinality, infrequent queries).

### schedules

| Field   | Type   | Description          |
| ------- | ------ | -------------------- |
| team_id | String | PK                   |
| slot_id | String | SK, ULID             |
| user_id | String | On-call user         |
| start   | Number | Slot start timestamp |
| end     | Number | Slot end timestamp   |

### incidents

| Field              | Type     | Description                       |
| ------------------ | -------- | --------------------------------- |
| incident_id        | String   | PK, ULID                          |
| team_id            | String   | GSI PK                            |
| alarm_arn          | String   | CloudWatch Alarm ARN              |
| alarm_name         | String   | Display name                      |
| state              | String   | triggered / acked / resolved      |
| severity           | String   | critical / warning / info         |
| assigned_to        | String   | Current assignee user_id          |
| escalation_level   | Number   | Current escalation level (0-based)|
| escalation_rule_id | String   | EventBridge rule name for cleanup |
| triggered_at       | Number   | Timestamp                         |
| acked_at           | Number   | Timestamp (nullable)              |
| resolved_at        | Number   | Timestamp (nullable)              |
| timeline           | Object[] | Event log                         |

**timeline entry structure:**

```json
{
  "timestamp": 1234567890,
  "event": "triggered | acked | resolved | escalated | reassigned",
  "actor": "user_id | system",
  "note": "optional context"
}
```

### devices

| Field        | Type   | Description         |
| ------------ | ------ | ------------------- |
| user_id      | String | PK                  |
| device_token | String | SK, FCM/APNs token  |
| platform     | String | ios / android / web |
| created_at   | Number | Timestamp           |

---

## API Endpoints

### Authentication

All endpoints require `Authorization: Bearer <cognito_jwt>`.
API Gateway JWT Authorizer validates token; Lambda receives `user_id` from claims.

> **Token Refresh:** Access tokens expire after 1 hour. The app must use Cognito refresh tokens (stored securely) to obtain new access tokens automatically before expiry.

### Device Management

| Method | Path             | Description       | Request Body          |
| ------ | ---------------- | ----------------- | --------------------- |
| POST   | /devices         | Register device   | `{ token, platform }` |
| DELETE | /devices/{token} | Unregister device | —                     |

### Incidents

| Method | Path                     | Description    | Request Body     |
| ------ | ------------------------ | -------------- | ---------------- |
| GET    | /incidents               | List incidents | Query: `?state=` |
| GET    | /incidents/{id}          | Get incident   | —                |
| POST   | /incidents/{id}/ack      | Acknowledge    | —                |
| POST   | /incidents/{id}/resolve  | Resolve        | `{ note? }`      |
| POST   | /incidents/{id}/reassign | Reassign       | `{ user_id }`    |

### Schedules

| Method | Path                          | Description            | Request Body                    |
| ------ | ----------------------------- | ---------------------- | ------------------------------- |
| GET    | /schedules/current            | Who's on-call per team | —                               |
| GET    | /schedules/{team_id}          | Team schedule          | —                               |
| POST   | /schedules/{team_id}          | Create schedule slot   | `{ user_id, start, end }`       |
| DELETE | /schedules/{team_id}/{slot_id}| Delete schedule slot   | —                               |

### Teams

| Method | Path                       | Description         | Request Body                          |
| ------ | -------------------------- | ------------------- | ------------------------------------- |
| GET    | /teams                     | List user's teams   | —                                     |
| GET    | /teams/{id}                | Team details        | —                                     |
| POST   | /teams                     | Create team         | `{ name, aws_account_ids }`           |
| PUT    | /teams/{id}                | Update team         | `{ name?, aws_account_ids?, escalation_policy? }` |
| POST   | /teams/{id}/members        | Add member          | `{ user_id }`                         |
| DELETE | /teams/{id}/members/{uid}  | Remove member       | —                                     |

---

## Core Flows

> **Alarm Subscription Setup:** Each monitored AWS account needs a CloudWatch Alarm action pointing to the central SNS topic. Use cross-account SNS permissions or deploy an SNS topic per account with Lambda subscription.

### 1. Alarm Trigger Flow

```
CloudWatch Alarm (state change)
       │
       ▼
SNS Topic
       │
       ▼
Lambda: alarm-handler
       │
       ├─► Extract AWS account ID from alarm ARN
       ├─► Query teams: find team with matching aws_account_ids
       ├─► Query schedules: find on-call user for team
       ├─► Create incident in DynamoDB (state: triggered)
       ├─► Query devices: get user's device tokens
       ├─► Send push via FCM/APNs
       └─► Schedule escalation via EventBridge
```

### 2. Escalation Flow

```
EventBridge (scheduled) → Lambda: escalation-handler
       │
       ├─► If incident still triggered:
       │   ├─► Send push to next escalation target
       │   ├─► Update incident timeline
       │   └─► Schedule next level if more exist
       └─► If acked/resolved: no-op
```

### 3. Acknowledge Flow

```
User taps "Acknowledge" → POST /incidents/{id}/ack
       │
       ├─► Update incident (state: acked, timeline)
       ├─► Cancel pending escalation (delete EventBridge rule)
       └─► Return updated incident (app uses optimistic UI)
```

### 4. Device Registration Flow

```
App launch → Request push permission → Get FCM/APNs token
       │
       └─► POST /devices { token, platform } → Upsert to DynamoDB
```

---

## Push Notification Format

### FCM HTTP v1 (Android)

```json
{
  "message": {
    "token": "<device_token>",
    "notification": {
      "title": "🔴 ALARM: CPU > 90%",
      "body": "prod-api-server-1"
    },
    "data": {
      "incident_id": "01HXYZ...",
      "alarm_name": "CPU > 90%",
      "severity": "critical"
    },
    "android": {
      "priority": "high",
      "notification": {
        "channel_id": "critical_alerts",
        "sound": "critical_alert",
        "click_action": "OPEN_INCIDENT"
      }
    }
  }
}
```

### APNs (iOS)

```json
{
  "aps": {
    "alert": {
      "title": "🔴 ALARM: CPU > 90%",
      "body": "prod-api-server-1"
    },
    "sound": "critical_alert.wav",
    "interruption-level": "critical",
    "category": "INCIDENT_ACTIONS"
  },
  "incident_id": "01HXYZ...",
  "alarm_name": "CPU > 90%",
  "severity": "critical"
}
```

### Push Actions

```
Category: INCIDENT_ACTIONS
Actions:
  - id: "ACK", title: "Acknowledge", foreground: false
  - id: "RESOLVE", title: "Resolve", foreground: false
  - id: "VIEW", title: "View Details", foreground: true
```

---

## Mobile UI Structure

### Route Map (Multi-page DOM SPA)

```
/                     → Redirect to /incidents
/login                → Login screen (pre-auth)
/incidents            → Incident list (tab 1)
/incidents/:id        → Incident detail
/schedule             → On-call schedule (tab 2)
/team                 → Team members (tab 3)
/settings             → Settings (tab 4)
/settings/devices     → Manage devices
/settings/profile     → User profile
```

### Navigation Structure

```
┌───────────────────────────────────────────┐
│              Header (optional)            │
├───────────────────────────────────────────┤
│                                           │
│            Page Content                   │
│         (stack navigation)                │
│                                           │
├───────────────────────────────────────────┤
│ 🔔 Incidents │ 📅 Schedule │ 👥 Team │ ⚙️  │
└───────────────────────────────────────────┘
```

### Key UX Patterns

| Pattern            | Implementation                             |
| ------------------ | ------------------------------------------ |
| Optimistic updates | TanStack Query mutation with rollback      |
| Swipe actions      | Framer Motion gesture + threshold triggers |
| Pull-to-refresh    | Native scroll + refetch                    |
| Tab state persist  | React Router + preserved scroll position   |
| Critical alerts    | iOS interruption-level, Android channel    |
| Haptic feedback    | Tauri haptics plugin on actions            |

---

## Client Tech Stack

| Layer      | Technology                   |
| ---------- | ---------------------------- |
| Framework  | Tauri 2.0                    |
| UI         | React 19                     |
| Build      | Vite                         |
| Routing    | React Router v7 (DOM)        |
| State      | TanStack Query v5            |
| Styling    | Tailwind CSS v4              |
| Animations | Framer Motion                |
| Push       | tauri-plugin-remote-push     |
| HTTP       | tauri-plugin-http (or fetch) |
| Storage    | tauri-plugin-store (tokens)  |

---

## Backend Tech Stack

| Layer      | Technology                      |
| ---------- | ------------------------------- |
| Auth       | AWS Cognito User Pool           |
| API        | API Gateway HTTP API + JWT Auth |
| Compute    | Lambda (Node.js 22)             |
| Database   | DynamoDB                        |
| Scheduling | EventBridge Scheduler           |
| Push       | Direct FCM/APNs HTTP calls      |
| IaC        | AWS CDK v2 (TypeScript, single stack) |

---

## Project Structure

```
cloudwatch-alarm-app/
├── apps/
│   └── mobile/                    # Tauri app
│       ├── src/                   # React frontend
│       │   ├── components/
│       │   │   ├── ui/            # Base components
│       │   │   ├── incidents/     # Incident components
│       │   │   ├── schedule/      # Schedule components
│       │   │   └── layout/        # Navigation, tabs
│       │   ├── pages/
│       │   │   ├── incidents/
│       │   │   ├── schedule/
│       │   │   ├── team/
│       │   │   └── settings/
│       │   ├── hooks/
│       │   ├── lib/
│       │   │   ├── api.ts         # API client
│       │   │   ├── auth.ts        # Cognito helpers
│       │   │   └── push.ts        # Push handling
│       │   └── main.tsx
│       ├── src-tauri/             # Rust backend
│       │   ├── src/
│       │   └── Cargo.toml
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
│
├── infra/                         # AWS CDK v2
│   ├── lib/
│   │   └── app-stack.ts          # Single stack: Cognito, API GW, DynamoDB, Lambdas
│   └── bin/
│       └── app.ts
│
├── packages/
│   └── functions/                 # Lambda functions
│       ├── src/
│       │   ├── handlers/
│       │   │   ├── devices.ts
│       │   │   ├── incidents.ts
│       │   │   ├── schedules.ts
│       │   │   ├── teams.ts
│       │   │   ├── alarm-handler.ts
│       │   │   └── escalation.ts
│       │   ├── lib/
│       │   │   ├── dynamo.ts
│       │   │   ├── push.ts        # FCM/APNs client
│       │   │   └── escalation.ts
│       │   └── types/
│       └── package.json
│
└── package.json                   # Monorepo root
```

---

## Implementation Plan

### Phase 1: Foundation

**Goal:** Basic infrastructure, auth, app scaffold with iOS build working.

#### Step 1.1: AWS Infrastructure (Single CDK Stack)
- Initialize CDK v2 project with single `AppStack`
- Cognito User Pool + API Gateway HTTP API with JWT Authorizer
- DynamoDB tables (users, teams, schedules, devices, incidents)
- Lambda functions with API Gateway integrations

#### Step 1.2: Tauri App Scaffold + iOS Setup
- Create Tauri + React + Vite project with Tailwind CSS
- Configure Tauri for iOS: `tauri ios init`
- Set up Xcode project, Apple Developer signing (requires Apple Developer account)
- Add React Router with placeholder routes, bottom tab navigation
- **Validate:** `tauri ios dev` runs on iPhone simulator, `tauri ios build` creates IPA

#### Step 1.3: Authentication Flow
- Integrate Cognito auth (amazon-cognito-identity-js)
- Implement login/logout screens with secure token storage (tauri-plugin-store)
- **Validate:** Can sign in on iOS simulator

#### Step 1.4: Device Registration
- Create API client with auth headers
- Implement device registration endpoint and call from app

---

### Phase 2: Teams & Schedules

**Goal:** Team structure and on-call scheduling (required for alarm routing).

#### Step 2.1: Teams Backend
- Implement team CRUD: create, update, list, get
- Implement member management: add/remove users from teams
- Configure `aws_account_ids` for alarm routing

#### Step 2.2: Schedules Backend
- Implement schedule CRUD: create/delete slots, list by team
- Implement "who's on-call now" query with timezone handling

#### Step 2.3: Teams & Schedule UI
- Build team list and detail views with member management
- Build schedule view (calendar/list) with current on-call prominent
- Allow schedule slot creation/deletion

---

### Phase 3: Incidents Core

**Goal:** Create, list, and manage incidents.

#### Step 3.1: Incidents Backend
- Add GSI for team_id + state queries on incidents table
- Implement Lambda handlers: list, get, ack, resolve, reassign

#### Step 3.2: Incidents UI
- Build incident list with TanStack Query, pull-to-refresh, state filter tabs
- Build incident detail page with timeline and action buttons
- Implement optimistic updates

#### Step 3.3: Swipe Actions
- Add swipe gestures (Framer Motion): left = ack, right = resolve
- Add haptic feedback

---

### Phase 4: Push Notifications + End-to-End Testing

**Goal:** Real-time alerts via APNs, testable on physical iPhone.

#### Step 4.1: APNs Setup
- Create APNs Key in Apple Developer portal (Key ID + .p8 file)
- Add credentials to AWS Secrets Manager
- Implement APNs push sender in Lambda

#### Step 4.2: Tauri Push Integration
- Add tauri-plugin-notification (or tauri-plugin-remote-push if available)
- Request push permission on login, send APNs token to backend
- Handle foreground notifications

#### Step 4.3: Alarm Handler
- Deploy alarm-handler Lambda connected to CloudWatch Alarm → SNS
- Route to team by AWS account ID, find on-call user
- Create incident and send push via APNs

#### Step 4.4: End-to-End Test on Physical iPhone
- Install app on iPhone via Xcode (ad-hoc or TestFlight)
- Create test team, schedule yourself as on-call
- Trigger CloudWatch Alarm manually
- **Validate:** Push received → tap opens app → incident visible → ack/resolve works

#### Step 4.5: Push Actions (Optional for MVP)
- Configure notification categories with Ack/Resolve buttons
- Handle action callbacks from background

---

### Phase 5: Escalation

**Goal:** Auto-escalate unacknowledged incidents.

#### Step 5.1: Escalation Scheduler
- Create EventBridge rule in alarm-handler with delay from escalation policy
- Create escalation-handler Lambda

#### Step 5.2: Escalation Logic
- Check incident state; if still triggered, send push to next target
- Update incident timeline, schedule next level if needed

#### Step 5.3: Cancel Escalation
- Delete EventBridge rule on ack/resolve
- Handle race conditions (incident acked during escalation)

---

### Phase 6: Polish & Production Release

**Goal:** Production-ready iOS release.

#### Step 6.1: Critical Alerts
- Apply for iOS Critical Alerts entitlement (requires Apple approval)
- Add custom alert sounds

#### Step 6.2: Error Handling & Offline
- Add error boundaries, retry logic
- Queue actions when offline, sync on reconnect

#### Step 6.3: Performance & Accessibility
- Optimize render performance, add loading skeletons
- Add VoiceOver accessibility labels

#### Step 6.4: TestFlight / App Store
- Set up TestFlight for beta testing
- Prepare App Store listing (if public release)

---

## Security Considerations

| Area             | Mitigation                                |
| ---------------- | ----------------------------------------- |
| Token storage    | Tauri secure store (Keychain/Keystore)    |
| API auth         | Cognito JWT, short expiry, refresh tokens |
| Push credentials | AWS Secrets Manager, Lambda IAM role      |
| Device tokens    | Scoped to user, cleaned on logout         |
| Incident access  | Lambda validates user's team membership   |

---

## Future Enhancements (Post-MVP)

- Schedule overrides (swap shifts)
- Incident notes/comments
- Slack integration (link to thread)
- Analytics dashboard
- Multi-account support
- Custom escalation policies per alarm
- Maintenance windows
- Runbook links

---

## Appendix: Environment Variables

### Lambda

```
COGNITO_USER_POOL_ID=
DYNAMODB_TABLE_PREFIX=
FCM_SERVER_KEY_SECRET_ARN=
APNS_KEY_SECRET_ARN=
APNS_KEY_ID=
APNS_TEAM_ID=
```

### Tauri App

```
VITE_API_URL=
VITE_COGNITO_USER_POOL_ID=
VITE_COGNITO_CLIENT_ID=
VITE_COGNITO_REGION=
```
