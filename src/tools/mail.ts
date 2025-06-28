import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Email configuration
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

// Email templates
const EMAIL_TEMPLATES = {
  // Original appointment scheduled email
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
  
  // Reminder for 1 day and 1 hour before (detailed format)
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

  // Reminder for 30 minutes before (urgent format)
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

// Export the sendAppointmentEmail function (original)
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

// Export the sendReminderEmail function (new)
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

// MCP Server tools registration
export function registerEmailTools(server: McpServer) {
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
    async ({ to, appointmentDetails }: SendAppointmentEmailParams, { server }: { server: any }) => {
      try {
        // Access the environment variable from the server context
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
    async ({ to, appointmentDetails, reminderType, timeText }: SendReminderEmailParams, { server }: { server: any }) => {
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
