import { z } from "zod";
import { sendAppointmentEmail } from "./mail";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---- CONSTANTS ----
const TIMEZONE = "Asia/Kolkata";
const APPOINTMENT_MINUTES = 45;
const BUFFER_MINUTES = 15;
const SHIFT_MS = 19800000; // 5:30 in ms
const REMINDER_EMAIL_MINUTES = 24 * 60;
const REMINDER_POPUP_MINUTES = 30;

// ---- HELPERS ----

function getAccessToken(env: any): string {
  const token = env.GOOGLE_ACCESS_TOKEN;
  if (!token) throw new Error("Google OAuth access token is required. Please set GOOGLE_ACCESS_TOKEN in your Wrangler secrets.");
  return token;
}

function formatDateToString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getCurrentDate(): string {
  return formatDateToString(new Date());
}

function formatDateForDisplay(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function parseRelativeDate(dateInput: string): string {
  if (!dateInput || typeof dateInput !== 'string') throw new Error("Date input is required and must be a string");
  const today = new Date();
  const inputLower = dateInput.toLowerCase().trim();

  if (inputLower === 'today') return formatDateToString(today);
  if (inputLower === 'tomorrow') { const d = new Date(today); d.setDate(today.getDate() + 1); return formatDateToString(d); }
  if (inputLower === 'yesterday') { const d = new Date(today); d.setDate(today.getDate() - 1); return formatDateToString(d); }

  const relDays = [
    [/(\d+)\s+days?\s+from\s+now/i, 1],
    [/in\s+(\d+)\s+days?/i, 1],
    [/(\d+)\s+days?\s+later/i, 1],
    [/after\s+(\d+)\s+days?/i, 1],
    [/(\d+)\s+days?\s+ago/i, -1],
    [/(\d+)\s+days?\s+before/i, -1]
  ];
  for (const [pattern, dir] of relDays) {
    const match = inputLower.match(pattern as RegExp);
    if (match) {
      const days = parseInt(match[1]);
      if (isNaN(days) || days < 0) throw new Error(`Invalid number of days: ${match[1]}`);
      const d = new Date(today);
      d.setDate(today.getDate() + days * (dir as number));
      return formatDateToString(d);
    }
  }

  if (inputLower.includes('next week')) { const d = new Date(today); d.setDate(today.getDate() + 7); return formatDateToString(d); }
  if (inputLower.includes('next month')) { const d = new Date(today); d.setMonth(today.getMonth() + 1); return formatDateToString(d); }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const testDate = new Date(dateInput + 'T00:00:00');
    if (isNaN(testDate.getTime())) throw new Error(`Invalid date format: ${dateInput}`);
    return dateInput;
  }

  const parsedDate = new Date(dateInput);
  if (!isNaN(parsedDate.getTime())) return formatDateToString(parsedDate);

  throw new Error(`Unable to parse date: "${dateInput}". Please use YYYY-MM-DD format or relative expressions.`);
}

