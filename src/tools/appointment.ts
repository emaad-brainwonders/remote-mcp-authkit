import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN = "ya29.a0AS3H6NwSmk3rZggJyg_MQCQIV3eKw2wZ-VqcBfKY5Rz74zsORHH01CgnTvpTgp2AooRHJODcAAWG8q79cDUjd76ux_LdM_idOMzjUP6V72DpSUTBndcLKh9sMWnI76dECUgo7ZhUZncy5kvmuvEB_NiWAyxutAhaNb9mt-mAaCgYKATMSARQSFQHGX2MiV-nlz6o67aLHeRldXyp_WQ0175";

// Helper: Format date to YYYY-MM-DD   
function formatDateToString(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${date.getFullYear()}-` +
		`${pad(date.getMonth() + 1)}-` +
		`${pad(date.getDate())}`
	);
}

// Helper: Check if a time slot is available
function isTimeSlotAvailable(events: any[], startTime: string, endTime: string): boolean {
	const requestStart = new Date(startTime);
	const requestEnd = new Date(endTime);
	
	return !events.some(event => {
		if (!event.start?.dateTime || !event.end?.dateTime) return false;
		
		const eventStart = new Date(event.start.dateTime);
		const eventEnd = new Date(event.end.dateTime);
		
		// Check for overlap
		return (requestStart < eventEnd && requestEnd > eventStart);
	});
}

// Helper: Generate time slot recommendations
function generateTimeSlotRecommendations(events: any[], date: string): string[] {
	const recommendations: string[] = [];
	const workingHours = [
		{ start: 9, end: 12 }, // Morning
		{ start: 14, end: 17 }  // Afternoon
	];
	
	for (const period of workingHours) {
		for (let hour = period.start; hour < period.end; hour++) {
			const startTime = `${date}T${hour.toString().padStart(2, '0')}:00:00`;
			const endTime = `${date}T${(hour + 1).toString().padStart(2, '0')}:00:00`;
			
			if (isTimeSlotAvailable(events, startTime, endTime)) {
				const startFormatted = new Date(startTime).toLocaleTimeString('en-IN', { 
					hour: '2-digit', 
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
				const endFormatted = new Date(endTime).toLocaleTimeString('en-IN', { 
					hour: '2-digit', 
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
				
				recommendations.push(`${startFormatted} - ${endFormatted} (${startTime} to ${endTime})`);
			}
		}
	}
	
	return recommendations;
}

export function registerAppointmentTools(server: McpServer) {
	// Get schedule for a specific date
	server.tool(
		"getSchedule",
		"Get the schedule for a specific date from Google Calendar",
		{
			date: z.string().describe("Date in YYYY-MM-DD format"),
		},
		async ({ date }) => {
			const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
			
			if (!token) throw new Error("Google OAuth access token is required.");
			
			// Set time bounds for the day in Asia/Kolkata timezone
			const startDateTime = `${date}T00:00:00+05:30`;
			const endDateTime = `${date}T23:59:59+05:30`;
			
			const response = await fetch(
				`https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
				`timeMin=${encodeURIComponent(startDateTime)}&` +
				`timeMax=${encodeURIComponent(endDateTime)}&` +
				`singleEvents=true&` +
				`orderBy=startTime`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
				}
			);
			
			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(
					`Google Calendar API error: ${response.status} ${errorBody}`
				);
			}
			
			const result = await response.json() as { items?: any[] };
			const events = result.items || [];
			
			if (events.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No appointments scheduled for ${date}`,
						},
					],
				};
			}
			
			const scheduleText = events
				.map((event: any) => {
					const start = event.start?.dateTime || event.start?.date;
					const end = event.end?.dateTime || event.end?.date;
					const startTime = start ? new Date(start).toLocaleTimeString('en-IN', { 
						hour: '2-digit', 
						minute: '2-digit',
						timeZone: 'Asia/Kolkata'
					}) : 'All day';
					const endTime = end ? new Date(end).toLocaleTimeString('en-IN', { 
						hour: '2-digit', 
						minute: '2-digit',
						timeZone: 'Asia/Kolkata'
					}) : '';
					
					return `• ${event.summary || 'Untitled'} (${startTime}${endTime ? ' - ' + endTime : ''})`;
				})
				.join('\n');
			
			return {
				content: [
					{
						type: "text",
						text: `Schedule for ${date}:\n${scheduleText}`,
					},
				],
			};
		}
	);
	
	// Recommend available appointment times
	server.tool(
		"recommendAppointmentTimes",
		"Get recommended available appointment times for a specific date",
		{
			date: z.string().describe("Date in YYYY-MM-DD format"),
			duration: z.number().default(1).describe("Duration in hours (default: 1 hour)"),
		},
		async ({ date, duration = 1 }) => {
			const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
			
			if (!token) throw new Error("Google OAuth access token is required.");
			
			// Get existing events for the day
			const startDateTime = `${date}T00:00:00+05:30`;
			const endDateTime = `${date}T23:59:59+05:30`;
			
			const response = await fetch(
				`https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
				`timeMin=${encodeURIComponent(startDateTime)}&` +
				`timeMax=${encodeURIComponent(endDateTime)}&` +
				`singleEvents=true&` +
				`orderBy=startTime`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
				}
			);
			
			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(
					`Google Calendar API error: ${response.status} ${errorBody}`
				);
			}
			
			const result = await response.json() as { items?: any[] };
			const events = result.items || [];
			
			// Generate recommendations based on duration
			const recommendations: string[] = [];
			const workingHours = [
				{ start: 9, end: 12 }, // Morning
				{ start: 14, end: 17 }  // Afternoon
			];
			
			for (const period of workingHours) {
				for (let hour = period.start; hour <= period.end - duration; hour++) {
					const startTime = `${date}T${hour.toString().padStart(2, '0')}:00:00`;
					const endTime = `${date}T${(hour + duration).toString().padStart(2, '0')}:00:00`;
					
					if (isTimeSlotAvailable(events, startTime, endTime)) {
						const startFormatted = new Date(startTime).toLocaleTimeString('en-IN', { 
							hour: '2-digit', 
							minute: '2-digit',
							timeZone: 'Asia/Kolkata'
						});
						const endFormatted = new Date(endTime).toLocaleTimeString('en-IN', { 
							hour: '2-digit', 
							minute: '2-digit',
							timeZone: 'Asia/Kolkata'
						});
						
						recommendations.push(`${startFormatted} - ${endFormatted} (${startTime} to ${endTime})`);
					}
				}
			}
			
			if (recommendations.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No available ${duration}-hour slots found for ${date} during working hours (9 AM - 12 PM, 2 PM - 5 PM IST)`,
						},
					],
				};
			}
			
			return {
				content: [
					{
						type: "text",
						text: `Available ${duration}-hour appointment slots for ${date}:\n${recommendations.join('\n')}`,
					},
				],
			};
		}
	);
	
	// Schedule appointment tool (enhanced)
	server.tool(
		"scheduleAppointment",
		"Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone, and includes today's date in the description)",
		{
			summary: z.string(),
			description: z.string().optional(),
			startDateTime: z.string().describe("Start time in ISO format (e.g., 2024-01-15T10:00:00)"),
			endDateTime: z.string().describe("End time in ISO format (e.g., 2024-01-15T11:00:00)"),
			attendees: z.array(z.object({ email: z.string() })).optional(),
			checkAvailability: z.union([z.boolean(), z.string()]).default(true).transform((val) => {
				if (typeof val === 'string') {
					return val.toLowerCase() === 'true';
				}
				return val;
			}).describe("Check if the time slot is available before scheduling (true/false)"),
		},
		async ({
			summary,
			description,
			startDateTime,
			endDateTime,
			attendees = [],
			checkAvailability = true,
		}) => {
			const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
			const today = formatDateToString(new Date());
			
			if (!token) throw new Error("Google OAuth access token is required.");
			
			// Check availability if requested
			if (checkAvailability) {
				const startDate = startDateTime.split('T')[0];
				const dayStartTime = `${startDate}T00:00:00+05:30`;
				const dayEndTime = `${startDate}T23:59:59+05:30`;
				
				const checkResponse = await fetch(
					`https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(dayStartTime)}&` +
					`timeMax=${encodeURIComponent(dayEndTime)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
							"Content-Type": "application/json",
						},
					}
				);
				
				if (checkResponse.ok) {
					const checkResult = await checkResponse.json() as { items?: any[] };
					const existingEvents = checkResult.items || [];
					
					if (!isTimeSlotAvailable(existingEvents, startDateTime, endDateTime)) {
						return {
							content: [
								{
									type: "text",
									text: `Time slot ${startDateTime} to ${endDateTime} is not available. Please use the 'recommendAppointmentTimes' tool to find available slots.`,
								},
							],
						};
					}
				}
			}
			
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
						text: `Appointment successfully created: ${result.htmlLink}`,
					},
				],
			};
		}
	);
}
