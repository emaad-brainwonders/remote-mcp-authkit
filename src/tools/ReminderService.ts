import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Updated mail.ts content
import { z } from "zod";

// Email configuration
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

// Email templates
const EMAIL_TEMPLATES = {
  appointment: {
    subject: "Appointment Scheduled",
    body: (userName: string, summary: string, date: string, time: string) => 
      `Hello ${userName},
Your appointment has been scheduled.
Appointment: ${summary}
Date: ${date}
Time: ${time}
Payment Status: Not Paid
Please contact the sales team to complete payment.
Email: sales@company.com
Thank you.`
  },
  
  // Reminder for 1 day and 1 hour before
  reminderAdvance: {
    subject: (summary: string, timeText: string) => `Upcoming Appointment Reminder - ${summary} (${timeText})`,
    body: (userName: string, summary: string, date: string, time: string, timeText: string) =>
      `Dear ${userName},

This is a friendly reminder about your upcoming appointment scheduled ${timeText}.

📅 APPOINTMENT DETAILS:
• Title: ${summary}
• Date: ${date}
• Time: ${time}

📋 PREPARATION REMINDERS:
• Please arrive 10 minutes early
• Bring any required documents or ID
• If you need to reschedule, please contact us at least 24 hours in advance
• Ensure you have completed any pre-appointment requirements

💰 PAYMENT REMINDER:
Your payment is still pending. Please contact our sales team to complete payment before your appointment:
📧 Email: sales@company.com

If you have any questions or need to make changes, please don't hesitate to reach out.

Best regards,
Appointment Management Team`
  },

  // Reminder for 30 minutes before  
  reminderUrgent: {
    subject: (summary: string) => `⏰ Your appointment starts in 30 minutes - ${summary}`,
    body: (userName: string, summary: string, date: string, time: string) =>
      `Hello ${userName},

🚨 IMMEDIATE REMINDER: Your appointment starts in 30 minutes!

📅 APPOINTMENT DETAILS:
• Title: ${summary}
• Date: ${date}
• Time: ${time}

⚡ LAST-MINUTE CHECKLIST:
✓ Leave now if you haven't already
✓ Bring required documents/ID  
✓ Have contact information ready
✓ Payment still pending - contact sales@company.com

Need to cancel or reschedule? Contact us immediately!

See you soon!
Appointment Management Team`
  }
};

// Type definitions
interface AppointmentDetails {
  summary: string;
  date: string;
  time: string;
  userName: string;
}

interface SendAppointmentEmailParams {
  to: string;
  appointmentDetails: AppointmentDetails;
}

interface SendReminderEmailParams {
  to: string;
  appointmentDetails: AppointmentDetails;
  reminderType: 'advance' | 'urgent';
  timeText: string;
}

// Helper function to send email via Gmail API
async function sendGmailEmail(to: string, subject: string, body: string, accessToken: string): Promise<any> {
  const email = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    body
  ].join('\n');

  const encodedEmail = btoa(email).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const response = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
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

  return response.json();
}

// Export the sendAppointmentEmail function
export async function sendAppointmentEmail({ to, appointmentDetails }: SendAppointmentEmailParams, accessToken: string) {
  const subject = EMAIL_TEMPLATES.appointment.subject;
  const body = EMAIL_TEMPLATES.appointment.body(
    appointmentDetails.userName,
    appointmentDetails.summary,
    appointmentDetails.date,
    appointmentDetails.time
  );

  const result = await sendGmailEmail(to, subject, body, accessToken);
  return { result, subject };
}

// Export the sendReminderEmail function
export async function sendReminderEmail({ to, appointmentDetails, reminderType, timeText }: SendReminderEmailParams, accessToken: string) {
  const template = reminderType === 'urgent' ? EMAIL_TEMPLATES.reminderUrgent : EMAIL_TEMPLATES.reminderAdvance;
  
  const subject = reminderType === 'urgent' 
    ? template.subject(appointmentDetails.summary)
    : (template.subject as (summary: string, timeText: string) => string)(appointmentDetails.summary, timeText);
    
  const body = reminderType === 'urgent'
    ? template.body(appointmentDetails.userName, appointmentDetails.summary, appointmentDetails.date, appointmentDetails.time)
    : (template.body as (userName: string, summary: string, date: string, time: string, timeText: string) => string)(
        appointmentDetails.userName, appointmentDetails.summary, appointmentDetails.date, appointmentDetails.time, timeText
      );

  const result = await sendGmailEmail(to, subject, body, accessToken);
  return { result, subject };
}