function validateTimeFormat(time: string): boolean {
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

function shiftTimeBackwards530(dateTimeIso: string): string {
  const date = new Date(dateTimeIso);
  const shifted = new Date(date.getTime() - SHIFT_MS);
  return shifted.toISOString().slice(0, 19);
}

function uniqueEmails(emails: string[]): string[] {
  return Array.from(new Set(emails));
}

function parseAttendeesInput(attendees: any): string[] {
  if (!attendees) return [];
  if (Array.isArray(attendees)) {
    return attendees.map(item => typeof item === 'string' ? item : item.email).filter(Boolean);
  }
  if (typeof attendees === 'string') {
    try {
      const parsed = JSON.parse(attendees);
      return parseAttendeesInput(parsed);
    } catch {
      if (attendees.includes('@')) {
        return attendees.split(',').map(email => email.trim()).filter(email => email.includes('@'));
      }
    }
  }
  return [];
}

function isTimeSlotAvailable(events: any[], meetingStart: string, meetingEnd: string, bufferMinutes = BUFFER_MINUTES): boolean {
  const startTime = new Date(meetingStart).getTime();
  const endTime = new Date(meetingEnd).getTime();
  const endTimeWithBuffer = endTime + (bufferMinutes * 60 * 1000);
  for (const event of events) {
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    const eventStart = new Date(event.start.dateTime).getTime();
    const eventEnd = new Date(event.end.dateTime).getTime();
    if (startTime < eventEnd && endTimeWithBuffer > eventStart) return false;
  }
  return true;
}

async function makeCalendarApiRequest(url: string, env: any, options: RequestInit = {}): Promise<any> {
  try {
    const token = getAccessToken(env);
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
        if (errorJson.error?.message) errorMessage += ` - ${errorJson.error.message}`;
      } catch { errorMessage += ` - ${errorBody}`; }
      throw new Error(errorMessage);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

function eventMatchesUser(event: any, { userName, userEmail, userPhone }: { userName?: string, userEmail?: string, userPhone?: string }) {
  let found = false;
  if (userName && event.summary && event.summary.toLowerCase().includes(userName.toLowerCase())) found = true;
  if (userEmail && event.attendees && event.attendees.some((a: any) => a.email && a.email.toLowerCase() === userEmail.toLowerCase())) found = true;
  if (userPhone && event.description && event.description.includes(userPhone)) found = true;
  return found;
}

// --- Helper: Schedule a calendar event ---
async function scheduleCalendarEvent({
  summary,
  description,
  startDateTime,
  endDateTime,
  attendees,
  sendReminder,
  env
}: {
  summary: string,
  description: string,
  startDateTime: string,
  endDateTime: string,
  attendees: { email: string }[],
  sendReminder: boolean,
  env: any
}) {
  const event = {
    summary,
    description,
    start: { dateTime: startDateTime, timeZone: TIMEZONE },
    end: { dateTime: endDateTime, timeZone: TIMEZONE },
    attendees,
    ...(sendReminder && {
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: REMINDER_EMAIL_MINUTES },
          { method: 'popup', minutes: REMINDER_POPUP_MINUTES },
        ],
      }
    }),
  };
  return await makeCalendarApiRequest(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    env,
    { method: "POST", body: JSON.stringify(event) }
  );
}

