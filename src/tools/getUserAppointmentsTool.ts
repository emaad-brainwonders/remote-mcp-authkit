import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeCalendarApiRequest, eventMatchesUser, formatDateForDisplay, shiftTimeBackwards530 } from "./appointment";

export function registerGetUserAppointmentsTool(server: McpServer, env: any) {
  server.tool(
    "getUserAppointments",
    "Get upcoming appointments for a user by name, email, or phone",
    {
      userName: z.string().optional().describe("User's full name (optional)"),
      userEmail: z.string().email().optional().describe("User's email address (optional)"),
      userPhone: z.string().optional().describe("User's phone number (optional)"),
    },
     async ({ userName, userEmail, userPhone }) => {
        try {
            // Fetch all upcoming events (next 30 days)
            const now = new Date().toISOString();
            const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(future)}&singleEvents=true&orderBy=startTime`;
            
            const result = await makeCalendarApiRequest(url, env);
            const events = (result.items || []).filter((event: any) => eventMatchesUser(event, { userName, userEmail, userPhone }));
            
            if (events.length === 0) {
                return { 
                    content: [{ 
                        type: "text", 
                        text: "No upcoming appointments found for the provided information." 
                    }] 
                };
            }
            
            const list = events.map((event: any) => {
                let date: string;
                if (event.start?.dateTime) {
                    // Shift 5:30 backwards for display
                    const shifted = shiftTimeBackwards530(event.start.dateTime);
                    date = new Date(shifted).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                } else if (event.start?.date) {
                    date = event.start.date;
                } else {
                    date = 'Unknown';
                }
                return `- ${event.summary || "No Title"} on ${date}`;
            }).join('\n');
            
            return { 
                content: [{ 
                    type: "text", 
                    text: `Your upcoming appointments:\n${list}` 
                }] 
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `❌ **Failed to retrieve appointments**\n\n${error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'}`
                }]
            };
        }
    }
);
}
