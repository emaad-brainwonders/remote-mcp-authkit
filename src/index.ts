import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthkitHandler } from "./authkit-handler";
import type { Props } from "./props";
import { registerDateTool } from "./tools/date";
import { setupAppointmentTools } from "./tools/appointment";
import { registerEmailTools } from "./tools/mail";
import { CalendarReminderService } from "./automation/calendarreminder.ts";

// Define the Env type to match wrangler.json bindings
type Env = { 
  AI: any;
  GOOGLE_ACCESS_TOKEN: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_CLIENT_SECRET: string;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
};

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "MCP server demo using AuthKit",
    version: "1.0.0",
  });

  private reminderService: CalendarReminderService | null = null;

  async init() {
    // Register tools directly
    registerDateTool(this.server);
    setupAppointmentTools(this.server, this.env);
    registerEmailTools(this.server);

    // Initialize and start the calendar reminder service
    this.reminderService = new CalendarReminderService(this.env);
    await this.reminderService.startReminderAutomation();
  }

  // Clean up when the server shuts down
  async cleanup() {
    if (this.reminderService) {
      await this.reminderService.cleanup();
      this.reminderService = null;
    }
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
