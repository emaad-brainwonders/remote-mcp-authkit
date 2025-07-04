import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {getAccessToken, formatDateToString, getCurrentDate, formatDateForDisplay, parseRelativeDate, validateTimeFormat, isTimeSlotAvailable, parseAttendeesInput, shiftTimeBackwards530, makeCalendarApiRequest, eventMatchesUser} from "./appointment";


export function registerRecommendAppointmentTimesTool(server: McpServer, env: any) {
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
}
