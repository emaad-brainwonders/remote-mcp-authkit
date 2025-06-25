import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AuthkitHandler } from "./authkit-handler";
import type { Props } from "./props";

type Env = { AI?: any };

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN = env.GOOGLE_ACCESS_TOKEN;
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

		// Appointment scheduling tool now uses Asia/Kolkata timezone for India
		this.server.tool(
			"appointment",
			"Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone, and includes today's date in the description)",
			{
				summary: z.string(),
				description: z.string().optional(),
				startDateTime: z.string(),
				endDateTime: z.string(),
				attendees: z.array(z.object({ email: z.string() })).optional(),
			},
			async ({
				summary,
				description,
				startDateTime,
				endDateTime,
				attendees = [],
			}) => {
				const token = HARDCODED_GOOGLE_ACCESS_TOKEN;

				const today = formatDateToString(new Date());

				if (!token) throw new Error("Google OAuth access token is required.");

				const fullDescription =
					(description ? description + "\n" : "") +
					`Scheduled on (UTC): ${today}`;

				const event = {
					summary,
					description: fullDescription,
					start: { dateTime: startDateTime, timeZone: "Asia/Kolkata" },
					end: { dateTime: endDateTime, timeZone: "Asia/Kolkata" },
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
					throw new Error(
						`Google Calendar API error: ${response.status} ${errorBody}`
					);
				}

				const result = (await response.json()) as { htmlLink?: string };
				return {
					content: [
						{
							type: "text",
							text: `Appointment created: ${result.htmlLink}`,
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
