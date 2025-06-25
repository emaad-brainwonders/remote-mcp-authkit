

// For demo/testing only: hard-code a valid access token here
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AuthkitHandler } from "./authkit-handler";
import type { Props } from "./props";

const GOOGLE_CALENDAR_ACCESS_TOKEN = "ya29.a0AW4XtxhHvSgt-iBP11GVTgdNNSa8XtFoM8oon5NVDAC99JfTP4hTlFRVFX7RyqLIQCjBhD1EUwAUHhLiCFNzbMCfcwX7zj2ESg-g56LXWL5HzJR2dqeurrBVnvc74Ttfpv8f18qQTzb_8VBrl-2l2avbN0ohIzQNElWtHF6faCgYKAQMSARQSFQHGX2MipHCB4eE3ERx1m_f52A5KEg0175"; // Replace with your token

export class MyMCP extends McpAgent<Env, unknown, Props> {
	server = new McpServer({
		name: "MCP server demo using AuthKit",
		version: "1.0.0",
	});

	async init() {
		this.server.tool(
			"add",
			"Add two numbers the way only MCP can",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			})
		);

		if (this.props.permissions.includes("image_generation")) {
			this.server.tool(
				"generateImage",
				"Generate an image using the `flux-1-schnell` model. Works best with 8 steps.",
				{
					prompt: z.string().describe("A text description of the image you want to generate."),
					steps: z.number().min(4).max(8).default(4).describe("The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive."),
				},
				async ({ prompt, steps }) => {
					const env = this.env as Env;
					const response = await env.AI.run(
						"@cf/black-forest-labs/flux-1-schnell",
						{ prompt, steps }
					);

					return {
						content: [
							{
								type: "image",
								data: response.image!,
								mimeType: "image/jpeg",
							},
						],
					};
				}
			);
		}
	}
}

// --- Google Calendar Appointment Helper ---
async function createGoogleCalendarEvent(body: any) {
	const { summary, description, startDateTime, endDateTime, attendees = [] } = body;
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
				Authorization: `Bearer ${GOOGLE_CALENDAR_ACCESS_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(event),
		}
	);

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Google Calendar API error: ${response.status} ${errorBody}`);
	}

	return response.json();
}

// --- CORS Helper ---
function withCors(resp: Response) {
	const headers = new Headers(resp.headers);
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
	return new Response(resp.body, {
		status: resp.status,
		statusText: resp.statusText,
		headers,
	});
}

// --- Main Export: OAuthProvider + Custom API Route ---
export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return withCors(new Response(null, { status: 204 }));
		}

		// Add your Google Calendar appointment endpoint
		if (request.method === "POST" && url.pathname === "/api/schedule") {
			let data: any;
			try {
				data = await request.json();
			} catch {
				return withCors(new Response("Invalid JSON", { status: 400 }));
			}
			try {
				const result = await createGoogleCalendarEvent(data);
				return withCors(
					new Response(JSON.stringify(result), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					})
				);
			} catch (err: any) {
				return withCors(new Response(err.message, { status: 500 }));
			}
		}

		// Pass through to your OAuthProvider (MCP, AuthKit, etc)
		return OAuthProvider({
			apiRoute: "/sse",
			apiHandler: MyMCP.mount("/sse") as any,
			defaultHandler: AuthkitHandler as any,
			authorizeEndpoint: "/authorize",
			tokenEndpoint: "/token",
			clientRegistrationEndpoint: "/register",
		}).fetch(request, env, ctx) as Promise<Response>;
	},
};
