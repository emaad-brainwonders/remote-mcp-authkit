interface CalendarEvent {
  id: string;
  summary: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  organizer?: {
    email: string;
    displayName?: string;
  };
}

interface ReminderStatus {
  eventId: string;
  reminderSent: boolean;
  scheduledTime: number;
}

type Env = {
  AI: any;
  GOOGLE_ACCESS_TOKEN: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_CLIENT_SECRET: string;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
};

export class CalendarReminderService {
  private reminderInterval: NodeJS.Timeout | null = null;
  private readonly REMINDER_MINUTES = 30;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

  constructor(private env: Env) {}

  async startReminderAutomation() {
    console.log("Starting calendar reminder automation...");
    
    // Run immediately on startup
    await this.checkForUpcomingMeetings();
    
    // Set up recurring check
    this.reminderInterval = setInterval(async () => {
      try {
        await this.checkForUpcomingMeetings();
      } catch (error) {
        console.error("Error in reminder automation:", error);
      }
    }, this.CHECK_INTERVAL_MS);
  }

  private async checkForUpcomingMeetings() {
    try {
      const events = await this.getUpcomingCalendarEvents();
      const now = new Date();
      const reminderWindowStart = new Date(now.getTime() + (this.REMINDER_MINUTES - 5) * 60 * 1000);
      const reminderWindowEnd = new Date(now.getTime() + (this.REMINDER_MINUTES + 5) * 60 * 1000);

      for (const event of events) {
        const eventStart = new Date(event.start.dateTime);
        
        // Check if event is within the reminder window (25-35 minutes from now)
        if (eventStart >= reminderWindowStart && eventStart <= reminderWindowEnd) {
          await this.processEventReminder(event);
        }
      }
    } catch (error) {
      console.error("Error checking for upcoming meetings:", error);
    }
  }

  private async getUpcomingCalendarEvents(): Promise<CalendarEvent[]> {
    const now = new Date();
    const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next 24 hours

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.append("timeMin", now.toISOString());
    url.searchParams.append("timeMax", timeMax.toISOString());
    url.searchParams.append("singleEvents", "true");
    url.searchParams.append("orderBy", "startTime");
    url.searchParams.append("maxResults", "50");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.env.GOOGLE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.items || [];
  }

  private async processEventReminder(event: CalendarEvent) {
    const reminderKey = `reminder_${event.id}`;
    
    try {
      // Check if reminder already sent for this event
      const existingReminder = await this.env.OAUTH_KV.get(reminderKey);
      if (existingReminder) {
        const reminderStatus: ReminderStatus = JSON.parse(existingReminder);
        if (reminderStatus.reminderSent) {
          return; // Already sent reminder for this event
        }
      }

      // Send reminders to attendees
      if (event.attendees && event.attendees.length > 0) {
        const eventStart = new Date(event.start.dateTime);
        const emailsSent = await this.sendMeetingReminders(event, eventStart);
        
        if (emailsSent > 0) {
          // Mark reminder as sent
          const reminderStatus: ReminderStatus = {
            eventId: event.id,
            reminderSent: true,
            scheduledTime: Date.now(),
          };
          
          await this.env.OAUTH_KV.put(
            reminderKey, 
            JSON.stringify(reminderStatus),
            { expirationTtl: 7 * 24 * 60 * 60 } // Expire after 7 days
          );
          
          console.log(`Reminder sent for event: ${event.summary} to ${emailsSent} attendees`);
        }
      }
    } catch (error) {
      console.error(`Error processing reminder for event ${event.id}:`, error);
    }
  }

  private async sendMeetingReminders(event: CalendarEvent, eventStart: Date): Promise<number> {
    let emailsSent = 0;
    
    for (const attendee of event.attendees || []) {
      // Skip if attendee declined
      if (attendee.responseStatus === "declined") {
        continue;
      }

      try {
        await this.sendReminderEmail(attendee, event, eventStart);
        emailsSent++;
      } catch (error) {
        console.error(`Failed to send reminder to ${attendee.email}:`, error);
      }
    }

    return emailsSent;
  }

  private async sendReminderEmail(
    attendee: { email: string; displayName?: string }, 
    event: CalendarEvent, 
    eventStart: Date
  ) {
    const startTime = eventStart.toLocaleString();
    const timeUntilMeeting = Math.round((eventStart.getTime() - Date.now()) / (1000 * 60));
    
    const subject = `Reminder: ${event.summary} starting in ${timeUntilMeeting} minutes`;
    
    const body = `
Dear ${attendee.displayName || attendee.email},

This is a friendly reminder that you have an upcoming meeting:

📅 Meeting: ${event.summary}
🕐 Time: ${startTime}
⏰ Starting in: ${timeUntilMeeting} minutes

${event.organizer ? `Organizer: ${event.organizer.displayName || event.organizer.email}` : ''}

Please make sure you're prepared and have any necessary materials ready.

Best regards,
Calendar Reminder System
    `.trim();

    // Use your existing email service
    const emailPayload = {
      to: attendee.email,
      subject: subject,
      text: body,
      from: event.organizer?.email || "noreply@yourdomain.com",
    };

    // This assumes you have an email sending function available
    await this.sendEmail(emailPayload);
  }

  private async sendEmail(emailPayload: {
    to: string;
    subject: string;
    text: string;
    from: string;
  }) {
    try {
      // Use Gmail API to send the email
      const email = [
        `To: ${emailPayload.to}`,
        `Subject: ${emailPayload.subject}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        ``,
        emailPayload.text
      ].join('\n');

      const encodedEmail = btoa(email).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.GOOGLE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: encodedEmail
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gmail API error: ${response.status} - ${error}`);
      }

      const result = await response.json();
      console.log(`Email reminder sent successfully to ${emailPayload.to}`, { messageId: result.id });
      return result;

    } catch (error) {
      console.error(`Failed to send email to ${emailPayload.to}:`, error);
      throw error;
    }
  }

  // Clean up when the server shuts down
  async cleanup() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
    console.log("Calendar reminder automation stopped");
  }
}
