import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Helper: Format date to YYYY-MM-DD   
function formatDateToString(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${date.getFullYear()}-` +
		`${pad(date.getMonth() + 1)}-` +
		`${pad(date.getDate())}`
	);
}

export function registerDateTool(server: McpServer) {
	// Only returns the current date in YYYY-MM-DD format (UTC)
	server.tool(
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
}
