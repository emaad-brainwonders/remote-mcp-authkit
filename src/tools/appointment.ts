import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN = "ya29.a0AS3H6Nyj0AeF2FRmpXrJ2aPt-4Z_tcgz2RSZE-oi_CkW7lQp_x2BenwEyDXMvsvFhHLtio_Y6weT3Y_r1lKNFls694HDbBhbBkY2rlsD0-t-1Uzhw3mcvmzxpR7WVlQgXQVuW8Nv_YKlegNLJjA7nUk17LGH2aDeDAIy2wddaCgYKAWISARQSFQHGX2MiIir6hpaeQlc6ckkuVWWMYg0175";

// Helper: Format date to YYYY-MM-DD   
function formatDateToString(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${date.getFullYear()}-` +
		`${pad(date.getMonth() + 1)}-` +
		`${pad(date.getDate())}`
	);
}

// Helper: Get current date in UTC
async function getCurrentDate(): Promise<string> {
	const nowUTC = new Date();
	return formatDateToString(nowUTC);
}

// Helper: Parse relative date expressions
function parseRelativeDate(dateInput: string): string {
	const today = new Date();
	
	// Handle "today", "tomorrow", "yesterday"
	if (dateInput.toLowerCase() === 'today') {
		return formatDateToString(today);
	}
	if (dateInput.toLowerCase() === 'tomorrow') {
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		return formatDateToString(tomorrow);
	}
	if (dateInput.toLowerCase() === 'yesterday') {
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		return formatDateToString(yesterday);
	}
	
	// Handle "X days from now", "in X days", "X days later"
	const relativeDayPatterns = [
		/(\d+)\s+days?\s+from\s+now/i,
		/in\s+(\d+)\s+days?/i,
		/(\d+)\s+days?\s+later/i,
		/after\s+(\d+)\s+days?/i
	];
	
	for (const pattern of relativeDayPatterns) {
		const match = dateInput.match(pattern);
		if (match) {
			const daysToAdd = parseInt(match[1]);
			const targetDate = new Date(today);
			targetDate.setDate(today.getDate() + daysToAdd);
			return formatDateToString(targetDate);
		}
	}
	
	// Handle "X days ago", "X days before"
	const pastDayPatterns = [
		/(\d+)\s+days?\s+ago/i,
		/(\d+)\s+days?\s+before/i
	];
	
	for (const pattern of pastDayPatterns) {
		const match = dateInput.match(pattern);
		if (match) {
			const daysToSubtract = parseInt(match[1]);
			const targetDate = new Date(today);
			targetDate.setDate(today.getDate() - daysToSubtract);
			return formatDateToString(targetDate);
		}
	}
	
	// Handle "next week", "next month" etc.
	if (dateInput.toLowerCase().includes('next week')) {
		const nextWeek = new Date(today);
		nextWeek.setDate(today.getDate() + 7);
		return formatDateToString(nextWeek);
	}
	
	if (dateInput.toLowerCase().includes('next month')) {
		const nextMonth = new Date(today);
		nextMonth.setMonth(today.getMonth() + 1);
		return formatDateToString(nextMonth);
	}
	
	// If it's already in YYYY-MM-DD format or a valid date string, return as is
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
		return dateInput;
	}
	
	// Try to parse as a date
	const parsedDate = new Date(dateInput);
	if (!isNaN(parsedDate.getTime())) {
		return formatDateToString(parsedDate);
	}
	
	// If all else fails, throw an error
	throw new Error(`Unable to parse date: "${dateInput}". Please use YYYY-MM-DD format or relative expressions like "10 days from now", "tomorrow", etc.`);
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
	// Get schedule for a specific date (now supports relative dates)
	server.tool(
		"getSchedule",
		"Get the schedule for a specific date from Google Calendar. Supports relative dates like 'today', 'tomorrow', '10 days from now', 'next week', etc.",
		{
			date: z.string().describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', 'next week', etc."),
		},
		async ({ date }) => {
			const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
			
			if (!token) throw new Error("Google OAuth access token is required.");
			
			// Parse the date input to handle relative expressions
			let parsedDate: string;
			try {
				parsedDate = parseRelativeDate(date);
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error parsing date: ${error instanceof Error ? error.message : 'Invalid date format'}`,
						},
					],
				};
			}
			
			// Set time bounds for the day in Asia/Kolkata timezone
			const startDateTime = `${parsedDate}T00:00:00+05:30`;
			const endDateTime = `${parsedDate}T23:59:59+05:30`;
			
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
							text: `No appointments scheduled for ${parsedDate} (interpreted from: "${date}")`,
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
						text: `Schedule for ${parsedDate} (interpreted from: "${date}"):\n${scheduleText}`,
					},
				],
			};
		}
	);
	
	// Recommend available appointment times (now supports relative dates)
	server.tool(
		"recommendAppointmentTimes",
		"Get recommended available appointment times for a specific date. Supports relative dates like 'today', 'tomorrow', '10 days from now', 'next week', etc.",
		{
			date: z.string().describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', 'next week', etc."),
			duration: z.number().default(0.5).describe("Duration in hours (default: 0.5 hours = 30 minutes)"),
		},
		async ({ date, duration = 0.5 }) => {
			const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
			
			if (!token) throw new Error("Google OAuth access token is required.");
			
			// Parse the date input to handle relative expressions
			let parsedDate: string;
			try {
				parsedDate = parseRelativeDate(date);
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error parsing date: ${error instanceof Error ? error.message : 'Invalid date format'}`,
						},
					],
				};
			}
			
			// Get existing events for the day
			const startDateTime = `${parsedDate}T00:00:00+05:30`;
			const endDateTime = `${parsedDate}T23:59:59+05:30`;
			
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
			
			// Convert duration to minutes for more precise slot generation
			const durationMinutes = duration * 60;
			const slotIntervalMinutes = 30; // Generate slots every 30 minutes
			
			for (const period of workingHours) {
				const startMinutes = period.start * 60; // Convert to minutes from midnight
				const endMinutes = period.end * 60;
				
				// Generate slots at 30-minute intervals
				for (let currentMinutes = startMinutes; currentMinutes <= endMinutes - durationMinutes; currentMinutes += slotIntervalMinutes) {
					const startHour = Math.floor(currentMinutes / 60);
					const startMinute = currentMinutes % 60;
					const endTotalMinutes = currentMinutes + durationMinutes;
					const endHour = Math.floor(endTotalMinutes / 60);
					const endMinuteValue = endTotalMinutes % 60;
					
					const startTime = `${parsedDate}T${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}:00`;
					const endTime = `${parsedDate}T${endHour.toString().padStart(2, '0')}:${endMinuteValue.toString().padStart(2, '0')}:00`;
					
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
						
						const durationText = duration === 1 ? '1 hour' : 
										   duration === 0.5 ? '30 minutes' : 
										   duration < 1 ? `${duration * 60} minutes` : 
										   `${duration} hours`;
						
						recommendations.push(`${startFormatted} - ${endFormatted} (${durationText})`);
					}
				}
			}
			
			if (recommendations.length === 0) {
				const durationText = duration === 1 ? '1-hour' : 
								   duration === 0.5 ? '30-minute' : 
								   duration < 1 ? `${duration * 60}-minute` : 
								   `${duration}-hour`;
				
				return {
					content: [
						{
							type: "text",
							text: `No available ${durationText} slots found for ${parsedDate} (interpreted from: "${date}") during working hours (9 AM - 12 PM, 2 PM - 5 PM IST)`,
						},
					],
				};
			}
			
			const durationText = duration === 1 ? '1-hour' : 
							   duration === 0.5 ? '30-minute' : 
							   duration < 1 ? `${duration * 60}-minute` : 
							   `${duration}-hour`;
			
			return {
				content: [
					{
						type: "text",
						text: `Available ${durationText} appointment slots for ${parsedDate} (interpreted from: "${date}"):\n${recommendations.join('\n')}`,
					},
				],
			};
		}
	);
	
	// Schedule appointment tool (enhanced with relative date support)
	server.tool(
		"scheduleAppointment",
		"Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone, and includes today's date in the description). Supports relative dates like 'today', 'tomorrow', '10 days from now', etc.",
		{
			summary: z.string(),
			description: z.string().optional(),
			date: z.string().describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', etc."),
			startTime: z.string().describe("Start time in HH:MM format (24-hour), e.g., '10:00'"),
			endTime: z.string().describe("End time in HH:MM format (24-hour), e.g., '11:00'"),
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
			date,
			startTime,
			endTime,
			attendees = [],
			checkAvailability = true,
		}) => {
			const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
			const today = await getCurrentDate();
			
			if (!token) throw new Error("Google OAuth access token is required.");
			
			// Parse the date input to handle relative expressions
			let parsedDate: string;
			try {
				parsedDate = parseRelativeDate(date);
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error parsing date: ${error instanceof Error ? error.message : 'Invalid date format'}`,
						},
					],
				};
			}
			
			// Construct full datetime strings
			const startDateTime = `${parsedDate}T${startTime}:00`;
			const endDateTime = `${parsedDate}T${endTime}:00`;
			
			// Check availability if requested
			if (checkAvailability) {
				const dayStartTime = `${parsedDate}T00:00:00+05:30`;
				const dayEndTime = `${parsedDate}T23:59:59+05:30`;
				
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
									text: `Time slot ${startTime} to ${endTime} on ${parsedDate} (interpreted from: "${date}") is not available. Please use the 'recommendAppointmentTimes' tool to find available slots.`,
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
						text: `Appointment successfully created for ${parsedDate} (interpreted from: "${date}") from ${startTime} to ${endTime}: ${result.htmlLink}`,
					},
				],
			};
		}
	);
}