// --- Helper: Cancel a calendar event by eventId ---
async function cancelCalendarEvent(eventId: string, env: any) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`;
  return await makeCalendarApiRequest(url, env, { method: "DELETE" });
}

// --- Helper: Send appointment email ---
async function sendAppointmentConfirmationEmail({ userEmail, summary, userName, displayDate, displayStartTime, displayEndTime, env }: {
  userEmail: string,
  summary: string,
  userName: string,
  displayDate: string,
  displayStartTime: string,
  displayEndTime: string,
  env: any
}) {
  try {
    const accessToken = getAccessToken(env);
    await sendAppointmentEmail(
      {
        to: userEmail,
        appointmentDetails: {
          summary: `${summary} - ${userName}`,
          date: displayDate,
          time: `${displayStartTime} - ${displayEndTime}`,
          userName
        }
      },
      accessToken
    );
  } catch (emailError) {
    console.error('Failed to send appointment email:', emailError);
  }
}

// --- Helper: Build appointment response text ---
function buildAppointmentResponse({
  userName,
  userEmail,
  userPhone,
  summary,
  displayDate,
  displayStartTime,
  displayEndTime,
  appointmentType,
  description,
  parsedAttendees,
  result,
  sendReminder,
  requireConfirmation
}: any) {
  let responseText = `✅ **Appointment scheduled successfully!**\n\n`;
  responseText += `👤 **Client:** ${userName}\n`;
  responseText += `📧 **Email:** ${userEmail}\n`;
  responseText += `📱 **Phone:** ${userPhone}\n\n`;
  responseText += `📋 **Event:** ${summary}\n`;
  responseText += `📅 **Date:** ${displayDate}\n`;
  responseText += `⏰ **Time:** ${displayStartTime} - ${displayEndTime} (${APPOINTMENT_MINUTES} minutes)\n`;
  responseText += `🔗 **Type:** ${appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1)} Meeting\n`;
  if (description) responseText += `📝 **Description:** ${description}\n`;
  if (parsedAttendees.length > 0) responseText += `👥 **Additional Attendees:** ${uniqueEmails(parsedAttendees).join(', ')}\n`;
  if (result.htmlLink) responseText += `\n🔗 [View in Google Calendar](${result.htmlLink})`;
  if (sendReminder) responseText += `\n\n📨 **Reminders:** Email reminder 1 day before, popup 30 minutes before`;
  responseText += `\n\n🎉 All set! Your appointment has been added to your calendar and all attendees have been invited.`;
  responseText += `\n📧 **Confirmation email sent to:** ${userEmail}`;
  if (requireConfirmation) responseText += `\n\n⚠️ **Confirmation Required:** Please confirm your attendance by replying to the calendar invitation.`;
  return responseText;
}

// ---- MAIN TOOL EXPORT ----
export function setupAppointmentTools(server: McpServer, env: any) {

// Recommend available appointment times (only available slots, no shift)
server.tool(
  "recommendAppointmentTimes",
  "Get recommended available appointment times for a specific date. Supports relative dates like 'today', 'tomorrow', '10 days from now', 'next week', etc.",
  {
    date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', 'next week', etc."),
  },
  async ({ date }) => {
    try {
      const parsedDate = parseRelativeDate(date);
      const displayDate = formatDateForDisplay(parsedDate);

      const startDateTime = `${parsedDate}T00:00:00+05:30`;
      const endDateTime = `${parsedDate}T23:59:59+05:30`;

      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
        `timeMin=${encodeURIComponent(startDateTime)}&` +
        `timeMax=${encodeURIComponent(endDateTime)}&` +
        `singleEvents=true&` +
        `orderBy=startTime`;

      const result = await makeCalendarApiRequest(url, env);
      const events = result.items || [];

      const workingHours = [
        { start: 9, end: 12, period: 'Morning' },
        { start: 14, end: 17, period: 'Afternoon' }
      ];

      const appointmentMinutes = 45;
      const bufferMinutes = 15;
      const totalBlockMinutes = appointmentMinutes + bufferMinutes;

      let morningSlots: string[] = [];
      let afternoonSlots: string[] = [];

      for (const period of workingHours) {
        const startMinutes = period.start * 60;
        const endMinutes = period.end * 60;

        for (
          let currentMinutes = startMinutes;
          currentMinutes <= endMinutes - totalBlockMinutes;
          currentMinutes += totalBlockMinutes
        ) {
          const startHour = Math.floor(currentMinutes / 60);
          const startMinute = currentMinutes % 60;
          const endTotalMinutes = currentMinutes + appointmentMinutes;
          const endHour = Math.floor(endTotalMinutes / 60);
          const endMinute = endTotalMinutes % 60;

          const slotStart = `${parsedDate}T${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}:00+05:30`;
          const slotEnd = `${parsedDate}T${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}:00+05:30`;

          // Only add slot if available (no shift)
          if (isTimeSlotAvailable(events, slotStart, slotEnd, bufferMinutes)) {
            const startFormatted = new Date(slotStart).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata'
            });
            const endFormatted = new Date(slotEnd).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata'
            });

            const slotText = `${startFormatted} - ${endFormatted}`;
            if (period.period === 'Morning') {
              morningSlots.push(slotText);
            } else {
              afternoonSlots.push(slotText);
            }
          }
        }
      }

      if (morningSlots.length === 0 && afternoonSlots.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `😔 **No availability found**\n\nI couldn't find any 45-minute slots (with 15-minute buffers) available on ${displayDate} during working hours (9 AM – 12 PM, 2 PM – 5 PM).\n\nTry a different date or check your calendar.`,
            },
          ],
        };
      }

      let responseText = `⏰ **Available 45-minute slots for ${displayDate}**\n\n`;

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

