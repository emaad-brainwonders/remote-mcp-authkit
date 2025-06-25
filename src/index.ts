

// For demo/testing only: hard-code a valid access token here
const GOOGLE_CALENDAR_ACCESS_TOKEN = "ya29.a0AS3H6NzNSiPe7tpYLv2nchRUENSvZOlp1x7Td1MwTfu9FXPVQ1UHyzEAHq1BEd4_8v_Sbxr6sbOVJJfiAgPvafHo5GRz8U5tbp-hIjXL_GkKIjdePWZX_swTRH6fh15i7IhnP7nZpk1lad-OD68RrsKSQzHkbRw6rZ7IiGfHaCgYKAd0SARQSFQHGX2Micdx1V7c7_XqqnQCMb4ve8Q0175";

interface Appointment {
  summary: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  attendees?: { email: string }[];
}

function isAppointment(obj: any): obj is Appointment {
  return (
    obj &&
    typeof obj.summary === "string" &&
    typeof obj.startDateTime === "string" &&
    typeof obj.endDateTime === "string" &&
    (obj.attendees === undefined ||
      (Array.isArray(obj.attendees) &&
        obj.attendees.every((a: any) => a && typeof a.email === "string")))
  );
}

async function scheduleAppointment({
  summary,
  description,
  startDateTime,
  endDateTime,
  attendees = [],
}: Appointment) {
  const event = {
    summary,
    description,
    start: { dateTime: startDateTime, timeZone: "UTC" },
    end: { dateTime: endDateTime, timeZone: "UTC" },
    attendees,
  };

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_CALENDAR_ACCESS_TOKEN}`,
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

  return response.json();
}

// --- Durable Object Definition ---
export class MyMCP {
  state: DurableObjectState;
  env: any;
  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }
  async fetch(request: Request): Promise<Response> {
    return withCors(new Response("Hello from MyMCP Durable Object!"));
  }
}

// --- Helper for CORS ---
function withCors(resp: Response) {
  const headers = new Headers(resp.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

// --- Main Worker Handler ---
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    // SSE endpoint for "/sse"
    if (url.pathname === "/sse" && request.method === "GET") {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode("event: message\ndata: {\"hello\":\"world\"}\n\n"));
          controller.close();
        },
      });
      return withCors(
        new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        })
      );
    }

    // Google Calendar scheduling endpoint
    if (
      request.method === "POST" &&
      url.pathname === "/api/schedule"
    ) {
      let data: unknown;
      try {
        data = await request.json();
      } catch {
        return withCors(new Response("Invalid JSON", { status: 400 }));
      }

      if (!isAppointment(data)) {
        return withCors(new Response("Invalid appointment payload", { status: 400 }));
      }

      try {
        const event = await scheduleAppointment(data);
        return withCors(
          new Response(JSON.stringify(event), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      } catch (err: any) {
        return withCors(new Response(err.message, { status: 500 }));
      }
    }

    return withCors(new Response("Not found", { status: 404 }));
  },
};
