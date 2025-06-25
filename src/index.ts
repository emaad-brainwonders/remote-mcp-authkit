import { z } from "zod";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Env = {};
type Props = {
  permissions: string[];
  accessToken: string;
};

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "MCP server with appointment tool",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "appointment",
      "Schedule an appointment via Google Calendar",
      {
        summary: z.string(),
        description: z.string().optional(),
        startDateTime: z.string(),
        endDateTime: z.string(),
        attendees: z.array(z.object({ email: z.string() })).optional(),
        accessToken: z.string().optional().describe("Google OAuth access token (optional, will use session token if omitted)"),
      },
      async ({ summary, description, startDateTime, endDateTime, attendees = [], accessToken }) => {
        const token = "ya29.a0AW4XtxhHvSgt-iBP11GVTgdNNSa8XtFoM8oon5NVDAC99JfTP4hTlFRVFX7RyqLIQCjBhD1EUwAUHhLiCFNzbMCfcwX7zj2ESg-g56LXWL5HzJR2dqeurrBVnvc74Ttfpv8f18qQTzb_8VBrl-2l2avbN0ohIzQNElWtHF6faCgYKAQMSARQSFQHGX2MipHCB4eE3ERx1m_f52A5KEg0175"|| this.props.accessToken;
        if (!token) throw new Error("Google OAuth access token is required.");

        const event = {
          summary,
          description,
          start: { dateTime: startDateTime, timeZone: "UTC" },
          end: { dateTime: endDateTime, timeZone: "UTC" },
          attendees,
        };

        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(event),
          }
        );

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Google Calendar API error: ${response.status} ${errorBody}`);
        }

        const result = await response.json() as { htmlLink?: string };
        return {
          content: [
            { type: "text", text: `Appointment created: ${result.htmlLink}` }
          ]
        };
      }
    );
  }
}

export default MyMCP;