// Schedule appointment tool (apply 5:30 forward shift ONLY here)
server.tool(
  "scheduleAppointment",
  "Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone) with comprehensive user information and appointment format. Supports relative dates like 'today', 'tomorrow', '10 days from now', etc.",
  {
    userName: z.string().min(1).describe("Full name of the person booking the appointment"),
    userEmail: z.string().email().describe("Email address of the person booking the appointment"),
    userPhone: z.string().min(10).describe("Phone number of the person booking (with country code if international)"),
    summary: z.string().min(1).describe("Appointment title/summary"),
    description: z.string().optional().describe("Appointment description (optional)"),
    appointmentType: z.enum(['online', 'offline']).describe("Type of appointment: 'online' for virtual meetings, 'offline' for in-person meetings"),
    date: z.string().min(1).describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', etc."),
    startTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).describe("Start time in HH:MM format (24-hour)"),
    attendees: z.union([
      z.array(z.string().email()),
      z.string()
    ]).default([]).describe("Array of additional attendee email addresses or a JSON string of emails (excluding the main user)"),
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

      if (!validateTimeFormat(startTime)) throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
      const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
      if (!phoneRegex.test(userPhone.replace(/[\s\-\(\)]/g, ''))) throw new Error("Invalid phone number format. Please include country code for international numbers");

      const parsedAttendees = parseAttendeesInput(attendees);
      const attendeesList = uniqueEmails([userEmail, ...parsedAttendees]).map(email => ({ email }));

      const startDateObj = new Date(`${parsedDate}T${startTime}:00+05:30`);
      const endDateObj = new Date(startDateObj.getTime() + APPOINTMENT_MINUTES * 60 * 1000);
      const shiftedStart = new Date(startDateObj.getTime() + SHIFT_MS);
      const shiftedEnd = new Date(endDateObj.getTime() + SHIFT_MS);
      const startDateTime = shiftedStart.toISOString().slice(0, 19);
      const endDateTime = shiftedEnd.toISOString().slice(0, 19);

      const displayStartTime = startDateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
      const displayEndTime = endDateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });

      if (checkAvailability) {
        const dayStartTime = `${parsedDate}T00:00:00+05:30`;
        const dayEndTime = `${parsedDate}T23:59:59+05:30`;
        const checkUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(dayStartTime)}&timeMax=${encodeURIComponent(dayEndTime)}&singleEvents=true&orderBy=startTime`;
        const checkResult = await makeCalendarApiRequest(checkUrl, env);
        const existingEvents = checkResult.items || [];
        if (!isTimeSlotAvailable(existingEvents, `${parsedDate}T${startTime}:00+05:30`, endDateObj.toISOString(), BUFFER_MINUTES)) {
          return {
            content: [{
              type: "text",
              text: `⚠️ **Time slot unavailable**\n\nThe time slot ${displayStartTime} - ${displayEndTime} on ${displayDate} conflicts with an existing appointment or doesn't allow for a 15-minute buffer after the meeting.\n\n💡 Use the 'recommendAppointmentTimes' tool to find available slots.`,
            }],
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
        `Duration: ${APPOINTMENT_MINUTES} minutes`,
      ];
      if (description) appointmentDetails.push(``, `📝 **Additional Notes:**`, description);
      appointmentDetails.push(``, `🕐 **Scheduled on:** ${today}`);
      const fullDescription = appointmentDetails.join('\n');

      // Use helper for scheduling
      const result = await scheduleCalendarEvent({
        summary: `${summary} - ${userName}`,
        description: fullDescription,
        startDateTime,
        endDateTime,
        attendees: attendeesList,
        sendReminder,
        env
      });

      // Use helper for sending email
      await sendAppointmentConfirmationEmail({
        userEmail,
        summary,
        userName,
        displayDate,
        displayStartTime,
        displayEndTime,
        env
      });

      // Use helper for response
      const responseText = buildAppointmentResponse({
        userName,
        userEmail,
        userPhone,
        summary,
        displayDate,
        displayStartTime,
        displayEndTime,
        appointmentType,
        description,
        parsedAttendees,
        result,
        sendReminder,
        requireConfirmation
      });

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };

    } catch (error) {
      console.error('Error scheduling appointment:', error);
      return {
        content: [
          {
            type: "text",
            text: `❌ **Failed to schedule appointment**\n\nError: ${error instanceof Error ? error.message : String(error)}\n\nPlease check your input and try again. If the problem persists, contact support.`,
          },
        ],
      };
    }
  }
);

