// mail.ts
import { z } from "zod";
//import { getGoogleAccessToken } from "../env"; // Import env helper

// Email configuration
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const ACCESS_TOKEN = "ya29.a0AS3H6NwGvrRXJ1jNlGvt8ytji4LyB8fgMftHpy-kVhDq1AzD0WLKX50g89FlFTDEcEpmbnn3BZJlv84ezw8iIgOcry-_nriB1oJvr1E5K4iJZnQGJvW6o8bIGRuqRPv46itwhcECge2oVjARmi6XjCbbSk6MA4teRajOashRaCgYKAW0SARQSFQHGX2MiVPm_M1TfQZFFe923_pu7lQ0175";
// Simple email template
const EMAIL_TEMPLATE = {
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

// Helper function to send email via Gmail API
async function sendGmailEmail(to: string, subject: string, body: string): Promise<any> {
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
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
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
export async function sendAppointmentEmail({ to, appointmentDetails }: SendAppointmentEmailParams) {
  const subject = EMAIL_TEMPLATE.subject;
  const body = EMAIL_TEMPLATE.body(
    appointmentDetails.userName,
    appointmentDetails.summary,
    appointmentDetails.date,
    appointmentDetails.time
  );

  const result = await sendGmailEmail(to, subject, body);
  return { result, subject };
}

// MCP Server tool
export function registerEmailTools(server: any) {
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
        const { result } = await sendAppointmentEmail({ to, appointmentDetails });

        return {
          content: [{
            type: "text",
            text: `Email sent to ${to}`
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
}