// MCP Server tools
export function registerEmailTools(server: any) {
  // Original appointment email tool
  server.tool(
    "sendAppointmentEmail",
    "Send a simple appointment scheduled email notification",
    {
      to: z.string().email().describe("Recipient email address"),
      appointmentDetails: z.object({
        summary: z.string().describe("Appointment title"),
        date: z.string().describe("Appointment date"),
        time: z.string().describe("Appointment time"),
        userName: z.string().describe("Client name"),
      }).describe("Appointment details for the email"),
    },
    async ({ to, appointmentDetails }: SendAppointmentEmailParams) => {
      try {
        const accessToken = server.env?.GOOGLE_ACCESS_TOKEN;
        
        if (!accessToken) {
          throw new Error("Google access token not configured");
        }

        const { result } = await sendAppointmentEmail({ to, appointmentDetails }, accessToken);
        return {
          content: [{
            type: "text",
            text: `Email sent successfully to ${to}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );

  // New reminder email tool
  server.tool(
    "sendReminderEmail",
    "Send appointment reminder email with different formats based on timing",
    {
      to: z.string().email().describe("Recipient email address"),
      appointmentDetails: z.object({
        summary: z.string().describe("Appointment title"),
        date: z.string().describe("Appointment date"),
        time: z.string().describe("Appointment time"),
        userName: z.string().describe("Client name"),
      }).describe("Appointment details for the email"),
      reminderType: z.enum(['advance', 'urgent']).describe("Type of reminder: 'advance' for 1 day/1 hour, 'urgent' for 30 minutes"),
      timeText: z.string().describe("Human readable time text like 'in 1 hour', 'in 30 minutes'")
    },
    async ({ to, appointmentDetails, reminderType, timeText }: SendReminderEmailParams) => {
      try {
        const accessToken = server.env?.GOOGLE_ACCESS_TOKEN;
        
        if (!accessToken) {
          throw new Error("Google access token not configured");
        }

        const { result } = await sendReminderEmail({ to, appointmentDetails, reminderType, timeText }, accessToken);
        return {
          content: [{
            type: "text",
            text: `Reminder email sent successfully to ${to} (${reminderType} reminder)`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to send reminder email: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );
}

// Reminder intervals in minutes
const REMINDER_INTERVALS = [30, 60, 1440]; // 30 min, 1 hour, 1 day

interface Appointment {
  id: string;
  title: string;
  date: string;
  time: string;
  email: string;
  userName?: string;
  description?: string;
}

// Define the server interface with the methods we need
interface ExtendedMcpServer extends McpServer {
  call_tool(name: string, params: any): Promise<{ content?: Array<{ type: string; text: string }> }>;
}

class AppointmentReminderService {
  private server: ExtendedMcpServer;
  private env: any;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sentReminders = new Set<string>(); // Track sent reminders to avoid duplicates

  constructor(server: ExtendedMcpServer, env: any) {
    this.server = server;
    this.env = env;
  }

  // Start the reminder service
  start() {
    if (this.intervalId) {
      console.log("Reminder service already running");
      return;
    }

    console.log("Starting appointment reminder service...");
    
    // Check every 2 minutes
    this.intervalId = setInterval(() => {
      this.checkAndSendReminders().catch(console.error);
    }, 2 * 60 * 1000);

    // Run initial check
    this.checkAndSendReminders().catch(console.error);
  }

  // Stop the reminder service
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("Appointment reminder service stopped");
    }
  }

  private async checkAndSendReminders() {
    try {
      const appointments = await this.getUpcomingAppointments();
      
      for (const appointment of appointments) {
        await this.processAppointmentReminders(appointment);
      }
    } catch (error) {
      console.error("Error checking reminders:", error);
    }
  }

  private async getUpcomingAppointments(): Promise<Appointment[]> {
    try {
      // Call the list appointments tool
      const result = await this.server.call_tool("listAppointments", {});
      
      if (result.content?.[0]?.type === "text") {
        const text = result.content[0].text;
        
        // Parse appointments from the response
        if (text.includes("No appointments found")) {
          return [];
        }

        // Extract appointments from the formatted text
        const appointments: Appointment[] = [];
        const lines = text.split('\n');
        
        let currentAppointment: Partial<Appointment> = {};
        
        for (const line of lines) {
          if (line.startsWith('ID: ')) {
            if (currentAppointment.id) {
              appointments.push(currentAppointment as Appointment);
            }
            currentAppointment = { id: line.replace('ID: ', '').trim() };
          } else if (line.startsWith('Title: ')) {
            currentAppointment.title = line.replace('Title: ', '').trim();
          } else if (line.startsWith('Date: ')) {
            currentAppointment.date = line.replace('Date: ', '').trim();
          } else if (line.startsWith('Time: ')) {
            currentAppointment.time = line.replace('Time: ', '').trim();
          } else if (line.startsWith('Email: ')) {
            currentAppointment.email = line.replace('Email: ', '').trim();
          } else if (line.startsWith('User Name: ') || line.startsWith('Name: ')) {
            currentAppointment.userName = line.replace(/^(User Name: |Name: )/, '').trim();
          } else if (line.startsWith('Description: ')) {
            currentAppointment.description = line.replace('Description: ', '').trim();
          }
        }
        
        // Add the last appointment
        if (currentAppointment.id) {
          appointments.push(currentAppointment as Appointment);
        }
        
        return appointments;
      }
      
      return [];
    } catch (error) {
      console.error("Error fetching appointments:", error);
      return [];
    }
  }

  private async processAppointmentReminders(appointment: Appointment) {
    const appointmentDateTime = this.parseAppointmentDateTime(appointment.date, appointment.time);
    if (!appointmentDateTime) return;

    const now = new Date();
    const minutesUntilAppointment = Math.floor((appointmentDateTime.getTime() - now.getTime()) / (1000 * 60));

    for (const reminderMinutes of REMINDER_INTERVALS) {
      // Check if we should send this reminder (within 1 minute window)
      if (Math.abs(minutesUntilAppointment - reminderMinutes) <= 1) {
        const reminderKey = `${appointment.id}-${reminderMinutes}`;
        
        if (!this.sentReminders.has(reminderKey)) {
          await this.sendReminderEmail(appointment, reminderMinutes);
          this.sentReminders.add(reminderKey);
        }
      }
    }

    // Clean up old reminders for appointments that have passed
    if (minutesUntilAppointment < -60) {
      REMINDER_INTERVALS.forEach(interval => {
        this.sentReminders.delete(`${appointment.id}-${interval}`);
      });
    }
  }

  private parseAppointmentDateTime(date: string, time: string): Date | null {
    try {
      // Assuming date format is YYYY-MM-DD and time is HH:MM
      const dateTimeString = `${date}T${time}:00`;
      const appointmentDate = new Date(dateTimeString);
      
      if (isNaN(appointmentDate.getTime())) {
        console.error(`Invalid date/time format: ${date} ${time}`);
        return null;
      }
      
      return appointmentDate;
    } catch (error) {
      console.error("Error parsing appointment date/time:", error);
      return null;
    }
  }

  private async sendReminderEmail(appointment: Appointment, reminderMinutes: number) {
    try {
      const timeText = this.getReminderTimeText(reminderMinutes);
      
      // Determine reminder type: 30 minutes = urgent, others = advance
      const reminderType = reminderMinutes === 30 ? 'urgent' : 'advance';
      
      const appointmentDetails = {
        summary: appointment.title,
        date: appointment.date,
        time: appointment.time,
        userName: appointment.userName || 'Client' // Fallback if userName not available
      };

      await this.server.call_tool("sendReminderEmail", {
        to: appointment.email,
        appointmentDetails: appointmentDetails,
        reminderType: reminderType,
        timeText: timeText
      });

      console.log(`${reminderType} reminder sent for appointment ${appointment.id} (${timeText})`);
    } catch (error) {
      console.error(`Error sending reminder for appointment ${appointment.id}:`, error);
    }
  }

  private getReminderTimeText(minutes: number): string {
    if (minutes === 30) return "in 30 minutes";
    if (minutes === 60) return "in 1 hour";
    if (minutes === 1440) return "in 1 day";
    return `in ${minutes} minutes`;
  }
}

// Export function to initialize the reminder service
export function initializeReminderService(server: ExtendedMcpServer, env: any) {
  const reminderService = new AppointmentReminderService(server, env);
  
  // Start the service
  reminderService.start();
  
  // Return the service instance in case you need to stop it later
  return reminderService;
}
