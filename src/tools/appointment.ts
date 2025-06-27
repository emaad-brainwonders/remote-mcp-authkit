import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN = "ya29.a0AS3H6NwdIDmoT542XsJnHfnbys0BLBwSylzTau9j6UdKjA2K55gYXCtrS5ebuLrnGTxm_3RBgdMid_gM41VAPq_N22MauEx8kDtF6acqsbb4yAREJxYik9yD8tsPYT0opv-U1UFZGsF3E7LmXdxYcCUrhPawoj26GYEdbMnwaCgYKAWESARQSFQHGX2MiV9FoTnIKYVJTHW_0g2e1yw0175";

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

// Helper: Format date for display
function formatDateForDisplay(dateString: string): string {
	const date = new Date(dateString + 'T00:00:00');
	const options: Intl.DateTimeFormatOptions = { 
		weekday: 'long', 
		year: 'numeric', 
		month: 'long', 
		day: 'numeric' 
	};
	return date.toLocaleDateString('en-IN', options);
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

// Helper: Parse attendees from various input formats
function parseAttendeesInput(attendees: any): string[] {
	if (!attendees) return [];
	
	// If it's already an array
	if (Array.isArray(attendees)) {
		return attendees
			.map(item => {
				if (typeof item === 'string') return item;
				if (typeof item === 'object' && item.email) return item.email;
				return null;
			})
			.filter(Boolean) as string[];
	}
	
	// If it's a string that looks like a JSON array
	if (typeof attendees === 'string') {
		try {
			// Try to parse as JSON first
			const parsed = JSON.parse(attendees);
			return parseAttendeesInput(parsed);
		} catch {
			// If JSON parsing fails, treat as a single email or comma-separated emails
			if (attendees.includes('@')) {
				// Split by comma and clean up
				return attendees
					.split(',')
					.map(email => email.trim())
					.filter(email => email.includes('@'));
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
	"scheduleAppointment",
	"Schedule a counselling session via Google Calendar (uses Asia/Kolkata timezone). Supports relative dates like 'today', 'tomorrow', '10 days from now', etc.",
	{
		userName: z.string().min(1).describe("Name of the person for whom the counselling session is being scheduled"),
		userEmail: z.string().email().describe("Email address of the person for whom the counselling session is being scheduled"),
		appointmentType: z.enum(["online", "offline"]).describe("Type of appointment - 'online' for virtual meeting or 'offline' for in-person meeting"),
		location: z.string().optional().describe("Location details - for online: meeting platform/link, for offline: physical address/room number"),
		description: z.string().optional().describe("Additional session description (optional)"),
		date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', etc."),
		startTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("Start time in HH:MM format (24-hour), e.g., '10:00' (session will automatically be 45 minutes long)"),
		additionalAttendees: z.union([
			z.array(z.string().email()),
			z.string()
		]).default([]).describe("Array of additional attendee email addresses (besides the user) or a JSON string of emails"),
		checkAvailability: z.coerce.boolean().default(true).describe("Check if the time slot is available before scheduling"),
	},
	async ({
		userName,
		userEmail,
		appointmentType,
		location,
		description,
		date,
		startTime,
		additionalAttendees = [],
		checkAvailability = true,
	}) => {
		try {
			const today = getCurrentDate();
			
			// Automatically generate the summary with the user's name and appointment type
			const summary = `Counselling session of ${userName} (${appointmentType.toUpperCase()})`;
			
			// Generate default location if not provided
			let appointmentLocation = location;
			if (!appointmentLocation) {
				appointmentLocation = appointmentType === "online" 
					? "Online meeting (link to be shared)" 
					: "Office location (to be confirmed)";
			}
			
			// Parse the date input to handle relative expressions
			const parsedDate = parseRelativeDate(date);
			const displayDate = formatDateForDisplay(parsedDate);
			
			// Validate time format (additional check)
			if (!validateTimeFormat(startTime)) {
				throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
			}
			
			// Calculate end time (45 minutes after start time)
			const startDate = new Date(`${parsedDate}T${startTime}:00`);
			const endDate = new Date(startDate.getTime() + 45 * 60 * 1000); // Add 45 minutes
			
			// Format end time back to HH:MM format
			const endTime = endDate.toTimeString().slice(0, 5);
			
			// Parse additional attendees from various input formats
			const parsedAdditionalAttendees = parseAttendeesInput(additionalAttendees);
			
			// Combine user email with additional attendees
			const allAttendees = [userEmail, ...parsedAdditionalAttendees];
			
			// Construct full datetime strings
			const startDateTime = `${parsedDate}T${startTime}:00`;
			const endDateTime = `${parsedDate}T${endTime}:00`;
			
			// Format times for display
			const displayStartTime = startDate.toLocaleTimeString('en-IN', { 
				hour: '2-digit', 
				minute: '2-digit',
				timeZone: 'Asia/Kolkata'
			});
			const displayEndTime = endDate.toLocaleTimeString('en-IN', { 
				hour: '2-digit', 
				minute: '2-digit',
				timeZone: 'Asia/Kolkata'
			});
			
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
								text: `⚠️ **Time slot unavailable**\n\nThe time slot ${displayStartTime} - ${displayEndTime} on ${displayDate} conflicts with an existing appointment.\n\n💡 Use the 'recommendAppointmentTimes' tool to find available slots that work for you.`,
							},
						],
					};
				}
			}
			
			// Build full description
			const fullDescriptionParts = [
				`Counselling session for: ${userName} (${userEmail})`,
				`Appointment Type: ${appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1)}`,
				`Location: ${appointmentLocation}`
			];
			
			if (description) {
				fullDescriptionParts.push(`Additional Notes: ${description}`);
			}
			
			fullDescriptionParts.push(`Scheduled on: ${today}`);
			
			const fullDescription = fullDescriptionParts.join('\n');
			
			const event = {
				summary,
				description: fullDescription,
				location: appointmentLocation,
				start: { dateTime: startDateTime, timeZone: "Asia/Kolkata" },
				end: { dateTime: endDateTime, timeZone: "Asia/Kolkata" },
				attendees: allAttendees.map(email => ({ email })),
			};
			
			// Add Google Meet link for online appointments
			if (appointmentType === "online" && !location) {
				event.conferenceData = {
					createRequest: {
						requestId: `counselling-${Date.now()}`,
						conferenceSolutionKey: {
							type: "hangoutsMeet"
						}
					}
				};
			}
			
			const result = await makeCalendarApiRequest(
				"https://www.googleapis.com/calendar/v3/calendars/primary/events",
				{
					method: "POST",
					body: JSON.stringify(event),
				},
				// Add conferenceDataVersion parameter for Google Meet integration
				appointmentType === "online" && !location ? "?conferenceDataVersion=1" : ""
			);
			
			// Determine appointment type emoji and details
			const typeEmoji = appointmentType === "online" ? "💻" : "🏢";
			const typeText = appointmentType === "online" ? "Online" : "In-Person";
			
			let responseText = `✅ **Counselling session scheduled successfully!**\n\n`;
			responseText += `📋 **Session:** ${summary}\n`;
			responseText += `👤 **Client:** ${userName} (${userEmail})\n`;
			responseText += `${typeEmoji} **Type:** ${typeText}\n`;
			responseText += `📍 **Location:** ${appointmentLocation}\n`;
			responseText += `📅 **Date:** ${displayDate}\n`;
			responseText += `⏰ **Duration:** 45 minutes (${displayStartTime} - ${displayEndTime})\n`;
			
			// Add Google Meet link if available
			if (result.conferenceData && result.conferenceData.entryPoints) {
				const meetLink = result.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video');
				if (meetLink) {
					responseText += `🔗 **Meeting Link:** ${meetLink.uri}\n`;
				}
			}
			
			if (description) {
				responseText += `📝 **Additional Notes:** ${description}\n`;
			}
			
			if (allAttendees.length > 0) {
				responseText += `👥 **All Attendees:** ${allAttendees.join(', ')}\n`;
			}
			
			if (result.htmlLink) {
				responseText += `\n🔗 [View in Google Calendar](${result.htmlLink})`;
			}
			
			responseText += `\n\n🎉 All set! The counselling session has been added to your calendar and all attendees have been notified.`;
			
			// Add specific instructions based on appointment type
			if (appointmentType === "online") {
				responseText += `\n\n💡 **Online Meeting Tips:**\n- Ensure stable internet connection\n- Test your camera and microphone beforehand\n- Join the meeting 5 minutes early`;
			} else {
				responseText += `\n\n💡 **In-Person Meeting Tips:**\n- Please arrive 10 minutes early\n- Bring any relevant documents\n- Contact us if you need directions`;
			}
			
			return {
				content: [
					{
						type: "text",
						text: responseText,
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `❌ **Failed to schedule counselling session**\n\n${error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'}\n\n💡 Double-check your date and time format, then try again.`,
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
				const displayDate = formatDateForDisplay(parsedDate);
				
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
					{ start: 9, end: 12, period: 'Morning' }, 
					{ start: 14, end: 17, period: 'Afternoon' }  
				];
				
				// Convert duration to minutes for more precise slot generation
				const durationMinutes = duration * 60;
				const slotIntervalMinutes = 30; // Generate slots every 30 minutes
				
				let morningSlots: string[] = [];
				let afternoonSlots: string[] = [];
				
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
							
							const timeSlot = `${startFormatted} - ${endFormatted}`;
							
							if (period.period === 'Morning') {
								morningSlots.push(timeSlot);
							} else {
								afternoonSlots.push(timeSlot);
							}
						}
					}
				}
				
				const durationText = duration === 1 ? '1 hour' : 
								   duration === 0.5 ? '30 minutes' : 
								   duration < 1 ? `${duration * 60} minutes` : 
								   `${duration} hours`;
				
				if (morningSlots.length === 0 && afternoonSlots.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `😔 **No availability found**\n\nI couldn't find any ${durationText} slots available on ${displayDate} during standard working hours (9 AM - 12 PM, 2 PM - 5 PM).\n\nYour day might be fully booked, or you might want to try a different date.`,
							},
						],
					};
				}
				
				let responseText = `⏰ **Available ${durationText} slots for ${displayDate}**\n\n`;
				
				if (morningSlots.length > 0) {
					responseText += `🌅 **Morning Options:**\n`;
					morningSlots.forEach((slot, index) => {
						responseText += `${index + 1}. ${slot}\n`;
					});
					responseText += '\n';
				}
				
				if (afternoonSlots.length > 0) {
					responseText += `🌤️ **Afternoon Options:**\n`;
					afternoonSlots.forEach((slot, index) => {
						responseText += `${index + 1}. ${slot}\n`;
					});
				}
				
				const totalSlots = morningSlots.length + afternoonSlots.length;
				responseText += `\n✨ Found ${totalSlots} available time ${totalSlots === 1 ? 'slot' : 'slots'} for you to choose from!`;
				
				return {
					content: [
						{
							type: "text",
							text: responseText.trim(),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `❌ I couldn't check your availability. ${error instanceof Error ? error.message : 'Please try again later.'}`,
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
			attendees: z.union([
				z.array(z.string().email()),
				z.string()
			]).default([]).describe("Array of attendee email addresses or a JSON string of emails"),
			checkAvailability: z.coerce.boolean().default(true).describe("Check if the time slot is available before scheduling"),
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
				const displayDate = formatDateForDisplay(parsedDate);
				
				// Validate time format (additional check)
				if (!validateTimeFormat(startTime) || !validateTimeFormat(endTime)) {
					throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
				}
				
				// Parse attendees from various input formats
				const parsedAttendees = parseAttendeesInput(attendees);
				
				// Construct full datetime strings
				const startDateTime = `${parsedDate}T${startTime}:00`;
				const endDateTime = `${parsedDate}T${endTime}:00`;
				
				// Validate that end time is after start time
				const startDate = new Date(startDateTime);
				const endDate = new Date(endDateTime);
				
				if (endDate <= startDate) {
					throw new Error("End time must be after start time");
				}
				
				// Format times for display
				const displayStartTime = startDate.toLocaleTimeString('en-IN', { 
					hour: '2-digit', 
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
				const displayEndTime = endDate.toLocaleTimeString('en-IN', { 
					hour: '2-digit', 
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
				
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
									text: `⚠️ **Time slot unavailable**\n\nThe time slot ${displayStartTime} - ${displayEndTime} on ${displayDate} conflicts with an existing appointment.\n\n💡 Use the 'recommendAppointmentTimes' tool to find available slots that work for you.`,
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
					attendees: parsedAttendees.map(email => ({ email })),
				};
				
				const result = await makeCalendarApiRequest(
					"https://www.googleapis.com/calendar/v3/calendars/primary/events",
					{
						method: "POST",
						body: JSON.stringify(event),
					}
				);
				
				let responseText = `✅ **Appointment scheduled successfully!**\n\n`;
				responseText += `📋 **Event:** ${summary}\n`;
				responseText += `📅 **Date:** ${displayDate}\n`;
				responseText += `⏰ **Time:** ${displayStartTime} - ${displayEndTime}\n`;
				
				if (description) {
					responseText += `📝 **Description:** ${description}\n`;
				}
				
				if (parsedAttendees.length > 0) {
					responseText += `👥 **Attendees:** ${parsedAttendees.join(', ')}\n`;
				}
				
				if (result.htmlLink) {
					responseText += `\n🔗 [View in Google Calendar](${result.htmlLink})`;
				}
				
				responseText += `\n\n🎉 All set! Your appointment has been added to your calendar.`;
				
				return {
					content: [
						{
							type: "text",
							text: responseText,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `❌ **Failed to schedule appointment**\n\n${error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'}\n\n💡 Double-check your date and time format, then try again.`,
						},
					],
				};
			}
		}
	);


server.tool(
   "cancelAppointment",
   "Cancel an existing appointment from Google Calendar by searching for it by title and date",
   {
      summary: z.string().min(1).describe("Title/summary of the appointment to cancel"),
      date: z.string().min(1).describe("Date of the appointment in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', etc."),
      exactMatch: z.coerce.boolean().default(false).describe("Whether to require exact title match (default: false for partial matching)"),
      confirmationRequired: z.coerce.boolean().default(false).describe("Whether to require confirmation before canceling (default: false)"),
   },
   async ({ summary, date, exactMatch = false, confirmationRequired = false }) => {
      try {
         // Parse the date input to handle relative expressions
         const parsedDate = parseRelativeDate(date);
         const displayDate = formatDateForDisplay(parsedDate);

         // Set time bounds for the day
         const startDateTime = `${parsedDate}T00:00:00+05:30`;
         const endDateTime = `${parsedDate}T23:59:59+05:30`;

         // Search for events on the specified date
         const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
            `timeMin=${encodeURIComponent(startDateTime)}&` +
            `timeMax=${encodeURIComponent(endDateTime)}&` +
            `singleEvents=true&` +
            `orderBy=startTime`;

         const searchResult = await makeCalendarApiRequest(searchUrl);
         const events: any[] = searchResult.items || [];

         if (events.length === 0) {
            return {
               content: [
                  {
                     type: "text",
                     text: `📅 **No appointments found**\n\nThere are no appointments scheduled for ${displayDate}.\n\n💡 Please check the date and try again.`,
                  },
               ],
            };
         }

         // Find matching events
         const matchingEvents = events.filter((event: any) => {
            if (!event.summary) return false;

            if (exactMatch) {
               return event.summary.toLowerCase() === summary.toLowerCase();
            } else {
               return event.summary.toLowerCase().includes(summary.toLowerCase());
            }
         });

         if (matchingEvents.length === 0) {
            // Show available appointments for better user experience
            const availableAppointments = events
               .filter((event: any) => event.summary)
               .map((event: any) => {
                  const start = event.start?.dateTime || event.start?.date;
                  let timeString = 'All day';
                  if (start && start.includes('T')) {
                     timeString = new Date(start).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata'
                     });
                  }
                  return `• ${event.summary} (${timeString})`;
               })
               .join('\n');

            return {
               content: [
                  {
                     type: "text",
                     text: `❌ **Appointment not found**\n\nI couldn't find an appointment matching "${summary}" on ${displayDate}.\n\n📋 **Available appointments on this date:**\n${availableAppointments}\n\n💡 Please check the appointment title and try again.`,
                  },
               ],
            };
         }

         // Handle multiple matches
         if (matchingEvents.length > 1) {
            const matchList = matchingEvents.map((event: any, index: number) => {
               const start = event.start?.dateTime || event.start?.date;
               let timeString = 'All day';
               if (start && start.includes('T')) {
                  timeString = new Date(start).toLocaleTimeString('en-IN', {
                     hour: '2-digit',
                     minute: '2-digit',
                     timeZone: 'Asia/Kolkata'
                  });
               }
               return `${index + 1}. ${event.summary} (${timeString})`;
            }).join('\n');

            return {
               content: [
                  {
                     type: "text",
                     text: `⚠️ **Multiple appointments found**\n\nFound ${matchingEvents.length} appointments matching "${summary}" on ${displayDate}:\n\n${matchList}\n\n💡 Please be more specific with the appointment title or use exactMatch=true for precise matching.`,
                  },
               ],
            };
         }

         const eventToCancel = matchingEvents[0];

         // Format the time for display
         const start = eventToCancel.start?.dateTime || eventToCancel.start?.date;
         let timeString = 'All day';
         if (start && start.includes('T')) {
            const startTime = new Date(start).toLocaleTimeString('en-IN', {
               hour: '2-digit',
               minute: '2-digit',
               timeZone: 'Asia/Kolkata'
            });

            const end = eventToCancel.end?.dateTime || eventToCancel.end?.date;
            if (end && end.includes('T')) {
               const endTime = new Date(end).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata'
               });
               timeString = `${startTime} - ${endTime}`;
            }
         }

         // Show confirmation if required
         if (confirmationRequired) {
            return {
               content: [
                  {
                     type: "text",
                     text: `⚠️ **Confirm Cancellation**\n\n📋 **Event:** ${eventToCancel.summary}\n📅 **Date:** ${displayDate}\n⏰ **Time:** ${timeString}\n${eventToCancel.description ? `📝 **Description:** ${eventToCancel.description}\n` : ''}\n🔗 **Event ID:** ${eventToCancel.id}\n\n❓ Are you sure you want to cancel this appointment? This action cannot be undone.\n\n💡 To proceed with cancellation, call this function again with confirmationRequired=false.`,
                  },
               ],
            };
         }

         // Cancel the event
         const cancelUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventToCancel.id}`;
         await makeCalendarApiRequest(cancelUrl, { method: "DELETE" });

         return {
            content: [
               {
                  type: "text",
                  text: `✅ **Appointment cancelled successfully!**\n\n📋 **Cancelled Event:** ${eventToCancel.summary}\n📅 **Date:** ${displayDate}\n⏰ **Time:** ${timeString}\n\n🗑️ The appointment has been permanently removed from your calendar.`,
               },
            ],
         };
      } catch (error) {
         // Enhanced error handling
         let errorMessage = 'An unexpected error occurred. Please try again.';

         if (error instanceof Error) {
            if (error.message.includes('404')) {
               errorMessage = 'The appointment no longer exists or has already been cancelled.';
            } else if (error.message.includes('403')) {
               errorMessage = 'Permission denied. Please check your calendar access permissions.';
            } else if (error.message.includes('401')) {
               errorMessage = 'Authentication failed. Please re-authenticate with Google Calendar.';
            } else {
               errorMessage = error.message;
            }
         }

         return {
            content: [
               {
                  type: "text",
                  text: `❌ **Failed to cancel appointment**\n\n${errorMessage}`,
               },
            ],
         };
      }
   }
);

// Reschedule appointment tool
server.tool(
   "rescheduleAppointment",
   "Reschedule an existing appointment to a new date and time",
   {
   	summary: z.string().min(1).describe("Title/summary of the appointment to reschedule"),
   	currentDate: z.string().min(1).describe("Current date of the appointment in YYYY-MM-DD format or relative expression"),
   	newDate: z.string().min(1).describe("New date for the appointment in YYYY-MM-DD format or relative expression"),
   	newStartTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("New start time in HH:MM format (24-hour)"),
   	newEndTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("New end time in HH:MM format (24-hour)"),
   	checkAvailability: z.coerce.boolean().default(true).describe("Check if the new time slot is available"),
   },
   async ({ summary, currentDate, newDate, newStartTime, newEndTime, checkAvailability = true }) => {
   	try {
   		// Parse the date inputs
   		const parsedCurrentDate = parseRelativeDate(currentDate);
   		const parsedNewDate = parseRelativeDate(newDate);
   		const displayCurrentDate = formatDateForDisplay(parsedCurrentDate);
   		const displayNewDate = formatDateForDisplay(parsedNewDate);
   		
   		// Validate new time format
   		if (!validateTimeFormat(newStartTime) || !validateTimeFormat(newEndTime)) {
   			throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
   		}
   		
   		// Find the existing appointment
   		const currentStartDateTime = `${parsedCurrentDate}T00:00:00+05:30`;
   		const currentEndDateTime = `${parsedCurrentDate}T23:59:59+05:30`;
   		
   		const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
   			`timeMin=${encodeURIComponent(currentStartDateTime)}&` +
   			`timeMax=${encodeURIComponent(currentEndDateTime)}&` +
   			`singleEvents=true&` +
   			`orderBy=startTime`;
   		
   		const searchResult = await makeCalendarApiRequest(searchUrl);
   		const events = searchResult.items || [];
   		
   		const eventToReschedule = events.find((event: any) => 
   			event.summary && event.summary.toLowerCase().includes(summary.toLowerCase())
   		);
   		
   		if (!eventToReschedule) {
   			return {
   				content: [
   					{
   						type: "text",
   						text: `❌ **Appointment not found**\n\nI couldn't find an appointment with the title "${summary}" on ${displayCurrentDate}.\n\n💡 Please check the appointment title and current date, then try again.`,
   					},
   				],
   			};
   		}
   		
   		// Validate new times
   		const newStartDateTime = `${parsedNewDate}T${newStartTime}:00`;
   		const newEndDateTime = `${parsedNewDate}T${newEndTime}:00`;
   		
   		const newStartDate = new Date(newStartDateTime);
   		const newEndDate = new Date(newEndDateTime);
   		
   		if (newEndDate <= newStartDate) {
   			throw new Error("New end time must be after new start time");
   		}
   		
   		// Check availability for new time slot if requested
   		if (checkAvailability) {
   			const newDayStartTime = `${parsedNewDate}T00:00:00+05:30`;
   			const newDayEndTime = `${parsedNewDate}T23:59:59+05:30`;
   			
   			const availabilityUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
   				`timeMin=${encodeURIComponent(newDayStartTime)}&` +
   				`timeMax=${encodeURIComponent(newDayEndTime)}&` +
   				`singleEvents=true&` +
   				`orderBy=startTime`;
   			
   			const availabilityResult = await makeCalendarApiRequest(availabilityUrl);
   			const existingEvents = (availabilityResult.items || []).filter((event: any) => 
   				event.id !== eventToReschedule.id // Exclude the current event being rescheduled
   			);
   			
   			if (!isTimeSlotAvailable(existingEvents, newStartDateTime, newEndDateTime)) {
   				const displayNewStartTime = newStartDate.toLocaleTimeString('en-IN', { 
   					hour: '2-digit', 
   					minute: '2-digit',
   					timeZone: 'Asia/Kolkata'
   				});
   				const displayNewEndTime = newEndDate.toLocaleTimeString('en-IN', { 
   					hour: '2-digit', 
   					minute: '2-digit',
   					timeZone: 'Asia/Kolkata'
   				});
   				
   				return {
   					content: [
   						{
   							type: "text",
   							text: `⚠️ **New time slot unavailable**\n\nThe new time slot ${displayNewStartTime} - ${displayNewEndTime} on ${displayNewDate} conflicts with another appointment.\n\n💡 Use the 'recommendAppointmentTimes' tool to find available slots.`,
   						},
   					],
   				};
   			}
   		}
   		
   		// Update the event
   		const updatedEvent = {
   			...eventToReschedule,
   			start: { dateTime: newStartDateTime, timeZone: "Asia/Kolkata" },
   			end: { dateTime: newEndDateTime, timeZone: "Asia/Kolkata" },
   		};
   		
   		const updateUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventToReschedule.id}`;
   		const result = await makeCalendarApiRequest(updateUrl, {
   			method: "PUT",
   			body: JSON.stringify(updatedEvent),
   		});
   		
   		// Format times for display
   		const displayNewStartTime = newStartDate.toLocaleTimeString('en-IN', { 
   			hour: '2-digit', 
   			minute: '2-digit',
   			timeZone: 'Asia/Kolkata'
   		});
   		const displayNewEndTime = newEndDate.toLocaleTimeString('en-IN', { 
   			hour: '2-digit', 
   			minute: '2-digit',
   			timeZone: 'Asia/Kolkata'
   		});
   		
   		let responseText = `✅ **Appointment rescheduled successfully!**\n\n`;
   		responseText += `📋 **Event:** ${eventToReschedule.summary}\n`;
   		responseText += `📅 **New Date:** ${displayNewDate}\n`;
   		responseText += `⏰ **New Time:** ${displayNewStartTime} - ${displayNewEndTime}\n`;
   		
   		if (result.htmlLink) {
   			responseText += `\n🔗 [View in Google Calendar](${result.htmlLink})`;
   		}
   		
   		responseText += `\n\n🎉 Your appointment has been successfully moved to the new time slot!`;
   		
   		return {
   			content: [
   				{
   					type: "text",
   					text: responseText,
   				},
   			],
   		};
   	} catch (error) {
   		return {
   			content: [
   				{
   					type: "text",
   					text: `❌ **Failed to reschedule appointment**\n\n${error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'}`,
   				},
   			],
   		};
   	}
   }
);
	
}
