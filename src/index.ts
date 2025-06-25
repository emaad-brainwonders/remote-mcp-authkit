// This is a Cloudflare Worker-compatible Google Calendar appointment creator

// Hardcoded access token (for demo/testing only; refresh with your backend if expired)
const GOOGLE_CALENDAR_ACCESS_TOKEN = "ya29.a0AS3H6NzNSiPe7tpYLv2nchRUENSvZOlp1x7Td1MwTfu9FXPVQ1UHyzEAHq1BEd4_8v_Sbxr6sbOVJJfiAgPvafHo5GRz8U5tbp-hIjXL_GkKIjdePWZX_swTRH6fh15i7IhnP7nZpk1lad-OD68RrsKSQzHkbRw6rZ7IiGfHaCgYKAd0SARQSFQHGX2Micdx1V7c7_XqqnQCMb4ve8Q0175"; // Get this from your backend using refresh token


export async function scheduleAppointment({
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

// Example Worker handler
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/schedule") {
      const data = await request.json();
      try {
        const event = await scheduleAppointment(data);
        return new Response(JSON.stringify(event), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (err: any) {
        return new Response(err.message, { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
