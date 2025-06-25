import { google } from 'googleapis';

// QUICK TESTING: Hardcoded OAuth2 credentials (NOT FOR PRODUCTION)
const oAuth2Client = new google.auth.OAuth2(
  'calander@brw-emaad-test-apis.iam.gserviceaccount.com',    // client_id
  '696145831054-rr1rgaq6gbe5fs3t0e431uqvcc3hj601.apps.googleusercontent.com',                            // client_secret
  'https://remote-mcp-authkit.emaad-brainwonders.workers.dev/sse'                              // redirect_uri (can be unused for refresh_token)
);

// Hardcode refresh token for the Google account (for quick testing)
oAuth2Client.setCredentials({
  refresh_token: 'Y1//04dgfTTR74D6JCgYIARAAGAQSNwF-L9Ir8n5WqFfoOhxqrCLWewAsUI6pPaL75dYS1DLQuA6_3xCwDvA1aOgPWxUBJKr5LenrvPA',
});

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
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

  const event = {
    summary,
    description,
    start: { dateTime: startDateTime },
    end: { dateTime: endDateTime },
    attendees,
  };

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });
    return response.data;
  } catch (error) {
    console.error('Error scheduling appointment:', error);
    throw error;
  }
}

// Register with your server/tool mechanism
this.server.tool('scheduleAppointment', async (args: any) => {
  return await scheduleAppointment(args);
});
