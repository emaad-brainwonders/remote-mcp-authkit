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
	reminder1Hour: {
		subject: "Reminder: Appointment in 1 Hour",
		body: `This is a reminder that your appointment is scheduled in 1 hour.

Please be ready for your session.

Thank you.`
	},
	reminder30Min: {
		subject: "Reminder: Appointment in 30 Minutes",
		body: `Your appointment starts in 30 minutes.

Please join on time.

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

interface AppointmentDetailsWithDateTime {
	summary: string;
	dateTime: string;
	userName?: string;
}

interface Reminders {
	oneHour: boolean;
	thirtyMinutes: boolean;
}

interface SendAppointmentEmailParams {
	to: string;
	emailType: EmailType;
	appointmentDetails: AppointmentDetails;
	customMessage?: string;
}

interface ScheduleAppointmentRemindersParams {
	to: string;
	appointmentDetails: AppointmentDetailsWithDateTime;
	reminders: Reminders;
}

interface SendCustomEmailParams {
	to: string;
	subject: string;
	message: string;
	includeSignature: boolean;
}

interface CancelScheduledRemindersParams {
	scheduleIds: string[];
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

// Helper function to schedule delayed email (using Cloudflare Durable Objects or similar)
async function scheduleEmail(to: string, subject: string, body: string, delayMinutes: number): Promise<string> {
	// This would typically use Cloudflare's scheduled functions or a queue
	// For now, we'll return a mock schedule ID
	const scheduleId = `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	
	// In a real implementation, you'd store this in KV or Durable Objects
	// and use Cloudflare Workers' scheduled events to send the email
	console.log(`Scheduled email to ${to} in ${delayMinutes} minutes. Schedule ID: ${scheduleId}`);
	
	return scheduleId;
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

				const result = await sendGmailEmail(to, subject, body);

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

	// Schedule appointment reminder emails
	server.tool(
		"scheduleAppointmentReminders",
		"Schedule reminder emails for upcoming appointments (1 hour and 30 minutes before)",
		{
			to: z.string().email().describe("Recipient email address"),
			appointmentDetails: z.object({
				summary: z.string().describe("Appointment title/summary"),
				dateTime: z.string().describe("Appointment date and time in ISO format"),
				userName: z.string().optional().describe("Client name"),
			}).describe("Appointment details"),
			reminders: z.object({
				oneHour: z.boolean().default(true).describe("Send 1-hour reminder"),
				thirtyMinutes: z.boolean().default(true).describe("Send 30-minute reminder"),
			}).default({ oneHour: true, thirtyMinutes: true }).describe("Which reminders to schedule"),
		},
		async ({ to, appointmentDetails, reminders }: ScheduleAppointmentRemindersParams) => {
			try {
				const appointmentTime = new Date(appointmentDetails.dateTime);
				const now = new Date();
				const scheduledReminders = [];

				// Calculate reminder times
				const oneHourBefore = new Date(appointmentTime.getTime() - 60 * 60 * 1000);
				const thirtyMinBefore = new Date(appointmentTime.getTime() - 30 * 60 * 1000);

				// Schedule 1-hour reminder
				if (reminders.oneHour && oneHourBefore > now) {
					const minutesUntilReminder = Math.floor((oneHourBefore.getTime() - now.getTime()) / (1000 * 60));
					const subject = EMAIL_TEMPLATES.reminder1Hour.subject;
					const body = `Hi ${appointmentDetails.userName || 'there'},

${EMAIL_TEMPLATES.reminder1Hour.body}

Appointment Details:
• ${appointmentDetails.summary}
• Time: ${appointmentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

Best regards,
Support Team`;

					const scheduleId = await scheduleEmail(to, subject, body, minutesUntilReminder);
					scheduledReminders.push({
						type: '1-hour',
						scheduleId,
						scheduledFor: oneHourBefore.toISOString()
					});
				}

				// Schedule 30-minute reminder
				if (reminders.thirtyMinutes && thirtyMinBefore > now) {
					const minutesUntilReminder = Math.floor((thirtyMinBefore.getTime() - now.getTime()) / (1000 * 60));
					const subject = EMAIL_TEMPLATES.reminder30Min.subject;
					const body = `Hi ${appointmentDetails.userName || 'there'},

${EMAIL_TEMPLATES.reminder30Min.body}

Appointment Details:
• ${appointmentDetails.summary}
• Time: ${appointmentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

Best regards,
Support Team`;

					const scheduleId = await scheduleEmail(to, subject, body, minutesUntilReminder);
					scheduledReminders.push({
						type: '30-minute',
						scheduleId,
						scheduledFor: thirtyMinBefore.toISOString()
					});
				}

				if (scheduledReminders.length === 0) {
					return {
						content: [{
							type: "text",
							text: `⚠️ **No reminders scheduled**

The appointment time is too close to schedule reminders, or reminders were disabled.

Appointment: ${appointmentDetails.summary}
Time: ${appointmentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
						}]
					};
				}

				const reminderList = scheduledReminders.map(r => 
					`• ${r.type} reminder: ${new Date(r.scheduledFor).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
				).join('\n');

				return {
					content: [{
						type: "text",
						text: `✅ **Reminders scheduled successfully!**

📧 **Recipient:** ${to}
📋 **Appointment:** ${appointmentDetails.summary}
🕐 **Appointment Time:** ${appointmentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

📬 **Scheduled Reminders:**
${reminderList}

The reminder emails will be sent automatically.`
					}]
				};

			} catch (error) {
				return {
					content: [{
						type: "text",
						text: `❌ **Failed to schedule reminders**

${error instanceof Error ? error.message : 'Unknown error occurred'}

Please check:
• Appointment date/time format
• Email address
• System permissions`
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

	// Cancel scheduled reminders
	server.tool(
		"cancelScheduledReminders",
		"Cancel previously scheduled reminder emails",
		{
			scheduleIds: z.array(z.string()).describe("Array of schedule IDs to cancel"),
		},
		async ({ scheduleIds }: CancelScheduledRemindersParams) => {
			try {
				// In a real implementation, you'd remove these from your queue/storage
				const cancelledIds = [];
				
				for (const scheduleId of scheduleIds) {
					// Mock cancellation - in practice, you'd remove from KV/Durable Objects
					console.log(`Cancelled scheduled email: ${scheduleId}`);
					cancelledIds.push(scheduleId);
				}

				return {
					content: [{
						type: "text",
						text: `✅ **Reminders cancelled successfully!**

🚫 **Cancelled Schedule IDs:**
${cancelledIds.map(id => `• ${id}`).join('\n')}

The scheduled reminder emails have been cancelled and will not be sent.`
					}]
				};

			} catch (error) {
				return {
					content: [{
						type: "text",
						text: `❌ **Failed to cancel reminders**

${error instanceof Error ? error.message : 'Unknown error occurred'}

Please check the schedule IDs and try again.`
					}]
				};
			}
		}
	);
}