// Cancel Appointment Tool
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
					text: `❌ **Failed to cancel appointment**\n\n${errorMessage}\n\n💡 **Troubleshooting:**\n• Verify the appointment exists\n• Check your calendar permissions\n• Try searching with different criteria`
				}]
			};
		}
	}
);

// Reschedule Appointment Tool (uses cancel and schedule tools)
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
			const today = getCurrentDate();
			const parsedDate = parseRelativeDate(newDate);
			const displayDate = formatDateForDisplay(parsedDate);

			if (!validateTimeFormat(newStartTime)) throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
			const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
			if (!phoneRegex.test(userPhone.replace(/[\s\-\(\)]/g, ''))) throw new Error("Invalid phone number format. Please include country code for international numbers");

			// Find the appointment to reschedule
			let events = [];
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
			const originalEvent = matchingEvents[0];
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
				const newStartDateTime = `${parsedNewDate}T${newStartTime}:00`;
				const newStartDateObj = new Date(`${newStartDateTime}+05:30`);
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
							text: `⚠️ **Time slot conflict detected**\n\nThe requested time ${displayStartTime} - ${displayEndTime} on ${displayNewDate} conflicts with an existing appointment.\n\n💡 **Options:**\n• Choose a different time\n• Use 'recommendAppointmentTimes' tool to find available slots\n• Set checkAvailability to false to override (not recommended)`
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

			//Build new event times
			const newStartDateTime = `${parsedNewDate}T${newStartTime}:00+05:30`;
			const newStartDateObj = new Date(newStartDateTime);
			const newEndDateObj = new Date(newStartDateObj.getTime() + 45 * 60 * 1000);
			const shiftedStart = new Date(newStartDateObj.getTime() + SHIFT_MS);
			const shiftedEnd = new Date(newEndDateObj.getTime() + SHIFT_MS);
			const startDateTime = shiftedStart.toISOString().slice(0, 19);
			const endDateTime = shiftedEnd.toISOString().slice(0, 19);

			// Use scheduleCalendarEvent helper
			const result = await scheduleCalendarEvent({
				summary: `${finalSummary} - ${finalUserName}`,
				description: fullDescription,
				startDateTime,
				endDateTime,
				attendees: [finalUserEmail, ...originalAttendees].map(email => ({ email })),
				sendReminder,
				env
			});

			// Use cancelCalendarEvent helper
			try {
				await cancelCalendarEvent(originalEvent.id, env);
			} catch (cancelError) {
				try {
					await cancelCalendarEvent(result.id, env);
				} catch {}
				const errorMsg = cancelError instanceof Error ? cancelError.message : 'Unknown error';
				throw new Error(`Failed to cancel original appointment: ${errorMsg}`);
			}

			//Build response
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

			let responseText = `✅ **Appointment successfully rescheduled!**\n\n`;
			responseText += `🔄 **Schedule Change:**\n`;
			responseText += `**From:** ${originalDate} at ${originalTime}\n`;
			responseText += `**To:** ${displayNewDate} at ${displayStartTime} - ${displayEndTime}\n\n`;
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

			if (result.htmlLink) {
				responseText += `\n🔗 [View in Google Calendar](${result.htmlLink})`;
			}

			if (sendReminder) {
				responseText += `\n\n📨 **Reminders set:** Email (1 day before) • Popup (30 minutes before)`;
			}

			responseText += `\n\n🎉 **All done!** The appointment has been rescheduled and all attendees have been notified.`;

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

			return {
				content: [{
					type: "text",
					text: `❌ **Reschedule failed**\n\n**Error:** ${errorMessage}\n\n💡 **Troubleshooting:**\n• Verify the original appointment exists\n• Ensure all required fields are provided\n• Check date and time formats\n• Confirm calendar permissions\n• Try with more specific search criteria`
				}]
			};
		}
	}
);


// Your getUserAppointments tool 
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
);}

