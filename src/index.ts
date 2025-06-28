import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthkitHandler } from "./authkit-handler";
import type { Props } from "./props";
import { registerDateTool } from "./tools/date";
import { setupAppointmentTools } from "./tools/appointment";
import { registerEmailTools } from "./tools/mail";
import { CalendarReminderService } from "./automation/calendarreminder";

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

    // Register reminder management tools
    this.registerReminderTools();

    // Initialize and start the calendar reminder service
    this.reminderService = new CalendarReminderService(this.env);
    await this.reminderService.startReminderAutomation();
  }

  private registerReminderTools() {
    // Tool to manually trigger reminder check
    this.server.setRequestHandler("tools/call", async (request) => {
      if (request.params.name === "test_reminders") {
        try {
          if (!this.reminderService) {
            return {
              content: [
                {
                  type: "text",
                  text: "Reminder service is not initialized"
                }
              ]
            };
          }

          const status = this.reminderService.getStatus();
          await this.reminderService.triggerCheck();
          
          return {
            content: [
              {
                type: "text",
                text: `Reminder check triggered successfully.\nStatus: ${JSON.stringify(status, null, 2)}`
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error testing reminders: ${error.message}`
              }
            ]
          };
        }
      }

      if (request.params.name === "reminder_status") {
        try {
          if (!this.reminderService) {
            return {
              content: [
                {
                  type: "text",
                  text: "Reminder service is not initialized"
                }
              ]
            };
          }

          const status = this.reminderService.getStatus();
          
          return {
            content: [
              {
                type: "text",
                text: `Reminder Service Status:\n${JSON.stringify(status, null, 2)}`
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting reminder status: ${error.message}`
              }
            ]
          };
        }
      }

      if (request.params.name === "restart_reminders") {
        try {
          if (this.reminderService) {
            await this.reminderService.cleanup();
          }
          
          this.reminderService = new CalendarReminderService(this.env);
          await this.reminderService.startReminderAutomation();
          
          const status = this.reminderService.getStatus();
          
          return {
            content: [
              {
                type: "text",
                text: `Reminder service restarted successfully.\nNew Status: ${JSON.stringify(status, null, 2)}`
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error restarting reminders: ${error.message}`
              }
            ]
          };
        }
      }

      // Return null to let other handlers process the request
      return null;
    });

    // Register the tools in the list
    this.server.setRequestHandler("tools/list", async () => {
      return {
        tools: [
          {
            name: "test_reminders",
            description: "Manually trigger a calendar reminder check to test the functionality",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: "reminder_status",
            description: "Get the current status of the calendar reminder service",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: "restart_reminders",
            description: "Restart the calendar reminder service",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          }
        ]
      };
    });
  }

  // Method to manually test reminders (for debugging)
  async testReminders() {
    if (this.reminderService) {
      console.log("Testing reminder service...");
      await this.reminderService.triggerCheck();
      return this.reminderService.getStatus();
    }
    return null;
  }

  // Method to get reminder service status
  getReminderStatus() {
    if (this.reminderService) {
      return this.reminderService.getStatus();
    }
    return { error: "Reminder service not initialized" };
  }

  // Method to restart reminder service
  async restartReminderService() {
    console.log("Restarting reminder service...");
    
    if (this.reminderService) {
      await this.reminderService.cleanup();
    }
    
    this.reminderService = new CalendarReminderService(this.env);
    await this.reminderService.startReminderAutomation();
    
    return this.reminderService.getStatus();
  }

  // Clean up when the server shuts down
  async cleanup() {
    console.log("Cleaning up MyMCP...");
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
