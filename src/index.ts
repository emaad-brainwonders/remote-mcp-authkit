// Cloudflare Worker-compatible Google Calendar appointment scheduling

// For demo/testing only: hard-code a valid access token here
const GOOGLE_CALENDAR_ACCESS_TOKEN = "YOUR_ACCESS_TOKEN";

async function scheduleAppointment({
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
}) {
  const event = {
    summary,
    description,
    start: { dateTime: startDateTime, timeZone: "UTC" },
    end: { dateTime: endDateTime, timeZone: "UTC" },
    attendees,
  };

  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GOOGLE_CALENDAR_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(event)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Calendar API error: ${response.status} ${errorBody}`);
  }

  return response.json();
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/api/schedule"
    ) {
      const data = await request.json();

      // Type assertion for TypeScript compatibility
      const appointment = data as {
        summary: string;
        description?: string;
        startDateTime: string;
        endDateTime: string;
        attendees?: { email: string }[];
      };

      try {
        const event = await scheduleAppointment(appointment);
        return new Response(JSON.stringify(event), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return new Response(err.message, { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
