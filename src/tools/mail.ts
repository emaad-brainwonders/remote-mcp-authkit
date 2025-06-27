// mail.ts
import { z } from "zod";

// Email configuration
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const ACCESS_TOKEN = "ya29.a0AS3H6NySerbUeUlttl4xYIC9Njp3c29juiUg4uYgAFEMQ8vpuu4DrzpKefU-Z7McWboXRNE4fiFFFL07ZMtiJFYpoLPpPedjZDi7bGEBoNfEfB7A60wIrzQ6wxq555nmoHXQ5Rt6_AXVT1WXA9tBrhGnv3D23oCPDG51kJmzaCgYKAdISARQSFQHGX2MiVHdTa4DbBlLnC8GTM6lagA0175"; // Replace with your actual token

// Email templates
const EMAIL_TEMPLATES = {
	appointmentCreated: {
		subject: "Appointment Confirmed - Payment Pending",
		body: `Your appointment has been confirmed.

Payment is pending - please contact our sales team to complete payment.

Thank you.`
	},
	appointmentCancelled: {
		subject: "Appointment Cancelled",
		body: `Your appointment has been cancelled.

If you have any questions, please contact our support team.

Thank you.`
	},
	appointmentRescheduled: {
		subject: "Appointment Rescheduled",
		body: `Your appointment has been rescheduled.

Please check your calendar for the new date and time.

Thank you.`
	}
};

// Type definitions
type EmailType = 'created' | 'cancelled' | 'rescheduled';

interface AppointmentDetails {
	summary: string;
	date: string;
	time: string;
	userName?: string;
}

interface SendAppointmentEmailParams {
	to: string;
	emailType: EmailType;
	appointmentDetails: AppointmentDetails;
	customMessage?: string;
}

interface SendCustomEmailParams {
	to: string;
	subject: string;
	message: string;
	includeSignature: boolean;
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

// Export the sendAppointmentEmail function for use in other modules
export async function sendAppointmentEmail({ to, emailType, appointmentDetails, customMessage }: SendAppointmentEmailParams) {
	let template;
	let subject;
	let body;

	switch (emailType) {
		case 'created':
			template = EMAIL_TEMPLATES.appointmentCreated;
			subject = template.subject;
			body = `Hi ${appointmentDetails.userName || 'there'},

${template.body}

Appointment Details:
• ${appointmentDetails.summary}
• ${appointmentDetails.date} at ${appointmentDetails.time}

${customMessage || ''}

Best regards,
Sales Team`;
			break;

		case 'cancelled':
			template = EMAIL_TEMPLATES.appointmentCancelled;
			subject = template.subject;
			body = `Hi ${appointmentDetails.userName || 'there'},

${template.body}

Cancelled Appointment:
• ${appointmentDetails.summary}
• Originally: ${appointmentDetails.date} at ${appointmentDetails.time}

${customMessage || ''}

Best regards,
Support Team`;
			break;

		case 'rescheduled':
			template = EMAIL_TEMPLATES.appointmentRescheduled;
			subject = template.subject;
			body = `Hi ${appointmentDetails.userName || 'there'},

${template.body}

Updated Appointment:
• ${appointmentDetails.summary}
• New Date: ${appointmentDetails.date} at ${appointmentDetails.time}

${customMessage || ''}

Best regards,
Support Team`;
			break;

		default:
			throw new Error(`Unknown email type: ${emailType}`);
	}

	return await sendGmailEmail(to, subject, body);
}

// MCP Server tools
export function registerEmailTools(server: any) {
	// Send immediate appointment notification
	server.tool(
		"sendAppointmentEmail",
		"Send email notification for appointment events (creation, cancellation, rescheduling)",
		{
			to: z.string().email().describe("Recipient email address"),
			emailType: z.enum(['created', 'cancelled', 'rescheduled']).describe("Type of appointment email to send"),
			appointmentDetails: z.object({
				summary: z.string().describe("Appointment title/summary"),
				date: z.string().describe("Appointment date"),
				time: z.string().describe("Appointment time"),
				userName: z.string().optional().describe("Client name"),
			}).describe("Appointment details for the email"),
			customMessage: z.string().optional().describe("Additional custom message to include"),
		},
		async ({ to, emailType, appointmentDetails, customMessage }: SendAppointmentEmailParams) => {
			try {
				const result = await sendAppointmentEmail({ to, emailType, appointmentDetails, customMessage });

				return {
					content: [{
						type: "text",
						text: `✅ **Email sent successfully!**

📧 **To:** ${to}
📋 **Subject:** ${subject}
📤 **Message ID:** ${result.id}

The ${emailType} notification has been delivered.`
					}]
				};

			} catch (error) {
				return {
					content: [{
						type: "text",
						text: `❌ **Failed to send email**

${error instanceof Error ? error.message : 'Unknown error occurred'}

Please check:
• Email address format
• Gmail API access token
• Network connectivity`
					}]
				};
			}
		}
	);

	// Send custom email
	server.tool(
		"sendCustomEmail",
		"Send a custom email to appointment attendees",
		{
			to: z.string().email().describe("Recipient email address"),
			subject: z.string().min(1).describe("Email subject line"),
			message: z.string().min(1).describe("Email message body"),
			includeSignature: z.boolean().default(true).describe("Include company signature"),
		},
		async ({ to, subject, message, includeSignature }: SendCustomEmailParams) => {
			try {
				let finalMessage = message;

				if (includeSignature) {
					finalMessage += `\n\nBest regards,\nSupport Team`;
				}

				const result = await sendGmailEmail(to, subject, finalMessage);

				return {
					content: [{
						type: "text",
						text: `✅ **Custom email sent successfully!**

📧 **To:** ${to}
📋 **Subject:** ${subject}
📤 **Message ID:** ${result.id}

Your custom message has been delivered.`
					}]
				};

			} catch (error) {
				return {
					content: [{
						type: "text",
						text: `❌ **Failed to send custom email**

${error instanceof Error ? error.message : 'Unknown error occurred'}

Please verify the email details and try again.`
					}]
				};
			}
		}
	);
}
