import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseRelativeDate, formatDateForDisplay, makeCalendarApiRequest, getCurrentDate, validateTimeFormat, parseAttendeesInput, getAccessToken } from "./appointment";
import { sendAppointmentEmail } from "./mail";

export function registerScheduleAppointmentTool(server: McpServer, env: any) {
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
        if (!validateTimeFormat(startTime)) {
          throw new Error("Invalid time format. Use HH:MM format (e.g., '10:00', '14:30')");
        }
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        if (!phoneRegex.test(userPhone.replace(/[\s\-\(\)]/g, ''))) {
          throw new Error("Invalid phone number format. Please include country code for international numbers");
        }
        const parsedAttendees = parseAttendeesInput(attendees);
        const allAttendees = [userEmail, ...parsedAttendees].filter((email, index, arr) =>
          arr.indexOf(email) === index
        );
        const appointmentMinutes = 45;
        const bufferMinutes = 15;
        // 5:30 forward shift ONLY here
        const startDateObj = new Date(`${parsedDate}T${startTime}:00+05:30`);
        const endDateObj = new Date(startDateObj.getTime() + appointmentMinutes * 60 * 1000);
        // Add 5:30 forward shift (in ms)
        const shiftedStart = new Date(startDateObj.getTime() + 19800000);
        const shiftedEnd = new Date(endDateObj.getTime() + 19800000);
        const startDateTime = shiftedStart.toISOString().slice(0, 19);
        const endDateTime = shiftedEnd.toISOString().slice(0, 19);
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
        if (checkAvailability) {
          const dayStartTime = `${parsedDate}T00:00:00+05:30`;
          const dayEndTime = `${parsedDate}T23:59:59+05:30`;
          const checkUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
            `timeMin=${encodeURIComponent(dayStartTime)}&` +
            `timeMax=${encodeURIComponent(dayEndTime)}&` +
            `singleEvents=true&` +
            `orderBy=startTime`;
          const checkResult = await makeCalendarApiRequest(checkUrl, env);
          const existingEvents = checkResult.items || [];
          if (!isTimeSlotAvailable(existingEvents, `${parsedDate}T${startTime}:00+05:30`, endDateObj.toISOString(), bufferMinutes)) {
            return {
              content: [
                {
                  type: "text",
                  text: `⚠️ **Time slot unavailable**\n\nThe time slot ${displayStartTime} - ${displayEndTime} on ${displayDate} conflicts with an existing appointment or doesn't allow for a 15-minute buffer after the meeting.\n\n💡 Use the 'recommendAppointmentTimes' tool to find available slots.`,
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
          env,
          {
            method: "POST",
            body: JSON.stringify(event),
          }
        );
        // Send appointment confirmation email
        try {
          const accessToken = getAccessToken(env);
          const emailAppointmentDetails = {
            summary: `${summary} - ${userName}`,
            date: displayDate,
            time: `${displayStartTime} - ${displayEndTime}`,
            userName: userName
          };
          await sendAppointmentEmail(
            { 
              to: userEmail, 
              appointmentDetails: emailAppointmentDetails 
            }, 
            accessToken
          );
        } catch (emailError) {
          console.error('Failed to send appointment email:', emailError);
        }
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
          responseText += `\n\n📨 **Reminders:** Email reminder 1 day before, popup 30 minutes before`;
        }
        responseText += `\n\n🎉 All set! Your appointment has been added to your calendar and all attendees have been invited.`;
        responseText += `\n📧 **Confirmation email sent to:** ${userEmail}`;
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
}
