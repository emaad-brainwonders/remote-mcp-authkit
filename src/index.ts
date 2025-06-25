import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AuthkitHandler } from "./authkit-handler";
import type { Props } from "./props";
import { appointmentTool } from "./tools/appointment";

type Env = { AI?: any };

// Helper: Format date to YYYY-MM-DD
function formatDateToString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}`
  );
}

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "MCP server demo using AuthKit",
    version: "1.0.0",
  });

  async init() {
    // Only returns the current date in YYYY-MM-DD format (UTC)
    this.server.tool(
      "getCurrentDate",
      "Get the current date in UTC (YYYY-MM-DD format)",
      {},
      async () => {
        const nowUTC = new Date();
        const utcString = formatDateToString(nowUTC);
        return {
          content: [
            {
              type: "text",
              text: `Current UTC date: ${utcString}`,
            },
          ],
        };
      }
    );

    // Register the appointment tool from tools/appointment.ts
    this.server.tool(
      appointmentTool.name,
      appointmentTool.description,
      appointmentTool.inputSchema,
      appointmentTool.handler
    );
  }
}

export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: MyMCP.mount("/sse") as any,
  defaultHandler: AuthkitHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
