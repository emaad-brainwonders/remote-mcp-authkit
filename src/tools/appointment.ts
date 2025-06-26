import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// WARNING: Never use real tokens in public/prod; this is for demo only.
const HARDCODED_GOOGLE_ACCESS_TOKEN = "ya29.a0AS3H6Nx9ruRV9gZA2qeBuHIEW5bHVEDJc7oBxd7e8qQCr-g1D4kOIw5SoDvk2z-_rMD8bm8N9DwAj7vu2KQQN6sW4ac763QiEuSRHYL5KAp4BmDTKLbnJpWF9jXVhrfU6HZ-FwhBiYsPnQy_73f6KOB2zf0lFwH76ZoDtxSEaCgYKARoSARQSFQHGX2MiOjKniMdCUFFTQ36a7GXkBw0175";

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
  "rescheduleAppointment",
  "Cancel an existing appointment for a given attendee email on a specific date and reschedule it with new details.",
  {
    email: z.any().describe("Email of the attendee (can be a string or object like { email: string })"),
    date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', etc."),
    newSummary: z.string().min(1).describe("New appointment title/summary"),
    newDescription: z.string().optional().describe("New appointment description (optional)"),
    newStartTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("New start time in HH:MM format (24-hour)"),
    newEndTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("New end time in HH:MM format (24-hour)")
  },
  async ({
    email,
    date,
    newSummary,
    newDescription,
    newStartTime,
    newEndTime
  }) => {
    try {
      // Normalize email input
      const normalizedEmail = typeof email === "string"
        ? email
        : (email && typeof email === "object" && typeof email.email === "string")
          ? email.email
          : null;

      if (!normalizedEmail || !normalizedEmail.includes("@")) {
        throw new Error("Invalid email format provided.");
      }

      const parsedDate = parseRelativeDate(date);
      const displayDate = formatDateForDisplay(parsedDate);

      const timeMin = `${parsedDate}T00:00:00+05:30`;
      const timeMax = `${parsedDate}T23:59:59+05:30`;

      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
        `timeMin=${encodeURIComponent(timeMin)}&` +
        `timeMax=${encodeURIComponent(timeMax)}&` +
        `singleEvents=true&` +
        `orderBy=startTime`;

      const result = await makeCalendarApiRequest(url);
      const events = result.items || [];

      // Find event with the matching attendee
      const targetEvent = events.find((event: any) =>
        event.attendees?.some((att: any) => att.email === normalizedEmail)
      );

      if (!targetEvent) {
        return {
          content: [
            {
              type: "text",
              text: `❌ No event found on ${displayDate} with attendee ${normalizedEmail}.`,
            },
          ],
        };
      }

      // Cancel the original event
      await makeCalendarApiRequest(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${targetEvent.id}`,
        { method: "DELETE" }
      );

      // Schedule the new event
      const newStartDateTime = `${parsedDate}T${newStartTime}:00`;
      const newEndDateTime = `${parsedDate}T${newEndTime}:00`;

      const newEvent = {
        summary: newSummary,
        description: newDescription || `Rescheduled from: ${targetEvent.summary}`,
        start: { dateTime: newStartDateTime, timeZone: "Asia/Kolkata" },
        end: { dateTime: newEndDateTime, timeZone: "Asia/Kolkata" },
        attendees: [{ email: normalizedEmail }],
      };

      const createResult = await makeCalendarApiRequest(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          body: JSON.stringify(newEvent),
        }
      );

      return {
        content: [
          {
            type: "text",
            text:
              `🔄 **Event Rescheduled!**\n\n` +
              `🗓️ **Date:** ${displayDate}\n` +
              `👤 **Attendee:** ${normalizedEmail}\n` +
              `📋 **New Event:** ${newSummary}\n` +
              `⏰ **Time:** ${newStartTime} - ${newEndTime}\n` +
              (createResult.htmlLink ? `🔗 [View in Calendar](${createResult.htmlLink})` : "")
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Unable to reschedule event. ${error instanceof Error ? error.message : 'Please try again.'}`,
          },
        ],
      };
    }
  }
);

}
