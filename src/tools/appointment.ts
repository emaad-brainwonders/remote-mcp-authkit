import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN = "ya29.a0AS3H6Nyj0AeF2FRmpXrJ2aPt-4Z_tcgz2RSZE-oi_CkW7lQp_x2BenwEyDXMvsvFhHLtio_Y6weT3Y_r1lKNFls694HDbBhbBkY2rlsD0-t-1Uzhw3mcvmzxpR7WVlQgXQVuW8Nv_YKlegNLJjA7nUk17LGH2aDeDAIy2wddaCgYKAWISARQSFQHGX2MiIir6hpaeQlc6ckkuVWWMYg0175";

const getAccessToken = (): string => {
	if (!HARDCODED_GOOGLE_ACCESS_TOKEN) {
		throw new Error("Google OAuth access token is required.");
	}
	return HARDCODED_GOOGLE_ACCESS_TOKEN;
};

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
function getCurrentDate(): string {
	const nowUTC = new Date();
	return formatDateToString(nowUTC);
}

// Helper: Parse relative date expressions with better error handling
function parseRelativeDate(dateInput: string): string {
	if (!dateInput || typeof dateInput !== 'string') {
		throw new Error("Date input is required and must be a string");
	}

	const today = new Date();
	const inputLower = dateInput.toLowerCase().trim();
	
	// Handle "today", "tomorrow", "yesterday"
	if (inputLower === 'today') {
		return formatDateToString(today);
	}
	if (inputLower === 'tomorrow') {
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		return formatDateToString(tomorrow);
	}
	if (inputLower === 'yesterday') {
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
		const match = inputLower.match(pattern);
		if (match) {
			const daysToAdd = parseInt(match[1]);
			if (isNaN(daysToAdd) || daysToAdd < 0) {
				throw new Error(`Invalid number of days: ${match[1]}`);
			}
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
		const match = inputLower.match(pattern);
		if (match) {
			const daysToSubtract = parseInt(match[1]);
			if (isNaN(daysToSubtract) || daysToSubtract < 0) {
				throw new Error(`Invalid number of days: ${match[1]}`);
			}
			const targetDate = new Date(today);
			targetDate.setDate(today.getDate() - daysToSubtract);
			return formatDateToString(targetDate);
		}
	}
	
	// Handle "next week", "next month" etc.
	if (inputLower.includes('next week')) {
		const nextWeek = new Date(today);
		nextWeek.setDate(today.getDate() + 7);
		return formatDateToString(nextWeek);
	}
	
	if (inputLower.includes('next month')) {
		const nextMonth = new Date(today);
		nextMonth.setMonth(today.getMonth() + 1);
		return formatDateToString(nextMonth);
	}
	
	// If it's already in YYYY-MM-DD format, validate and return
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
		const testDate = new Date(dateInput + 'T00:00:00');
		if (isNaN(testDate.getTime())) {
			throw new Error(`Invalid date format: ${dateInput}`);
		}
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

// Helper: Validate time format
function validateTimeFormat(time: string): boolean {
	return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

// Helper: Check if a time slot is available
function isTimeSlotAvailable(events: any[], startTime: string, endTime: string): boolean {
	const requestStart = new Date(startTime);
	const requestEnd = new Date(endTime);
	
	if (isNaN(requestStart.getTime()) || isNaN(requestEnd.getTime())) {
		return false;
	}
	
	return !events.some(event => {
		if (!event.start?.dateTime || !event.end?.dateTime) return false;
		
		const eventStart = new Date(event.start.dateTime);
		const eventEnd = new Date(event.end.dateTime);
		
		if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) return false;
		
		// Check for overlap
		return (requestStart < eventEnd && requestEnd > eventStart);
	});
}

// Helper: Simplified attendee parsing
function parseAttendees(attendees: any): Array<{ email: string }> {
	if (!attendees) return [];
	
	// If it's already an array of objects with email property
	if (Array.isArray(attendees)) {
		return attendees
			.map(item => {
				if (typeof item === 'object' && item.email) {
					return { email: item.email };
				}
				if (typeof item === 'string' && item.includes('@')) {
					return { email: item };
				}
				return null;
			})
			.filter(Boolean) as Array<{ email: string }>;
	}
	
	// If it's a string, try to parse as JSON or treat as single email
	if (typeof attendees === 'string') {
		try {
			const parsed = JSON.parse(attendees);
			return parseAttendees(parsed);
		} catch {
			// If it's a simple email string
			if (attendees.includes('@')) {
				return [{ email: attendees }];
			}
		}
	}
	
	return [];
}

// Helper: Make API request with better error handling
async function makeCalendarApiRequest(url: string, options: RequestInit = {}): Promise<any> {
	try {
		const token = getAccessToken();
		
		const response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...options.headers,
			},
		});
		
		if (!response.ok) {
			const errorBody = await response.text();
			let errorMessage = `Google Calendar API error: ${response.status}`;
			
			try {
				const errorJson = JSON.parse(errorBody);
				if (errorJson.error?.message) {
					errorMessage += ` - ${errorJson.error.message}`;
				}
			} catch {
				errorMessage += ` - ${errorBody}`;
			}
			
			throw new Error(errorMessage);
		}
		
		return await response.json();
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error(`Unexpected error: ${String(error)}`);
	}
}

