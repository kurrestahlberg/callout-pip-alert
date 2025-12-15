import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayAuthorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigatewayIntegrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "path";

// Common bundling options for local esbuild (no Docker)
const bundlingOptions: nodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  target: "node22",
  format: nodejs.OutputFormat.ESM,
  mainFields: ["module", "main"],
  esbuildArgs: { "--bundle": true },
};

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==================== COGNITO ====================
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "cw-alarms-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient("AppClient", {
      userPoolClientName: "cw-alarms-app",
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ==================== DYNAMODB TABLES ====================
    const usersTable = new dynamodb.Table(this, "UsersTable", {
      tableName: "cw-alarms-users",
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const teamsTable = new dynamodb.Table(this, "TeamsTable", {
      tableName: "cw-alarms-teams",
      partitionKey: { name: "team_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const schedulesTable = new dynamodb.Table(this, "SchedulesTable", {
      tableName: "cw-alarms-schedules",
      partitionKey: { name: "team_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "slot_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const incidentsTable = new dynamodb.Table(this, "IncidentsTable", {
      tableName: "cw-alarms-incidents",
      partitionKey: { name: "incident_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI for querying incidents by team and state
    incidentsTable.addGlobalSecondaryIndex({
      indexName: "team-state-index",
      partitionKey: { name: "team_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "state", type: dynamodb.AttributeType.STRING },
    });

    const devicesTable = new dynamodb.Table(this, "DevicesTable", {
      tableName: "cw-alarms-devices",
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "device_token", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==================== SNS TOPIC FOR ALARMS ====================
    const alarmsTopic = new sns.Topic(this, "AlarmsTopic", {
      topicName: "cw-alarms-topic",
    });

    // ==================== SECRETS FOR PUSH CREDENTIALS ====================
    const apnsSecret = new secretsmanager.Secret(this, "ApnsSecret", {
      secretName: "cw-alarms/apns-key",
      description: "APNs .p8 key for push notifications",
    });

    // ==================== LAMBDA FUNCTIONS ====================
    const functionsPath = path.join(__dirname, "../../packages/functions/src");

    const commonEnv = {
      USERS_TABLE: usersTable.tableName,
      TEAMS_TABLE: teamsTable.tableName,
      SCHEDULES_TABLE: schedulesTable.tableName,
      INCIDENTS_TABLE: incidentsTable.tableName,
      DEVICES_TABLE: devicesTable.tableName,
      APNS_SECRET_ARN: apnsSecret.secretArn,
    };

    // Devices handler
    const devicesHandler = new nodejs.NodejsFunction(this, "DevicesHandler", {
      functionName: "cw-alarms-devices",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      entry: path.join(functionsPath, "handlers/devices.ts"),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      bundling: bundlingOptions,
    });
    devicesTable.grantReadWriteData(devicesHandler);

    // Incidents handler
    const incidentsHandler = new nodejs.NodejsFunction(this, "IncidentsHandler", {
      functionName: "cw-alarms-incidents",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      entry: path.join(functionsPath, "handlers/incidents.ts"),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      bundling: bundlingOptions,
    });
    incidentsTable.grantReadWriteData(incidentsHandler);
    teamsTable.grantReadData(incidentsHandler);

    // Teams handler
    const teamsHandler = new nodejs.NodejsFunction(this, "TeamsHandler", {
      functionName: "cw-alarms-teams",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      entry: path.join(functionsPath, "handlers/teams.ts"),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      bundling: bundlingOptions,
    });
    teamsTable.grantReadWriteData(teamsHandler);
    usersTable.grantReadWriteData(teamsHandler);

    // Schedules handler
    const schedulesHandler = new nodejs.NodejsFunction(this, "SchedulesHandler", {
      functionName: "cw-alarms-schedules",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      entry: path.join(functionsPath, "handlers/schedules.ts"),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      bundling: bundlingOptions,
    });
    schedulesTable.grantReadWriteData(schedulesHandler);
    teamsTable.grantReadData(schedulesHandler);

    // Alarm handler (SNS triggered)
    const alarmHandler = new nodejs.NodejsFunction(this, "AlarmHandler", {
      functionName: "cw-alarms-alarm-handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      entry: path.join(functionsPath, "handlers/alarm-handler.ts"),
      environment: {
        ...commonEnv,
        ALARMS_TOPIC_ARN: alarmsTopic.topicArn,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: bundlingOptions,
    });
    incidentsTable.grantReadWriteData(alarmHandler);
    teamsTable.grantReadData(alarmHandler);
    schedulesTable.grantReadData(alarmHandler);
    devicesTable.grantReadData(alarmHandler);
    apnsSecret.grantRead(alarmHandler);
    alarmsTopic.addSubscription(new snsSubscriptions.LambdaSubscription(alarmHandler));

    // ==================== API GATEWAY ====================
    const httpApi = new apigateway.HttpApi(this, "HttpApi", {
      apiName: "cw-alarms-api",
      corsPreflight: {
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.POST,
          apigateway.CorsHttpMethod.PUT,
          apigateway.CorsHttpMethod.DELETE,
        ],
        allowOrigins: ["*"],
      },
    });

    // JWT Authorizer
    const authorizer = new apigatewayAuthorizers.HttpJwtAuthorizer(
      "JwtAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
      }
    );

    // Devices routes
    httpApi.addRoutes({
      path: "/devices",
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("DevicesPost", devicesHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/devices/{token}",
      methods: [apigateway.HttpMethod.DELETE],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("DevicesDelete", devicesHandler),
      authorizer,
    });

    // Incidents routes
    httpApi.addRoutes({
      path: "/incidents",
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("IncidentsList", incidentsHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/incidents/{id}",
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("IncidentsGet", incidentsHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/incidents/{id}/ack",
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("IncidentsAck", incidentsHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/incidents/{id}/resolve",
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("IncidentsResolve", incidentsHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/incidents/{id}/reassign",
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("IncidentsReassign", incidentsHandler),
      authorizer,
    });

    // Teams routes
    httpApi.addRoutes({
      path: "/teams",
      methods: [apigateway.HttpMethod.GET, apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("Teams", teamsHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/teams/{id}",
      methods: [apigateway.HttpMethod.GET, apigateway.HttpMethod.PUT],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("TeamsById", teamsHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/teams/{id}/members",
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("TeamsMembersAdd", teamsHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/teams/{id}/members/{uid}",
      methods: [apigateway.HttpMethod.DELETE],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("TeamsMembersRemove", teamsHandler),
      authorizer,
    });

    // Schedules routes
    httpApi.addRoutes({
      path: "/schedules/current",
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("SchedulesCurrent", schedulesHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/schedules/{team_id}",
      methods: [apigateway.HttpMethod.GET, apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("SchedulesByTeam", schedulesHandler),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/schedules/{team_id}/{slot_id}",
      methods: [apigateway.HttpMethod.DELETE],
      integration: new apigatewayIntegrations.HttpLambdaIntegration("SchedulesDelete", schedulesHandler),
      authorizer,
    });

    // ==================== OUTPUTS ====================
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      description: "API Gateway endpoint URL",
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
    });

    new cdk.CfnOutput(this, "AlarmsTopicArn", {
      value: alarmsTopic.topicArn,
      description: "SNS Topic ARN for CloudWatch Alarms",
    });

    new cdk.CfnOutput(this, "Region", {
      value: this.region,
      description: "AWS Region",
    });
  }
}
