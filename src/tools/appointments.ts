import { z } from "zod";

const HARDCODED_GOOGLE_ACCESS_TOKEN =
  "ya29.a0AW4XtxgOsqTJjRvvd2rQ70StbfBeU5FZrKxv6abxCDZQWA2BFfmIK1svX0ssiTKwPO6o4ZBRz-BXxTxVxN6Q7EhQ0UR55eCXlAt56uYt3a5HtnBjmry3bOTo4L4pW458vDzGsgWhpd9uKLFja41oWhLjcZNOsfOk32mcIzEzaCgYKATMSARQSFQHGX2Mii1wxP6NcJHAKbvOkTaDwvg0175";

// Helper: Format date to YYYY-MM-DD
function formatDateToString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}`
  );
}

export const appointmentTool = {
  name: "appointment",
  description: "Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone, and includes today's date in the description)",
  inputSchema: {
    summary: z.string(),
    description: z.string().optional(),
    startDateTime: z.string(),
    endDateTime: z.string(),
    attendees: z.array(z.object({ email: z.string() })).optional(),
  },
  handler: async ({
    summary,
    description,
    startDateTime,
    endDateTime,
    attendees = [],
  }: {
    summary: string;
    description?: string;
    startDateTime: string;
    endDateTime: string;
    attendees?: { email: string }[];
  }) => {
    const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
    const today = formatDateToString(new Date());

    if (!token) throw new Error("Google OAuth access token is required.");

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
          text: `Appointment created: ${result.htmlLink}`,
        },
      ],
    };
  },
};

export const appointmentInputSchema = appointmentTool.inputSchema;