export function registerAppointmentTools(server: McpServer) {
	// Get schedule for a specific date
	server.tool(
		"getSchedule",
		"Get the schedule for a specific date from Google Calendar. Supports relative dates like 'today', 'tomorrow', '10 days from now', 'next week', etc.",
		{
			date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', 'next week', etc."),
		},
		async ({ date }) => {
			try {
				// Parse the date input to handle relative expressions
				const parsedDate = parseRelativeDate(date);
				
				// Set time bounds for the day in Asia/Kolkata timezone
				const startDateTime = `${parsedDate}T00:00:00+05:30`;
				const endDateTime = `${parsedDate}T23:59:59+05:30`;
				
				const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(startDateTime)}&` +
					`timeMax=${encodeURIComponent(endDateTime)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				
				const result = await makeCalendarApiRequest(url);
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
						
						let timeString = 'All day';
						if (start && start.includes('T')) {
							const startTime = new Date(start).toLocaleTimeString('en-IN', { 
								hour: '2-digit', 
								minute: '2-digit',
								timeZone: 'Asia/Kolkata'
							});
							
							if (end && end.includes('T')) {
								const endTime = new Date(end).toLocaleTimeString('en-IN', { 
									hour: '2-digit', 
									minute: '2-digit',
									timeZone: 'Asia/Kolkata'
								});
								timeString = `${startTime} - ${endTime}`;
							} else {
								timeString = startTime;
							}
						}
						
						return `• ${event.summary || 'Untitled'} (${timeString})`;
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
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error getting schedule: ${error instanceof Error ? error.message : 'Unknown error'}`,
						},
					],
				};
			}
		}
	);
	
	// Recommend available appointment times
	server.tool(
		"recommendAppointmentTimes",
		"Get recommended available appointment times for a specific date. Supports relative dates like 'today', 'tomorrow', '10 days from now', 'next week', etc.",
		{
			date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', 'next week', etc."),
			duration: z.number().min(0.25).max(8).default(0.5).describe("Duration in hours (default: 0.5 hours = 30 minutes, min: 0.25, max: 8)"),
		},
		async ({ date, duration = 0.5 }) => {
			try {
				// Parse the date input to handle relative expressions
				const parsedDate = parseRelativeDate(date);
				
				// Get existing events for the day
				const startDateTime = `${parsedDate}T00:00:00+05:30`;
				const endDateTime = `${parsedDate}T23:59:59+05:30`;
				
				const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(startDateTime)}&` +
					`timeMax=${encodeURIComponent(endDateTime)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				
				const result = await makeCalendarApiRequest(url);
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
					const startMinutes = period.start * 60;
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
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error getting recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`,
						},
					],
				};
			}
		}
	);
	
	// Schedule appointment tool
	server.tool(
		"scheduleAppointment",
		"Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone). Supports relative dates like 'today', 'tomorrow', '10 days from now', etc.",
		{
			summary: z.string().min(1).describe("Appointment title/summary"),
			description: z.string().optional().describe("Appointment description (optional)"),
			date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', etc."),
			startTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("Start time in HH:MM format (24-hour), e.g., '10:00'"),
			endTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("End time in HH:MM format (24-hour), e.g., '11:00'"),
			attendees: z.array(z.string().email()).default([]).describe("Array of attendee email addresses"),
			checkAvailability: z.boolean().default(true).describe("Check if the time slot is available before scheduling"),
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
			try {
				const today = getCurrentDate();
				
				// Parse the date input to handle relative expressions
				const parsedDate = parseRelativeDate(date);
				
				// Validate time format (additional check)
				if (!validateTimeFormat(startTime) || !validateTimeFormat(endTime)) {
					throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
				}
				
				// Construct full datetime strings
				const startDateTime = `${parsedDate}T${startTime}:00`;
				const endDateTime = `${parsedDate}T${endTime}:00`;
				
				// Validate that end time is after start time
				const startDate = new Date(startDateTime);
				const endDate = new Date(endDateTime);
				
				if (endDate <= startDate) {
					throw new Error("End time must be after start time");
				}
				
				// Check availability if requested
				if (checkAvailability) {
					const dayStartTime = `${parsedDate}T00:00:00+05:30`;
					const dayEndTime = `${parsedDate}T23:59:59+05:30`;
					
					const checkUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
						`timeMin=${encodeURIComponent(dayStartTime)}&` +
						`timeMax=${encodeURIComponent(dayEndTime)}&` +
						`singleEvents=true&` +
						`orderBy=startTime`;
					
					const checkResult = await makeCalendarApiRequest(checkUrl);
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
				
				const fullDescription = [
					description,
					`Scheduled on: ${today}`
				].filter(Boolean).join('\n');
				
				const event = {
					summary,
					description: fullDescription,
					start: { dateTime: startDateTime, timeZone: "Asia/Kolkata" },
					end: { dateTime: endDateTime, timeZone: "Asia/Kolkata" },
					attendees: attendees.map(email => ({ email })),
				};
				
				const result = await makeCalendarApiRequest(
					"https://www.googleapis.com/calendar/v3/calendars/primary/events",
					{
						method: "POST",
						body: JSON.stringify(event),
					}
				);
				
				return {
					content: [
						{
							type: "text",
							text: `Appointment "${summary}" successfully created for ${parsedDate} (interpreted from: "${date}") from ${startTime} to ${endTime}. Event link: ${result.htmlLink || 'N/A'}`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error scheduling appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
						},
					],
				};
			}
		}
	);
}
