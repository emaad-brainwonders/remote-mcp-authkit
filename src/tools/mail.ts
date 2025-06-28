import { z } from "zod";
// Email configuration
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
// Simple email template
const EMAILTEMPLATE = {
  subject: "Appointment Scheduled",
  body: (userName: string, summary: string, date: string, time: string) => 
    Hello ${userName},
Your appointment has been scheduled.
Appointment: ${summary}
Date: ${date}
Time: ${time}
Payment Status: Not Paid
Please contact the sales team to complete payment.
Email: sales@company.com
Thank you.
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
async function sendGmailEmail(to: string, subject: string, body: string, accessToken: string): Promise<any> {
  const email = [
    To: ${to},
    Subject: ${subject},
    Content-Type: text/plain; charset="UTF-8",
    ``,
    body
  ].join('\n');
  const encodedEmail = btoa(email).replace(/\+/g, '-').replace(/\//g, '').replace(/=+$/, '');
  const response = await fetch(${GMAIL_API_BASE}/users/me/messages/send, {
    method: 'POST',
    headers: {
      'Authorization': Bearer ${accessToken},
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodedEmail
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(Gmail API error: ${response.status} - ${error});
  }
  return response.json();
}
// Export the sendAppointmentEmail function
export async function sendAppointmentEmail({ to, appointmentDetails }: SendAppointmentEmailParams, accessToken: string) {
  const subject = EMAIL_TEMPLATE.subject;
  const body = EMAIL_TEMPLATE.body(
    appointmentDetails.userName,
    appointmentDetails.summary,
    appointmentDetails.date,
    appointmentDetails.time
  );
  const result = await sendGmailEmail(to, subject, body, accessToken);
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
        // Access the environment variable from the server context
        const accessToken = server.env?.GOOGLE_ACCESS_TOKEN;

        if (!accessToken) {
          throw new Error("Google access token not configured");
        }
        const { result } = await sendAppointmentEmail({ to, appointmentDetails }, accessToken);
        return {
          content: [{
            type: "text",
            text: Email sent successfully to ${to}
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}
          }]
        };
      }
    }
  );
} 
