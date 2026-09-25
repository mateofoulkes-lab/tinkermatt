import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

const APP_RESOURCE_URI = "ui://tinkermatt/dashboard.html";
const READ_SECURITY = [{ type: "oauth2", scopes: ["tinkermatt.read"] }];
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const baseRegisterTool = (McpServer.prototype as any).registerTool;

(McpServer.prototype as any).registerTool = function appAwareRegisterTool(
  name: string,
  config: any,
  handler: (args: any) => any,
) {
  if (name === "editor_status" && !(this as any).__tmAppInstalled) {
    (this as any).__tmAppInstalled = true;
    const server = this as any;

    registerAppResource(
      server,
      "TinkerMatt Dashboard",
      APP_RESOURCE_URI,
      {
        description: "Compact TinkerMatt connection and project dashboard for ChatGPT.",
      },
      async () => ({
        contents: [
          {
            uri: APP_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: await readFile(new URL("./mcp-app.html", import.meta.url), "utf8"),
          },
        ],
      }),
    );

    const dashboardConfig: any = {
      title: "Open TinkerMatt dashboard",
      description:
        "Open the interactive TinkerMatt dashboard in ChatGPT and show whether the editor is connected, its version and current project.",
      inputSchema: z.object({}),
      annotations: readOnly,
      securitySchemes: READ_SECURITY,
      _meta: {
        securitySchemes: READ_SECURITY,
        ui: { resourceUri: APP_RESOURCE_URI },
      },
    };

    registerAppTool(server, "tinkermatt_dashboard", dashboardConfig, async () => {
      return await handler({});
    });

    // v0.4 publishes an explicit tools/list descriptor array. Append the app tool
    // there too, while leaving every existing modeling tool untouched.
    const descriptor = {
      name: "tinkermatt_dashboard",
      title: dashboardConfig.title,
      description: dashboardConfig.description,
      inputSchema: z.toJSONSchema(z.object({})),
      annotations: readOnly,
      securitySchemes: READ_SECURITY,
      _meta: dashboardConfig._meta,
    };

    const protocolServer = server.server;
    const previousSetRequestHandler = protocolServer.setRequestHandler.bind(protocolServer);
    protocolServer.setRequestHandler = (schema: any, requestHandler: any) => {
      if (schema === "tools/list") {
        return previousSetRequestHandler(schema, async (...args: any[]) => {
          const response = await requestHandler(...args);
          const tools = response?.tools ?? [];
          if (tools.some((tool: any) => tool?.name === descriptor.name)) return response;
          return { ...response, tools: [...tools, descriptor] };
        });
      }
      return previousSetRequestHandler(schema, requestHandler);
    };
  }

  return baseRegisterTool.call(this, name, config, handler);
};

// Install the App layer before v0.5.1/v0.5/v0.4 register their tools.
await import("./index-v51.js");
