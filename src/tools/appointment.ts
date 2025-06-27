
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN = "ya29.a0AS3H6NyR_VmC-bdCyk5ewtqVKiIx82Be7FdngAWf6T5hxqpu6_mB-q05tRYLJCZWUVYKedaCFAPGRN3xMve-bVtZfkSG_pUAcjk9TT52eiEOdqkYTNve371Wvxr_dJtMDk42t6xz13htjG8xZK52HsWUILNuEgr4-EfWmva-lwaCgYKAYwSARQSFQHGX2MiL_GR2837lLnUNaoTzBDtww0177";

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
function eventMatchesUser(event: any, { userName, userEmail, userPhone }: { userName?: string, userEmail?: string, userPhone?: string }) {
    let found = false;
    // Match by summary (name)
    if (userName && event.summary && event.summary.toLowerCase().includes(userName.toLowerCase())) found = true;
    // Match by attendee email
    if (userEmail && event.attendees && event.attendees.some((a: any) => a.email && a.email.toLowerCase() === userEmail.toLowerCase())) found = true;
    // Match by phone in description
    if (userPhone && event.description && event.description.includes(userPhone)) found = true;
    return found;
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
				const displayDate = formatDateForDisplay(parsedDate);
				
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
								text: `🗓️ You have a completely free day on ${displayDate}! No appointments scheduled.`,
							},
						],
					};
				}
				
				const scheduleText = events
					.map((event: any, index: number) => {
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
						
						const eventTitle = event.summary || 'Untitled Event';
						return `${index + 1}. **${eventTitle}** - ${timeString}`;
					})
					.join('\n');
				
				const eventCount = events.length;
				const pluralText = eventCount === 1 ? 'appointment' : 'appointments';
				
				return {
					content: [
						{
							type: "text",
							text: `📅 **Your schedule for ${displayDate}**\n\nYou have ${eventCount} ${pluralText} planned:\n\n${scheduleText}`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `❌ I couldn't retrieve your schedule. ${error instanceof Error ? error.message : 'Please try again later.'}`,
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
		"Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone) with comprehensive user information and appointment format. Supports relative dates like 'today', 'tomorrow', '10 days from now', etc.",
		{
			// User Information (Required)
			userName: z.string().min(1).describe("Full name of the person booking the appointment"),
			userEmail: z.string().email().describe("Email address of the person booking the appointment"),
			userPhone: z.string().min(10).describe("Phone number of the person booking (with country code if international)"),
			// Appointment Details
			summary: z.string().min(1).describe("Appointment title/summary"),
			description: z.string().optional().describe("Appointment description (optional)"),
			appointmentType: z.enum(['online', 'offline']).describe("Type of appointment: 'online' for virtual meetings, 'offline' for in-person meetings"),
			// Date and Time
			date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', etc."),
			startTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("Start time in HH:MM format (24-hour), e.g., '10:00' - appointment will be automatically set to 45 minutes duration"),
			// Additional attendees (optional)
			attendees: z.union([
				z.array(z.string().email()),
				z.string()
			]).default([]).describe("Array of additional attendee email addresses or a JSON string of emails (excluding the main user)"),
			// Options
			checkAvailability: z.coerce.boolean().default(true).describe("Check if the time slot is available before scheduling"),
			sendReminder: z.coerce.boolean().default(true).describe("Send email reminder to the user"),
			requireConfirmation: z.coerce.boolean().default(false).describe("Require confirmation from the user before finalizing"),
		},
		async ({
			userName,
			userEmail,
			userPhone,
			summary,
			description,
			appointmentType,
			date,
			startTime,
			attendees = [],
			checkAvailability = true,
			sendReminder = true,
			requireConfirmation = false,
		}) => {
			try {
				const today = getCurrentDate();
				const parsedDate = parseRelativeDate(date);
				const displayDate = formatDateForDisplay(parsedDate);

				// Validate time format (additional check)
				if (!validateTimeFormat(startTime)) {
					throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
				}

				// Validate phone number format (basic validation)
				const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
				if (!phoneRegex.test(userPhone.replace(/[\s\-\(\)]/g, ''))) {
					throw new Error("Invalid phone number format. Please include country code for international numbers");
				}

				// Parse attendees from various input formats
				const parsedAttendees = parseAttendeesInput(attendees);
				const allAttendees = [userEmail, ...parsedAttendees].filter((email, index, arr) =>
					arr.indexOf(email) === index // Remove duplicates
				);

				// Calculate end time (45 minutes from start time)
				const startDateObj = new Date(`${parsedDate}T${startTime}:00`);
				const endDateObj = new Date(startDateObj.getTime() + 45 * 60 * 1000);

				const startDateTime = `${parsedDate}T${startTime}:00`;
				const endDateTime = endDateObj.toISOString().slice(0, 19);

				const displayStartTime = startDateObj.toLocaleTimeString('en-IN', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
				const displayEndTime = endDateObj.toLocaleTimeString('en-IN', {
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

				const appointmentDetails = [
					`👤 **Client Information:**`,
					`Name: ${userName}`,
					`Email: ${userEmail}`,
					`Phone: ${userPhone}`,
					``,
					`📋 **Appointment Details:**`,
					`Type: ${appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1)} Meeting`,
					`Duration: 45 minutes`,
				];

				if (description) {
					appointmentDetails.push(``, `📝 **Additional Notes:**`, description);
				}

				appointmentDetails.push(``, `🕐 **Scheduled on:** ${today}`);

				const fullDescription = appointmentDetails.join('\n');

				const event = {
					summary: `${summary} - ${userName}`,
					description: fullDescription,
					start: { dateTime: startDateTime, timeZone: "Asia/Kolkata" },
					end: { dateTime: endDateTime, timeZone: "Asia/Kolkata" },
					attendees: allAttendees.map(email => ({ email })),
					reminders: sendReminder ? {
						useDefault: false,
						overrides: [
							{ method: 'email', minutes: 24 * 60 },
							{ method: 'popup', minutes: 30 },
						],
					} : undefined,
				};

				const result = await makeCalendarApiRequest(
					"https://www.googleapis.com/calendar/v3/calendars/primary/events",
					{
						method: "POST",
						body: JSON.stringify(event),
					}
				);
				// In your main appointment script, after creating an appointment:
await sendAppointmentEmail({
  to: userEmail,
  emailType: 'created',
  appointmentDetails: {
    summary: ${summary} - ${userName},
    date: displayDate,
    time: displayStartTime,
    userName: userName
  }
});

// Schedule reminders
await scheduleAppointmentReminders({
  to: userEmail,
  appointmentDetails: {
    summary: appointmentTitle,
    dateTime: appointmentDateTime,
    userName: userName
  }
});

				let responseText = `✅ **Appointment scheduled successfully!**\n\n`;
				responseText += `👤 **Client:** ${userName}\n`;
				responseText += `📧 **Email:** ${userEmail}\n`;
				responseText += `📱 **Phone:** ${userPhone}\n\n`;
				responseText += `📋 **Event:** ${summary}\n`;
				responseText += `📅 **Date:** ${displayDate}\n`;
				responseText += `⏰ **Time:** ${displayStartTime} - ${displayEndTime} (45 minutes)\n`;
				responseText += `🔗 **Type:** ${appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1)} Meeting\n`;

				if (description) {
					responseText += `📝 **Description:** ${description}\n`;
				}

				if (parsedAttendees.length > 0) {
					responseText += `👥 **Additional Attendees:** ${parsedAttendees.join(', ')}\n`;
				}
				if (result.htmlLink) {
					responseText += `\n🔗 [View in Google Calendar](${result.htmlLink})`;
				}
				if (sendReminder) {
					responseText += `\n\n📨 **Reminders:** Email reminder will be sent 1 day before, popup reminder 30 minutes before`;
				}
				responseText += `\n\n🎉 All set! Your appointment has been added to your calendar and all attendees have been invited.`;
				if (requireConfirmation) {
					responseText += `\n\n⚠️ **Confirmation Required:** Please confirm your attendance by replying to the calendar invitation.`;
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
							text: `❌ **Failed to schedule appointment**\n\n${error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'}\n\n💡 Please check:\n- User information (name, email, phone)\n- Appointment type (online/offline)\n- Date and time format\n- Start time (appointments are automatically 45 minutes long)`,
						},
					],
				};
			}
		}
	);


// ... (existing imports, helpers, and other tools above)

// Cancel Appointment Tool (supports user info, NO confirmation step)
// Enhanced Cancel Appointment Tool
server.tool(
	"cancelAppointment",
	"Cancel an existing appointment from Google Calendar by searching for it by title, date, or user info",
	{
		summary: z.string().min(1).optional().describe("Title/summary of the appointment to cancel (optional if user info is provided)"),
		date: z.string().min(1).optional().describe("Date of the appointment in YYYY-MM-DD format or relative expression (optional if user info is provided)"),
		userName: z.string().optional().describe("Full name of the person booking the appointment (optional)"),
		userEmail: z.string().email().optional().describe("Email address of the person booking (optional)"),
		userPhone: z.string().optional().describe("Phone number of the person booking (optional)"),
		exactMatch: z.coerce.boolean().default(false).describe("Whether to require exact title match (default: false for partial matching)")
	},
	async ({ summary, date, userName, userEmail, userPhone, exactMatch = false }) => {
		try {
			// Validate that at least one search parameter is provided
			if (!summary && !date && !userName && !userEmail && !userPhone) {
				return {
					content: [{
						type: "text",
						text: "❌ **Missing search criteria**\n\nPlease provide at least one of the following:\n- Appointment title/summary\n- Date of appointment\n- User name, email, or phone number"
					}]
				};
			}

			// Determine search time window
			let events = [];
			let displayDate = "";
			let searchTimeWindow = "";

			if (date) {
				const parsedDate = parseRelativeDate(date);
				if (!parsedDate) {
					return {
						content: [{
							type: "text",
							text: "❌ **Invalid date format**\n\nPlease use YYYY-MM-DD format or relative expressions like 'today', 'tomorrow', 'next week', etc."
						}]
					};
				}
				displayDate = formatDateForDisplay(parsedDate);
				const startDateTime = `${parsedDate}T00:00:00+05:30`;
				const endDateTime = `${parsedDate}T23:59:59+05:30`;
				searchTimeWindow = `on ${displayDate}`;
				
				const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(startDateTime)}&` +
					`timeMax=${encodeURIComponent(endDateTime)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				const searchResult = await makeCalendarApiRequest(searchUrl);
				events = searchResult.items || [];
			} else {
				// Search upcoming 30 days
				const now = new Date().toISOString();
				const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
				searchTimeWindow = "in the next 30 days";
				
				const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(now)}&` +
					`timeMax=${encodeURIComponent(future)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				const result = await makeCalendarApiRequest(url);
				events = result.items || [];
			}

			if (events.length === 0) {
				return {
					content: [{
						type: "text",
						text: `📅 **No appointments found ${searchTimeWindow}**\n\nThere are no scheduled appointments in the specified time period.`
					}]
				};
			}

			// Enhanced event filtering with better matching logic
			const matchingEvents = events.filter((event: any) => {
				let titleMatch = true;
				let userMatch = true;

				// Title/summary matching
				if (summary) {
					const eventTitle = event.summary?.toLowerCase() || '';
					const searchTitle = summary.toLowerCase();
					titleMatch = exactMatch 
						? eventTitle === searchTitle
						: eventTitle.includes(searchTitle);
				}

				// User information matching
				if (userName || userEmail || userPhone) {
					userMatch = false; // Start with false, set to true if any user criterion matches
					
					// Check in event title
					if (userName && event.summary?.toLowerCase().includes(userName.toLowerCase())) {
						userMatch = true;
					}
					
					// Check in attendees
					if (userEmail && event.attendees?.some((attendee: any) => 
						attendee.email?.toLowerCase() === userEmail.toLowerCase())) {
						userMatch = true;
					}
					
					// Check in description
					if (userPhone && event.description?.includes(userPhone)) {
						userMatch = true;
					}
					
					// Check in description for name
					if (userName && event.description?.toLowerCase().includes(userName.toLowerCase())) {
						userMatch = true;
					}
				}

				return titleMatch && userMatch;
			});

			if (matchingEvents.length === 0) {
				let searchCriteria = [];
				if (summary) searchCriteria.push(`title containing "${summary}"`);
				if (userName) searchCriteria.push(`user name "${userName}"`);
				if (userEmail) searchCriteria.push(`email "${userEmail}"`);
				if (userPhone) searchCriteria.push(`phone "${userPhone}"`);
				
				return {
					content: [{
						type: "text",
						text: `🔍 **No matching appointments found**\n\nSearched ${searchTimeWindow} for appointments with:\n${searchCriteria.map(c => `• ${c}`).join('\n')}\n\n💡 **Tips:**\n• Check spelling of names and titles\n• Try searching with just the date\n• Use partial matches (exactMatch is ${exactMatch ? 'ON' : 'OFF'})`
					}]
				};
			}

			if (matchingEvents.length > 1) {
				const appointmentList = matchingEvents.map((event: any, index: number) => {
					const start = event.start?.dateTime || event.start?.date;
					const eventDate = start ? new Date(start).toLocaleDateString('en-IN') : 'Unknown date';
					let timeString = 'All day';
					
					if (start && start.includes('T')) {
						timeString = new Date(start).toLocaleTimeString('en-IN', {
							hour: '2-digit',
							minute: '2-digit',
							timeZone: 'Asia/Kolkata'
						});
					}
					
					return `${index + 1}. **${event.summary}**\n   📅 ${eventDate} at ${timeString}`;
				}).join('\n\n');

				return {
					content: [{
						type: "text",
						text: `⚠️ **Multiple appointments found (${matchingEvents.length})**\n\n${appointmentList}\n\n💡 **To cancel a specific appointment, please provide:**\n• More specific title\n• Exact date\n• Additional user information`
					}]
				};
			}

			// Cancel the single matching event
			const eventToCancel = matchingEvents[0];
			const start = eventToCancel.start?.dateTime || eventToCancel.start?.date;
			const eventDate = start ? new Date(start).toLocaleDateString('en-IN') : 'Unknown date';
			let timeString = 'All day';
			
			if (start && start.includes('T')) {
				timeString = new Date(start).toLocaleTimeString('en-IN', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
			}

			// Extract user information from the event for confirmation
			let userInfo = '';
			if (eventToCancel.description) {
				const nameMatch = eventToCancel.description.match(/Name: ([^\n]+)/);
				const emailMatch = eventToCancel.description.match(/Email: ([^\n]+)/);
				const phoneMatch = eventToCancel.description.match(/Phone: ([^\n]+)/);
				
				if (nameMatch || emailMatch || phoneMatch) {
					userInfo = '\n👤 **Client Details:**\n';
					if (nameMatch) userInfo += `Name: ${nameMatch[1]}\n`;
					if (emailMatch) userInfo += `Email: ${emailMatch[1]}\n`;
					if (phoneMatch) userInfo += `Phone: ${phoneMatch[1]}\n`;
				}
			}

			// Perform the cancellation
			const cancelUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventToCancel.id}`;
			await makeCalendarApiRequest(cancelUrl, { method: "DELETE" });

			return {
				content: [{
					type: "text",
					text: `✅ **Appointment cancelled successfully!**\n\n📋 **Cancelled Event:** ${eventToCancel.summary}\n📅 **Date:** ${eventDate}\n⏰ **Time:** ${timeString}${userInfo}\n\n🗑️ The appointment has been permanently removed from your calendar and all attendees have been notified.`
				}]
			};

		} catch (error) {
			let errorMessage = 'An unexpected error occurred while cancelling the appointment.';
			
			if (error instanceof Error) {
				if (error.message.includes('404')) {
					errorMessage = 'The appointment no longer exists or has already been cancelled.';
				} else if (error.message.includes('403')) {
					errorMessage = 'Permission denied. Please check your Google Calendar access permissions.';
				} else if (error.message.includes('401')) {
					errorMessage = 'Authentication failed. Please re-authenticate with Google Calendar.';
				} else if (error.message.includes('400')) {
					errorMessage = 'Invalid request. Please check the appointment details and try again.';
				} else {
					errorMessage = error.message;
				}
			}

			return {
				content: [{
					type: "text",
					text: `❌ **Failed to cancel appointment**\n\n${errorMessage}\n\n💡 **Troubleshooting:**\n• Verify the appointment exists\n• Check your calendar permissions\n• Try searching with different criteria`
				}]
			};
		}
	}
);

// Enhanced Reschedule Appointment Tool (uses cancel and schedule tools)
server.tool(
	"rescheduleAppointment",
	"Reschedule an existing appointment to a new date and time by canceling the old one and creating a new one",
	{
		// Original appointment search criteria
		summary: z.string().min(1).optional().describe("Title/summary of the appointment to reschedule (optional if user info is provided)"),
		currentDate: z.string().min(1).optional().describe("Current date of the appointment in YYYY-MM-DD format or relative expression (optional if user info is provided)"),
		userName: z.string().optional().describe("Full name of the person booking the appointment (optional)"),
		userEmail: z.string().email().optional().describe("Email address of the person booking (optional)"),
		userPhone: z.string().optional().describe("Phone number of the person booking (optional)"),
		
		// New appointment details
		newDate: z.string().min(1).describe("New date for the appointment in YYYY-MM-DD format or relative expression"),
		newStartTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("New start time in HH:MM format (24-hour)"),
		newSummary: z.string().optional().describe("New title/summary for the appointment (optional - keeps original if not provided)"),
		newDescription: z.string().optional().describe("New description for the appointment (optional - keeps original if not provided)"),
		newAppointmentType: z.enum(['online', 'offline']).optional().describe("New appointment type (optional - keeps original if not provided)"),
		
		// Options
		checkAvailability: z.coerce.boolean().default(true).describe("Check if the new time slot is available before rescheduling"),
		sendReminder: z.coerce.boolean().default(true).describe("Send email reminder for the new appointment"),
	},
	async ({ 
		summary, 
		currentDate, 
		userName, 
		userEmail, 
		userPhone,
		newDate, 
		newStartTime, 
		newSummary,
		newDescription,
		newAppointmentType,
		checkAvailability = true,
		sendReminder = true 
	}) => {
		try {
			// Step 1: Validate inputs
			if (!summary && !currentDate && !userName && !userEmail && !userPhone) {
				return {
					content: [{
						type: "text",
						text: "❌ **Missing search criteria**\n\nTo reschedule an appointment, please provide at least one of:\n• Appointment title/summary\n• Current date of appointment\n• User name, email, or phone number"
					}]
				};
			}

			// Validate new date and time
			const parsedNewDate = parseRelativeDate(newDate);
			if (!parsedNewDate) {
				return {
					content: [{
						type: "text",
						text: "❌ **Invalid new date format**\n\nPlease use YYYY-MM-DD format or relative expressions like 'today', 'tomorrow', 'next week', etc."
					}]
				};
			}

			if (!validateTimeFormat(newStartTime)) {
				return {
					content: [{
						type: "text",
						text: "❌ **Invalid time format**\n\nPlease use HH:MM format (24-hour), e.g., '10:00', '14:30'"
					}]
				};
			}

			// Step 2: Find the appointment to reschedule (similar logic to cancel tool)
			let events = [];
			let searchTimeWindow = "";

			if (currentDate) {
				const parsedCurrentDate = parseRelativeDate(currentDate);
				if (!parsedCurrentDate) {
					return {
						content: [{
							type: "text",
							text: "❌ **Invalid current date format**\n\nPlease use YYYY-MM-DD format or relative expressions."
						}]
					};
				}
				
				const startDateTime = `${parsedCurrentDate}T00:00:00+05:30`;
				const endDateTime = `${parsedCurrentDate}T23:59:59+05:30`;
				searchTimeWindow = `on ${formatDateForDisplay(parsedCurrentDate)}`;
				
				const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(startDateTime)}&` +
					`timeMax=${encodeURIComponent(endDateTime)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				const searchResult = await makeCalendarApiRequest(searchUrl);
				events = searchResult.items || [];
			} else {
				// Search upcoming 30 days
				const now = new Date().toISOString();
				const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
				searchTimeWindow = "in the next 30 days";
				
				const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(now)}&` +
					`timeMax=${encodeURIComponent(future)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				const result = await makeCalendarApiRequest(url);
				events = result.items || [];
			}

			// Filter events using the same logic as cancel tool
			const matchingEvents = events.filter((event: any) => {
				let titleMatch = true;
				let userMatch = true;

				if (summary) {
					const eventTitle = event.summary?.toLowerCase() || '';
					const searchTitle = summary.toLowerCase();
					titleMatch = eventTitle.includes(searchTitle);
				}

				if (userName || userEmail || userPhone) {
					userMatch = false;
					
					if (userName && event.summary?.toLowerCase().includes(userName.toLowerCase())) {
						userMatch = true;
					}
					
					if (userEmail && event.attendees?.some((attendee: any) => 
						attendee.email?.toLowerCase() === userEmail.toLowerCase())) {
						userMatch = true;
					}
					
					if (userPhone && event.description?.includes(userPhone)) {
						userMatch = true;
					}
					
					if (userName && event.description?.toLowerCase().includes(userName.toLowerCase())) {
						userMatch = true;
					}
				}

				return titleMatch && userMatch;
			});

			if (matchingEvents.length === 0) {
				return {
					content: [{
						type: "text",
						text: `🔍 **No matching appointments found**\n\nSearched ${searchTimeWindow} but couldn't find an appointment matching your criteria.\n\n💡 Please verify:\n• Appointment title/summary\n• Current date\n• User information`
					}]
				};
			}

			if (matchingEvents.length > 1) {
				const appointmentList = matchingEvents.map((event: any, index: number) => {
					const start = event.start?.dateTime || event.start?.date;
					const eventDate = start ? new Date(start).toLocaleDateString('en-IN') : 'Unknown date';
					let timeString = 'All day';
					
					if (start && start.includes('T')) {
						timeString = new Date(start).toLocaleTimeString('en-IN', {
							hour: '2-digit',
							minute: '2-digit',
							timeZone: 'Asia/Kolkata'
						});
					}
					
					return `${index + 1}. **${event.summary}**\n   📅 ${eventDate} at ${timeString}`;
				}).join('\n\n');

				return {
					content: [{
						type: "text",
						text: `⚠️ **Multiple appointments found (${matchingEvents.length})**\n\n${appointmentList}\n\n💡 Please be more specific with:\n• Exact appointment title\n• Specific date\n• Additional user details`
					}]
				};
			}

			// Step 3: Extract information from the original appointment
			const originalEvent = matchingEvents[0];
			const originalStart = originalEvent.start?.dateTime || originalEvent.start?.date;
			const originalDate = originalStart ? new Date(originalStart).toLocaleDateString('en-IN') : 'Unknown date';
			let originalTime = 'All day';
			
			if (originalStart && originalStart.includes('T')) {
				originalTime = new Date(originalStart).toLocaleTimeString('en-IN', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
			}

			// Extract user information from original event
			let extractedUserName = userName;
			let extractedUserEmail = userEmail;
			let extractedUserPhone = userPhone;
			let extractedAppointmentType = newAppointmentType;
			let extractedDescription = newDescription || originalEvent.description;

			if (originalEvent.description) {
				const nameMatch = originalEvent.description.match(/Name: ([^\n]+)/);
				const emailMatch = originalEvent.description.match(/Email: ([^\n]+)/);
				const phoneMatch = originalEvent.description.match(/Phone: ([^\n]+)/);
				const typeMatch = originalEvent.description.match(/Type: (\w+)/);

				if (!extractedUserName && nameMatch) extractedUserName = nameMatch[1];
				if (!extractedUserEmail && emailMatch) extractedUserEmail = emailMatch[1];
				if (!extractedUserPhone && phoneMatch) extractedUserPhone = phoneMatch[1];
				if (!extractedAppointmentType && typeMatch) {
					extractedAppointmentType = typeMatch[1].toLowerCase().includes('online') ? 'online' : 'offline';
				}
			}

			// Get attendees from original event
			const originalAttendees = originalEvent.attendees?.map((attendee: any) => attendee.email).filter((email: string) => email !== extractedUserEmail) || [];

			// Step 4: Check availability for new time slot if requested
			if (checkAvailability) {
				const newStartDateTime = `${parsedNewDate}T${newStartTime}:00`;
				const newStartDateObj = new Date(newStartDateTime);
				const newEndDateObj = new Date(newStartDateObj.getTime() + 45 * 60 * 1000);
				
				const dayStartTime = `${parsedNewDate}T00:00:00+05:30`;
				const dayEndTime = `${parsedNewDate}T23:59:59+05:30`;
				const checkUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(dayStartTime)}&` +
					`timeMax=${encodeURIComponent(dayEndTime)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				const checkResult = await makeCalendarApiRequest(checkUrl);
				const existingEvents = (checkResult.items || []).filter((event: any) => event.id !== originalEvent.id);
				
				if (!isTimeSlotAvailable(existingEvents, newStartDateTime, newEndDateObj.toISOString().slice(0, 19))) {
					const displayNewDate = formatDateForDisplay(parsedNewDate);
					const displayStartTime = newStartDateObj.toLocaleTimeString('en-IN', {
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'Asia/Kolkata'
					});
					const displayEndTime = newEndDateObj.toLocaleTimeString('en-IN', {
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'Asia/Kolkata'
					});
					
					return {
						content: [{
							type: "text",
							text: `⚠️ **New time slot unavailable**\n\nThe requested time slot ${displayStartTime} - ${displayEndTime} on ${displayNewDate} conflicts with an existing appointment.\n\n💡 **Suggestions:**\n• Try a different time\n• Use 'recommendAppointmentTimes' tool to find available slots\n• Set checkAvailability to false to override (not recommended)`
						}]
					};
				}
			}

			// Step 5: Cancel the original appointment
			const cancelUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${originalEvent.id}`;
			await makeCalendarApiRequest(cancelUrl, { method: "DELETE" });

			// Step 6: Create the new appointment using the scheduleAppointment logic
			if (!extractedUserName || !extractedUserEmail || !extractedUserPhone) {
				return {
					content: [{
						type: "text",
						text: `❌ **Missing required user information**\n\nCould not extract complete user information from the original appointment. Please provide:\n${!extractedUserName ? '• User name\n' : ''}${!extractedUserEmail ? '• User email\n' : ''}${!extractedUserPhone ? '• User phone\n' : ''}\n\n⚠️ **Note:** The original appointment has been cancelled but the new one could not be created.`
					}]
				};
			}

			// Create new appointment
			const newAppointmentSummary = newSummary || originalEvent.summary;
			const finalAppointmentType = extractedAppointmentType || 'online';
			
			const newStartDateTime = `${parsedNewDate}T${newStartTime}:00`;
			const newStartDateObj = new Date(newStartDateTime);
			const newEndDateObj = new Date(newStartDateObj.getTime() + 45 * 60 * 1000);
			const newEndDateTime = newEndDateObj.toISOString().slice(0, 19);

			const today = getCurrentDate();
			const appointmentDetails = [
				`👤 **Client Information:**`,
				`Name: ${extractedUserName}`,
				`Email: ${extractedUserEmail}`,
				`Phone: ${extractedUserPhone}`,
				``,
				`📋 **Appointment Details:**`,
				`Type: ${finalAppointmentType.charAt(0).toUpperCase() + finalAppointmentType.slice(1)} Meeting`,
				`Duration: 45 minutes`,
			];

			if (extractedDescription && !extractedDescription.includes('Client Information:')) {
				appointmentDetails.push(``, `📝 **Additional Notes:**`, extractedDescription);
			}

			appointmentDetails.push(``, `🕐 **Rescheduled on:** ${today}`);
			appointmentDetails.push(`📅 **Originally scheduled:** ${originalDate} at ${originalTime}`);

			const fullDescription = appointmentDetails.join('\n');

			const newEvent = {
				summary: `${newAppointmentSummary} - ${extractedUserName}`,
				description: fullDescription,
				start: { dateTime: `${newStartDateTime}:00`, timeZone: "Asia/Kolkata" },
				end: { dateTime: `${newEndDateTime}:00`, timeZone: "Asia/Kolkata" },
				attendees: [extractedUserEmail, ...originalAttendees].map((email: string) => ({ email })),
				reminders: sendReminder ? {
					useDefault: false,
					overrides: [
						{ method: 'email', minutes: 24 * 60 },
						{ method: 'popup', minutes: 30 },
					],
				} : undefined,
			};

			const result = await makeCalendarApiRequest(
				"https://www.googleapis.com/calendar/v3/calendars/primary/events",
				{
					method: "POST",
					body: JSON.stringify(newEvent),
				}
			);

			// Step 7: Success response
			const displayNewDate = formatDateForDisplay(parsedNewDate);
			const displayNewStartTime = newStartDateObj.toLocaleTimeString('en-IN', {
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Asia/Kolkata'
			});
			const displayNewEndTime = newEndDateObj.toLocaleTimeString('en-IN', {
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Asia/Kolkata'
			});

			let responseText = `✅ **Appointment rescheduled successfully!**\n\n`;
			responseText += `🔄 **Reschedule Details:**\n`;
			responseText += `**From:** ${originalDate} at ${originalTime}\n`;
			responseText += `**To:** ${displayNewDate} at ${displayNewStartTime} - ${displayNewEndTime}\n\n`;
			responseText += `👤 **Client:** ${extractedUserName}\n`;
			responseText += `📧 **Email:** ${extractedUserEmail}\n`;
			responseText += `📱 **Phone:** ${extractedUserPhone}\n\n`;
			responseText += `📋 **Event:** ${newAppointmentSummary}\n`;
			responseText += `🔗 **Type:** ${finalAppointmentType.charAt(0).toUpperCase() + finalAppointmentType.slice(1)} Meeting\n`;

			if (extractedDescription && !extractedDescription.includes('Client Information:')) {
				responseText += `📝 **Description:** ${extractedDescription}\n`;
			}

			if (originalAttendees.length > 0) {
				responseText += `👥 **Additional Attendees:** ${originalAttendees.join(', ')}\n`;
			}

			if (result.htmlLink) {
				responseText += `\n🔗 [View in Google Calendar](${result.htmlLink})`;
			}

			if (sendReminder) {
				responseText += `\n\n📨 **Reminders:** Email reminder will be sent 1 day before, popup reminder 30 minutes before`;
			}

			responseText += `\n\n🎉 Your appointment has been successfully rescheduled and all attendees have been notified of the change.`;

			return {
				content: [{
					type: "text",
					text: responseText,
				}]
			};

		} catch (error) {
			let errorMessage = 'An unexpected error occurred while rescheduling the appointment.';
			
			if (error instanceof Error) {
				if (error.message.includes('404')) {
					errorMessage = 'The original appointment no longer exists or has already been cancelled.';
				} else if (error.message.includes('403')) {
					errorMessage = 'Permission denied. Please check your Google Calendar access permissions.';
				} else if (error.message.includes('401')) {
					errorMessage = 'Authentication failed. Please re-authenticate with Google Calendar.';
				} else if (error.message.includes('400')) {
					errorMessage = 'Invalid request. Please check the appointment details and try again.';
				} else {
					errorMessage = error.message;
				}
			}

			return {
				content: [{
					type: "text",
					text: `❌ **Failed to reschedule appointment**\n\n${errorMessage}\n\n💡 **Troubleshooting:**\n• Verify the original appointment exists\n• Check new date and time format\n• Ensure you have calendar permissions\n• Try with more specific search criteria`
				}]
			};
		}
	}
);
// Get User Appointments Tool
server.tool(
    "getUserAppointments",
    "Get upcoming appointments for a user by name, email, or phone",
    {
        userName: z.string().optional().describe("User's full name (optional)"),
        userEmail: z.string().email().optional().describe("User's email address (optional)"),
        userPhone: z.string().optional().describe("User's phone number (optional)"),
    },
    async ({ userName, userEmail, userPhone }) => {
        // Fetch all upcoming events (next 30 days)
        const now = new Date().toISOString();
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(future)}&singleEvents=true&orderBy=startTime`;
        const result = await makeCalendarApiRequest(url);
        const events = (result.items || []).filter((event: any) => eventMatchesUser(event, { userName, userEmail, userPhone }));
        if (events.length === 0) {
            return { content: [{ type: "text", text: "No upcoming appointments found for the provided information." }] };
        }
        const list = events.map((event: any) => {
            const date = event.start?.dateTime
                ? new Date(event.start.dateTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                : event.start?.date;
            return `- ${event.summary || "No Title"} on ${date}`;
        }).join('\n');
        return { content: [{ type: "text", text: `Your upcoming appointments:\n${list}` }] };
    }
);
	
}
