import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AuthkitHandler } from "./authkit-handler";
import type { Props } from "./props";

type Env = { AI?: any };

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN =
  "ya29.a0AW4XtxgOsqTJjRvvd2rQ70StbfBeU5FZrKxv6abxCDZQWA2BFfmIK1svX0ssiTKwPO6o4ZBRz-BXxTxVxN6Q7EhQ0UR55eCXlAt56uYt3a5HtnBjmry3bOTo4L4pW458vDzGsgWhpd9uKLFja41oWhLjcZNOsfOk32mcIzEzaCgYKATMSARQSFQHGX2Mii1wxP6NcJHAKbvOkTaDwvg0175";

export class MyMCP extends McpAgent<Env, unknown, Props> {
	server = new McpServer({
		name: "MCP server demo using AuthKit",
		version: "1.0.0",
	});

	async init() {
		// Simpler: Required fields only. Attendees and description are optional.
		this.server.tool(
			"appointment",
			"Schedule an appointment via Google Calendar",
			{
				summary: z.string(),
				startDateTime: z.string(),
				endDateTime: z.string(),
				description: z.string().optional(),
				attendees: z.array(z.object({ email: z.string() })).optional(),
				accessToken: z.string().optional(),
			},
			async ({
				summary,
				startDateTime,
				endDateTime,
				description,
				attendees = [],
				accessToken,
			}) => {
				// Pick token from: param, props, or hardcoded fallback.
				const token = accessToken || this.props.accessToken || HARDCODED_GOOGLE_ACCESS_TOKEN;
				if (!token) throw new Error("Google OAuth access token is required.");

				// Build event payload. Only include optional fields if provided.
				const event: Record<string, any> = {
					summary,
					start: { dateTime: startDateTime, timeZone: "UTC" },
					end: { dateTime: endDateTime, timeZone: "UTC" },
				};
				if (description) event.description = description;
				if (attendees.length) event.attendees = attendees;

				// Send request to Google Calendar
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

				const result = await response.json();
				return {
					content: [
						{
							type: "text",
							text: result.htmlLink
								? `Appointment created: ${result.htmlLink}`
								: "Appointment created.",
						},
					],
				};
			}
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
