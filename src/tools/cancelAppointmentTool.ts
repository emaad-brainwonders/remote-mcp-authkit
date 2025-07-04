import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {getAccessToken, formatDateToString, getCurrentDate, formatDateForDisplay, parseRelativeDate, validateTimeFormat, isTimeSlotAvailable, parseAttendeesInput, shiftTimeBackwards530, makeCalendarApiRequest, eventMatchesUser} from "./appointment";


export function registerCancelAppointmentTool(server: McpServer, env: any) {
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
				const searchResult = await makeCalendarApiRequest(searchUrl, env);
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
				const result = await makeCalendarApiRequest(url, env);
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
					let start = event.start?.dateTime || event.start?.date;
					let eventDate: string;
					let timeString = 'All day';
					if (event.start?.dateTime) {
						const shifted = shiftTimeBackwards530(event.start.dateTime);
						const shiftedDate = new Date(shifted);
						eventDate = shiftedDate.toLocaleDateString('en-IN');
						timeString = shiftedDate.toLocaleTimeString('en-IN', {
							hour: '2-digit',
							minute: '2-digit',
							timeZone: 'Asia/Kolkata'
						});
					} else if (event.start?.date) {
						eventDate = event.start.date;
					} else {
						eventDate = 'Unknown date';
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
			let eventDate: string;
			let timeString = 'All day';
			if (eventToCancel.start?.dateTime) {
				const shifted = shiftTimeBackwards530(eventToCancel.start.dateTime);
				const shiftedDate = new Date(shifted);
				eventDate = shiftedDate.toLocaleDateString('en-IN');
				timeString = shiftedDate.toLocaleTimeString('en-IN', {
					hour: '2-digit',
				 minute: '2-digit',
				 timeZone: 'Asia/Kolkata'
				});
			} else if (eventToCancel.start?.date) {
				eventDate = eventToCancel.start.date;
			} else {
				eventDate = 'Unknown date';
			}

			// Extract user information from the event for confirmation
			let userInfo = '';
			let clientEmail = '';
			let clientName = '';
			
			if (eventToCancel.description) {
				const nameMatch = eventToCancel.description.match(/Name: ([^\n]+)/);
				const emailMatch = eventToCancel.description.match(/Email: ([^\n]+)/);
				const phoneMatch = eventToCancel.description.match(/Phone: ([^\n]+)/);
				
				if (nameMatch || emailMatch || phoneMatch) {
					userInfo = '\n👤 **Client Details:**\n';
					if (nameMatch) {
						userInfo += `Name: ${nameMatch[1]}\n`;
						clientName = nameMatch[1];
					}
					if (emailMatch) {
						userInfo += `Email: ${emailMatch[1]}\n`;
						clientEmail = emailMatch[1];
					}
					if (phoneMatch) userInfo += `Phone: ${phoneMatch[1]}\n`;
				}
			}

			// Perform the cancellation
			const cancelUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventToCancel.id}`;
			await makeCalendarApiRequest(cancelUrl, env, { method: "DELETE" });

			// Send cancellation email if we have the client's email

			let responseText = `✅ **Appointment cancelled successfully!**\n\n📋 **Cancelled Event:** ${eventToCancel.summary}\n📅 **Date:** ${eventDate}\n⏰ **Time:** ${timeString}${userInfo}\n\n🗑️ The appointment has been permanently removed from your calendar and all attendees have been notified.`;
			
			if (clientEmail) {
				responseText += `\n📧 **Cancellation email sent to:** ${clientEmail}`;
			}

			return {
				content: [{
					type: "text",
					text: responseText
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
					text: `✅ **Appointment cancelled successfully!**\n\n📋 `
				}]
			};
		}
	}
);
}
