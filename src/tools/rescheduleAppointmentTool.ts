import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {getAccessToken, formatDateToString, getCurrentDate, formatDateForDisplay, parseRelativeDate, validateTimeFormat, isTimeSlotAvailable, parseAttendeesInput, shiftTimeBackwards530, makeCalendarApiRequest, eventMatchesUser} from "./appointment";


export function registerRescheduleAppointmentTool(server: McpServer, env: any) {
  server.tool(
    "rescheduleAppointment",
    "Reschedule an existing appointment to a new date and time by canceling the old one and creating a new one",
    {
      summary: z.string().min(1).nullish().describe("Title/summary of the appointment to reschedule (optional if user info is provided)"),
      currentDate: z.string().min(1).nullish().describe("Current date of the appointment in YYYY-MM-DD format or relative expression (optional if user info is provided)"),
      userName: z.string().nullish().describe("Full name of the person booking the appointment (optional)"),
      userEmail: z.string().email().nullish().describe("Email address of the person booking (optional)"),
      userPhone: z.string().nullish().describe("Phone number of the person booking (optional)"),
      newDate: z.string().min(1).describe("New date for the appointment in YYYY-MM-DD format or relative expression"),
      newStartTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("New start time in HH:MM format (24-hour)"),
      newSummary: z.string().nullish().describe("New title/summary for the appointment (optional - keeps original if not provided)"),
      newDescription: z.string().nullish().describe("New description for the appointment (optional - keeps original if not provided)"),
      newAppointmentType: z.enum(['online', 'offline']).nullish().describe("New appointment type (optional - keeps original if not provided)"),
      checkAvailability: z.coerce.boolean().default(true).describe("Check if the new time slot is available before rescheduling"),
      sendReminder: z.coerce.boolean().default(true).describe("Send email reminder for the new appointment"),
      forceProceed: z.coerce.boolean().default(true).describe("Continue with reschedule even if original appointment cancellation fails"),
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
		sendReminder = true,
		forceProceed = true 
	}) => {
		let newAppointmentId: string | null = null;
		let originalEvent: any = null;
		let cancelationFailed = false;
		let cancelationError = '';

		try {
			// Get current date for logging
			const today = new Date().toLocaleDateString('en-IN', {
				timeZone: 'Asia/Kolkata',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			});

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

			// Find the appointment to reschedule
			let events: any[] = [];
			let searchTimeWindow = "";

			if (currentDate) {
				// Search for appointments on the specific date
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
				const searchResult = await makeCalendarApiRequest(searchUrl, env);
				events = searchResult.items || [];
			} else {
				// Search upcoming appointments (next 30 days)
				const now = new Date();
				const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
				searchTimeWindow = "in the next 30 days";
				
				const timeMin = now.toISOString();
				const timeMax = future.toISOString();
				
				const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(timeMin)}&` +
					`timeMax=${encodeURIComponent(timeMax)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				const result = await makeCalendarApiRequest(url, env);
				events = result.items || [];
			}

			//Filter events based on search criteria
			const matchingEvents = events.filter((event: any) => {
				// Skip cancelled or deleted events
				if (event.status === 'cancelled') return false;
				
				let matches = false;
				
				// Match by summary/title
				if (summary) {
					const eventTitle = (event.summary || '').toLowerCase();
					const searchTitle = summary.toLowerCase();
					if (eventTitle.includes(searchTitle)) {
						matches = true;
					}
				}
				
				// Match by user information
				if (userName) {
					const eventTitle = (event.summary || '').toLowerCase();
					const eventDesc = (event.description || '').toLowerCase();
					const searchName = userName.toLowerCase();
					
					if (eventTitle.includes(searchName) || eventDesc.includes(searchName)) {
						matches = true;
					}
				}
				
				if (userEmail) {
					// Check attendees
					if (event.attendees && event.attendees.some((attendee: any) => 
						attendee.email && attendee.email.toLowerCase() === userEmail.toLowerCase()
					)) {
						matches = true;
					}
					
					// Check description
					const eventDesc = (event.description || '').toLowerCase();
					if (eventDesc.includes(userEmail.toLowerCase())) {
						matches = true;
					}
				}
				
				if (userPhone) {
					const eventDesc = (event.description || '');
					if (eventDesc.includes(userPhone)) {
						matches = true;
					}
				}
				
				// If no specific criteria provided, match all events
				if (!summary && !userName && !userEmail && !userPhone) {
					matches = true;
				}
				
				return matches;
			});

			if (matchingEvents.length === 0) {
				const searchCriteria = [];
				if (summary) searchCriteria.push(`Title: "${summary}"`);
				if (userName) searchCriteria.push(`Name: "${userName}"`);
				if (userEmail) searchCriteria.push(`Email: "${userEmail}"`);
				if (userPhone) searchCriteria.push(`Phone: "${userPhone}"`);
				
				return {
					content: [{
						type: "text",
						text: `🔍 **No matching appointments found**\n\nSearched ${searchTimeWindow} with criteria:\n${searchCriteria.map(c => `• ${c}`).join('\n')}\n\n💡 **Please verify:**\n• Appointment exists and is not cancelled\n• Search criteria are correct\n• Date is accurate`
					}]
				};
			}

			if (matchingEvents.length > 1) {
				const appointmentList = matchingEvents.slice(0, 5).map((event: any, index: number) => {
					const start = event.start?.dateTime || event.start?.date;
					const eventDate = start ? new Date(start).toLocaleDateString('en-IN', {
						timeZone: 'Asia/Kolkata',
						year: 'numeric',
						month: '2-digit',
						day: '2-digit'
					}) : 'Unknown date';
					
					let timeString = 'All day';
					if (start && start.includes('T')) {
						timeString = new Date(start).toLocaleTimeString('en-IN', {
							hour: '2-digit',
							minute: '2-digit',
							timeZone: 'Asia/Kolkata'
						});
					}
					
					return `${index + 1}. **${event.summary || 'Untitled Event'}**\n   📅 ${eventDate} at ${timeString}`;
				}).join('\n\n');

				return {
					content: [{
						type: "text",
						text: `⚠️ **Multiple appointments found (${matchingEvents.length})**\n\n${appointmentList}${matchingEvents.length > 5 ? '\n... and more' : ''}\n\n💡 **Please be more specific with:**\n• Exact appointment title\n• Specific date (YYYY-MM-DD)\n• Complete user details`
					}]
				};
			}

			//Get the appointment to reschedule
			originalEvent = matchingEvents[0];
			const originalStart = originalEvent.start?.dateTime || originalEvent.start?.date;
			let originalStartDate = null;
			let originalDate = '';
			let originalTime = 'All day';
			if (originalEvent.start?.dateTime) {
				const shifted = shiftTimeBackwards530(originalEvent.start.dateTime);
				originalStartDate = new Date(shifted);
				originalDate = originalStartDate.toLocaleDateString('en-IN', {
					timeZone: 'Asia/Kolkata',
					year: 'numeric',
					month: '2-digit',
					day: '2-digit'
				});
				originalTime = originalStartDate.toLocaleTimeString('en-IN', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Asia/Kolkata'
				});
			} else if (originalEvent.start?.date) {
				originalDate = originalEvent.start.date;
			}

			//Extract user information from original event
			let extractedUserName = userName;
			let extractedUserEmail = userEmail;
			let extractedUserPhone = userPhone;
			let extractedAppointmentType = newAppointmentType;

			// Parse description for user info
			if (originalEvent.description) {
				const desc = originalEvent.description;
				
				if (!extractedUserName) {
					const nameMatch = desc.match(/Name:\s*([^\n\r]+)/i);
					if (nameMatch) extractedUserName = nameMatch[1].trim();
				}
				
				if (!extractedUserEmail) {
					const emailMatch = desc.match(/Email:\s*([^\n\r]+)/i);
					if (emailMatch) extractedUserEmail = emailMatch[1].trim();
				}
				
				if (!extractedUserPhone) {
					const phoneMatch = desc.match(/Phone:\s*([^\n\r]+)/i);
					if (phoneMatch) extractedUserPhone = phoneMatch[1].trim();
				}
				
				if (!extractedAppointmentType) {
					const typeMatch = desc.match(/Type:\s*(\w+)/i);
					if (typeMatch) {
						const type = typeMatch[1].toLowerCase();
						extractedAppointmentType = type.includes('online') ? 'online' : 'offline';
					}
				}
			}

			// Get email from attendees if not found in description
			if (!extractedUserEmail && originalEvent.attendees && originalEvent.attendees.length > 0) {
				// Find the first attendee that's not the organizer
				const userAttendee = originalEvent.attendees.find((attendee: any) => 
					attendee.email && 
					attendee.email !== originalEvent.organizer?.email &&
					!attendee.email.includes('calendar.google.com')
				);
				if (userAttendee) {
					extractedUserEmail = userAttendee.email;
				}
			}

			// Extract name from event summary if not found
			if (!extractedUserName && originalEvent.summary) {
				const summaryParts = originalEvent.summary.split(' - ');
				if (summaryParts.length > 1) {
					extractedUserName = summaryParts[summaryParts.length - 1].trim();
				}
			}

			//  Check availability for new time slot
			if (checkAvailability) {
				const newStartDateObj = new Date(`${parsedNewDate}T${newStartTime}:00+05:30`);
				const newEndDateObj = new Date(newStartDateObj.getTime() + 45 * 60 * 1000);
				
				// Check for conflicts on the new date
				const dayStartTime = `${parsedNewDate}T00:00:00+05:30`;
				const dayEndTime = `${parsedNewDate}T23:59:59+05:30`;
				
				const checkUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
					`timeMin=${encodeURIComponent(dayStartTime)}&` +
					`timeMax=${encodeURIComponent(dayEndTime)}&` +
					`singleEvents=true&` +
					`orderBy=startTime`;
				
				const checkResult = await makeCalendarApiRequest(checkUrl, env);
				const existingEvents = (checkResult.items || []).filter((event: any) => 
					event.id !== originalEvent.id && event.status !== 'cancelled'
				);
				
				// Check for time conflicts
				const newStart = newStartDateObj.getTime();
				const newEnd = newEndDateObj.getTime();
				
				const hasConflict = existingEvents.some((event: any) => {
					const eventStart = event.start?.dateTime || event.start?.date;
					if (!eventStart) return false;
					
					const existingStart = new Date(eventStart).getTime();
					let existingEnd = existingStart;
					
					if (event.end?.dateTime || event.end?.date) {
						existingEnd = new Date(event.end.dateTime || event.end.date).getTime();
					} else {
						existingEnd = existingStart + 45 * 60 * 1000; // Default 45 minutes
					}
					
					// Check for overlap
					return (newStart < existingEnd && newEnd > existingStart);
				});
				
				if (hasConflict) {
					const displayNewDate = formatDateForDisplay(parsedNewDate);
					const conflictStartTime = newStartDateObj.toLocaleTimeString('en-IN', {
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'Asia/Kolkata'
					});
					const conflictEndTime = newEndDateObj.toLocaleTimeString('en-IN', {
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'Asia/Kolkata'
					});
					
					return {
						content: [{
							type: "text",
							text: `⚠️ **Time slot conflict detected**\n\nThe requested time ${conflictStartTime} - ${conflictEndTime} on ${displayNewDate} conflicts with an existing appointment.\n\n💡 **Options:**\n• Choose a different time\n• Use 'recommendAppointmentTimes' tool to find available slots\n• Set checkAvailability to false to override (not recommended)`
						}]
					};
				}
			}

			// Prepare new appointment data
			const finalUserName = extractedUserName || 'Unknown User';
			const finalUserEmail = extractedUserEmail;
			const finalUserPhone = extractedUserPhone || 'Not provided';
			const finalAppointmentType = extractedAppointmentType || 'online';
			const finalSummary = newSummary || originalEvent.summary || 'Appointment';
			
			if (!finalUserEmail) {
				return {
					content: [{
						type: "text",
						text: `❌ **Missing user email**\n\nCould not extract user email from the original appointment. Please provide the user's email address to complete the reschedule.\n\n⚠️ **Note:** The original appointment has NOT been cancelled yet.`
					}]
				};
			}

			//Create new appointment first (safer approach)
			const newStartDateObj = new Date(`${parsedNewDate}T${newStartTime}:00+05:30`);
			const newEndDateObj = new Date(newStartDateObj.getTime() + 45 * 60 * 1000);

			// Apply 5:30 forward shift (as in scheduleAppointment)
			const shiftedStart = new Date(newStartDateObj.getTime() + 19800000);
			const shiftedEnd = new Date(newEndDateObj.getTime() + 19800000);

			const startDateTime = shiftedStart.toISOString().slice(0, 19);
			const endDateTime = shiftedEnd.toISOString().slice(0, 19);

			// Build description
			const appointmentDetails = [
				`👤 **Client Information:**`,
				`Name: ${finalUserName}`,
				`Email: ${finalUserEmail}`,
				`Phone: ${finalUserPhone}`,
				``,
				`📋 **Appointment Details:**`,
				`Type: ${finalAppointmentType.charAt(0).toUpperCase() + finalAppointmentType.slice(1)} Meeting`,
				`Duration: 45 minutes`,
			];

			// Add custom description if provided
			if (newDescription) {
				appointmentDetails.push(``, `📝 **Notes:**`, newDescription);
			} else if (originalEvent.description && !originalEvent.description.includes('Client Information:')) {
				appointmentDetails.push(``, `📝 **Notes:**`, originalEvent.description);
			}

			appointmentDetails.push(``, `🔄 **Rescheduled on:** ${today}`);
			appointmentDetails.push(`📅 **Originally:** ${originalDate} at ${originalTime}`);

			const fullDescription = appointmentDetails.join('\n');

			// Get original attendees (excluding the user email to avoid duplicates)
			const originalAttendees = (originalEvent.attendees || [])
				.map((attendee: any) => attendee.email)
				.filter((email: string) => email && email.toLowerCase() !== finalUserEmail.toLowerCase());

			const newEvent = {
				summary: `${finalSummary} - ${finalUserName}`,
				description: fullDescription,
				start: { dateTime: startDateTime, timeZone: "Asia/Kolkata" },
				end: { dateTime: endDateTime, timeZone: "Asia/Kolkata" },
				attendees: [finalUserEmail, ...originalAttendees].map((email: string) => ({ email })),
				reminders: sendReminder ? {
					useDefault: false,
					overrides: [
						{ method: 'email', minutes: 24 * 60 },
						{ method: 'popup', minutes: 30 },
					],
				} : { useDefault: false },
			};

			// Create new appointment
			const createResult = await makeCalendarApiRequest(
				"https://www.googleapis.com/calendar/v3/calendars/primary/events",
				env,
				{
					method: "POST",
					body: JSON.stringify(newEvent),
				}
			);

			newAppointmentId = createResult.id;

			// Try to cancel original appointment 
			try {
				const cancelUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${originalEvent.id}`;
				await makeCalendarApiRequest(cancelUrl, env, { method: "DELETE" });
			} catch (cancelError) {
				cancelationFailed = true;
				cancelationError = cancelError instanceof Error ? cancelError.message : 'Unknown cancellation error';
				
				// If forceProceed is false, delete the new appointment and throw error
				if (!forceProceed) {
					try {
						const deleteNewUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${newAppointmentId}`;
						await makeCalendarApiRequest(deleteNewUrl, env, { method: "DELETE" });
					} catch (deleteError) {
						// Ignore deletion error - we'll mention both appointments exist
					}
					throw new Error(`Failed to cancel original appointment: ${cancelationError}`);
				}
			}

			//Build response
			const displayNewDate = formatDateForDisplay(parsedNewDate);
			const responseStartTime = newStartDateObj.toLocaleTimeString('en-IN', {
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Asia/Kolkata'
			});
			const responseEndTime = newEndDateObj.toLocaleTimeString('en-IN', {
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Asia/Kolkata'
			});

			let responseText = '';
			
			if (cancelationFailed) {
				responseText += `⚠️ **Partial reschedule completed**\n\n`;
				responseText += `✅ **New appointment created successfully**\n`;
				responseText += `❌ **Original appointment cancellation failed**\n\n`;
				responseText += `⚠️ **IMPORTANT:** You now have TWO appointments:\n`;
				responseText += `1. **Original:** ${originalDate} at ${originalTime}\n`;
				responseText += `2. **New:** ${displayNewDate} at ${responseStartTime} - ${responseEndTime}\n\n`;
				responseText += `❗ **Action Required:** Please manually cancel the original appointment in Google Calendar\n\n`;
				responseText += `🔗 **Error Details:** ${cancelationError}\n\n`;
			} else {
				responseText += `✅ **Appointment successfully rescheduled!**\n\n`;
				responseText += `🔄 **Schedule Change:**\n`;
				responseText += `**From:** ${originalDate} at ${originalTime}\n`;
				responseText += `**To:** ${displayNewDate} at ${responseStartTime} - ${responseEndTime}\n\n`;
			}
			
			responseText += `👤 **Client Details:**\n`;
			responseText += `**Name:** ${finalUserName}\n`;
			responseText += `**Email:** ${finalUserEmail}\n`;
			responseText += `**Phone:** ${finalUserPhone}\n\n`;
			responseText += `📋 **Event:** ${finalSummary}\n`;
			responseText += `**Type:** ${finalAppointmentType.charAt(0).toUpperCase() + finalAppointmentType.slice(1)} Meeting\n`;
			responseText += `**Duration:** 45 minutes\n`;

			if (newDescription) {
				responseText += `**Notes:** ${newDescription}\n`;
			}

			if (originalAttendees.length > 0) {
				responseText += `**Additional Attendees:** ${originalAttendees.join(', ')}\n`;
			}

			if (createResult.htmlLink) {
				responseText += `\n🔗 [View New Appointment in Google Calendar](${createResult.htmlLink})`;
			}

			if (sendReminder) {
				responseText += `\n\n📨 **Reminders set:** Email (1 day before) • Popup (30 minutes before)`;
			}

			if (!cancelationFailed) {
				responseText += `\n\n🎉 **All done!** The appointment has been rescheduled and all attendees have been notified.`;
			} else {
				responseText += `\n\n⚠️ **Next Steps:**\n1. Check your Google Calendar\n2. Manually delete the original appointment\n3. The new appointment is ready to use`;
			}

			return {
				content: [{
					type: "text",
					text: responseText,
				}]
			};

		} catch (error) {
			// If we created a new appointment but the overall process failed, try to clean up
			if (newAppointmentId && !cancelationFailed) {
				try {
					const deleteNewUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${newAppointmentId}`;
					await makeCalendarApiRequest(deleteNewUrl, env, { method: "DELETE" });
				} catch (deleteError) {
					// Ignore deletion error - we'll mention both appointments exist
				}
			}

			let errorMessage = 'An unexpected error occurred while rescheduling the appointment.';
			
			if (error instanceof Error) {
				if (error.message.includes('404')) {
					errorMessage = 'The original appointment could not be found. It may have been deleted or cancelled.';
				} else if (error.message.includes('403')) {
					errorMessage = 'Permission denied. Please check your Google Calendar access permissions.';
				} else if (error.message.includes('401')) {
					errorMessage = 'Authentication failed. Please re-authenticate with Google Calendar.';
				} else if (error.message.includes('400')) {
					errorMessage = 'Invalid request data. Please check the appointment details.';
				} else if (error.message.includes('409')) {
					errorMessage = 'Conflict detected. The appointment may have been modified by another process.';
				} else {
					errorMessage = error.message;
				}
			}

			let responseText = `❌ **Reschedule failed**\n\n**Error:** ${errorMessage}`;
			
			if (newAppointmentId) {
				responseText += `\n\n⚠️ **Important:** A new appointment may have been created (ID: ${newAppointmentId}). Please check your calendar and clean up if necessary.`;
			}
			
			responseText += `\n\n💡 **Troubleshooting:**\n• Verify the original appointment exists\n• Ensure all required fields are provided\n• Check date and time formats\n• Confirm calendar permissions\n• Try with more specific search criteria\n• Set forceProceed to true to continue even if cancellation fails`;

			return {
				content: [{
					type: "text",
					text: responseText
				}]
			};
		}
	}
);
}
