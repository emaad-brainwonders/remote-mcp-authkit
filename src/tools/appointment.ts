import { z } from "zod";
import { sendAppointmentEmail } from "./mail";  
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRecommendAppointmentTimesTool } from "./recommendAppointmentTimesTool";
import { registerScheduleAppointmentTool } from "./scheduleAppointmentTool";
import { registerCancelAppointmentTool } from "./cancelAppointmentTool";
import { registerRescheduleAppointmentTool } from "./rescheduleAppointmentTool";
import { registerGetUserAppointmentsTool } from "./getUserAppointmentsTool";

// Function to get access token from environment
export function getAccessToken(env: any): string {
	const token = env.GOOGLE_ACCESS_TOKEN;
	if (!token) {
		throw new Error("Google OAuth access token is required. Please set GOOGLE_ACCESS_TOKEN in your Wrangler secrets.");
	}
	return token;
}

// Helper: Format date to YYYY-MM-DD   
export function formatDateToString(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${date.getFullYear()}-` +
		`${pad(date.getMonth() + 1)}-` +
		`${pad(date.getDate())}`
	);
}

// Helper: Get current date in UTC
export function getCurrentDate(): string {
	const nowUTC = new Date();
	return formatDateToString(nowUTC);
}

// Helper: Format date for display
export function formatDateForDisplay(dateString: string): string {
	const date = new Date(dateString + 'T00:00:00');
	const options: Intl.DateTimeFormatOptions = { 
		weekday: 'long', 
		year: 'numeric', 
		month: 'long', 
		day: 'numeric' 
	};
	return date.toLocaleDateString('en-IN', options);
}

// Helper: Parse relative date expressions with better error handling
export function parseRelativeDate(dateInput: string): string {
	if (!dateInput || typeof dateInput !== 'string') {
		throw new Error("Date input is required and must be a string");
	}

	const today = new Date();
	const inputLower = dateInput.toLowerCase().trim();
	
	// Handle "today", "tomorrow", "yesterday"
	if (inputLower === 'today') {
		return formatDateToString(today);
	}
	if (inputLower === 'tomorrow') {
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		return formatDateToString(tomorrow);
	}
	if (inputLower === 'yesterday') {
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		return formatDateToString(yesterday);
	}
	
	// Handle "X days from now", "in X days", "X days later"
	const relativeDayPatterns = [
		/(\d+)\s+days?\s+from\s+now/i,
		/in\s+(\d+)\s+days?/i,
		/(\d+)\s+days?\s+later/i,
		/after\s+(\d+)\s+days?/i
	];
	
	for (const pattern of relativeDayPatterns) {
		const match = inputLower.match(pattern);
		if (match) {
			const daysToAdd = parseInt(match[1]);
			if (isNaN(daysToAdd) || daysToAdd < 0) {
				throw new Error(`Invalid number of days: ${match[1]}`);
			}
			const targetDate = new Date(today);
			targetDate.setDate(today.getDate() + daysToAdd);
			return formatDateToString(targetDate);
		}
	}
	
	// Handle "X days ago", "X days before"
	const pastDayPatterns = [
		/(\d+)\s+days?\s+ago/i,
		/(\d+)\s+days?\s+before/i
	];
	
	for (const pattern of pastDayPatterns) {
		const match = inputLower.match(pattern);
		if (match) {
			const daysToSubtract = parseInt(match[1]);
			if (isNaN(daysToSubtract) || daysToSubtract < 0) {
				throw new Error(`Invalid number of days: ${match[1]}`);
			}
			const targetDate = new Date(today);
			targetDate.setDate(today.getDate() - daysToSubtract);
			return formatDateToString(targetDate);
		}
	}
	
	// Handle "next week", "next month" etc.
	if (inputLower.includes('next week')) {
		const nextWeek = new Date(today);
		nextWeek.setDate(today.getDate() + 7);
		return formatDateToString(nextWeek);
	}
	
	if (inputLower.includes('next month')) {
		const nextMonth = new Date(today);
		nextMonth.setMonth(today.getMonth() + 1);
		return formatDateToString(nextMonth);
	}
	
	// If it's already in YYYY-MM-DD format, validate and return
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
		const testDate = new Date(dateInput + 'T00:00:00');
		if (isNaN(testDate.getTime())) {
			throw new Error(`Invalid date format: ${dateInput}`);
		}
		return dateInput;
	}
	
	// Try to parse as a date
	const parsedDate = new Date(dateInput);
	if (!isNaN(parsedDate.getTime())) {
		return formatDateToString(parsedDate);
	}
	
	// If all else fails, throw an error
	throw new Error(`Unable to parse date: "${dateInput}". Please use YYYY-MM-DD format or relative expressions like "10 days from now", "tomorrow", etc.`);
}

// Helper: Validate time format
export function validateTimeFormat(time: string): boolean {
	return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

// Helper: Subtract 5:30 (19800000 ms) from a date string in ISO format
export function shiftTimeBackwards530(dateTimeIso: string): string {
    const date = new Date(dateTimeIso);
    const shifted = new Date(date.getTime() - 19800000);
    return shifted.toISOString().slice(0, 19);
}

// Helper: Check if a time slot is available (NO shift applied to slot times)
export function isTimeSlotAvailable(events: any[], meetingStart: string, meetingEnd: string, bufferMinutes = 15): boolean {
  const startTime = new Date(meetingStart).getTime();
  const endTime = new Date(meetingEnd).getTime();
  const endTimeWithBuffer = endTime + (bufferMinutes * 60 * 1000);

  for (const event of events) {
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    const eventStart = new Date(event.start.dateTime).getTime();
    const eventEnd = new Date(event.end.dateTime).getTime();
    if (startTime < eventEnd && endTimeWithBuffer > eventStart) {
      return false;
    }
  }
  return true;
}
// Helper: Parse attendees from various input formats
export function parseAttendeesInput(attendees: any): string[] {
    if (!attendees) return [];
    
    // If it's already an array
    if (Array.isArray(attendees)) {
        return attendees
            .map(item => {
                if (typeof item === 'string') return item;
                if (typeof item === 'object' && item.email) return item.email;
                return null;
            })
            .filter(Boolean) as string[];
    }
    
    // If it's a string that looks like a JSON array
    if (typeof attendees === 'string') {
        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(attendees);
            return parseAttendeesInput(parsed);
        } catch {
            // If JSON parsing fails, treat as a single email or comma-separated emails
            if (attendees.includes('@')) {
                // Split by comma and clean up
                return attendees
                    .split(',')
                    .map(email => email.trim())
                    .filter(email => email.includes('@'));
            }
        }
    }
    
    return [];
}

// Helper: Make API request with better error handling
export async function makeCalendarApiRequest(url: string, env: any, options: RequestInit = {}): Promise<any> {
	try {
		const token = getAccessToken(env);
		
		const response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...options.headers,
			},
		});
		
		if (!response.ok) {
			const errorBody = await response.text();
			let errorMessage = `Google Calendar API error: ${response.status}`;
			
			try {
				const errorJson = JSON.parse(errorBody);
				if (errorJson.error?.message) {
					errorMessage += ` - ${errorJson.error.message}`;
				}
			} catch {
				errorMessage += ` - ${errorBody}`;
			}
			
			throw new Error(errorMessage);
		}
		
		return await response.json();
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error(`Unexpected error: ${String(error)}`);
	}
}

export function eventMatchesUser(event: any, { userName, userEmail, userPhone }: { userName?: string, userEmail?: string, userPhone?: string }) {
    let found = false;
    // Match by summary (name)
    if (userName && event.summary && event.summary.toLowerCase().includes(userName.toLowerCase())) found = true;
    // Match by attendee email
    if (userEmail && event.attendees && event.attendees.some((a: any) => a.email && a.email.toLowerCase() === userEmail.toLowerCase())) found = true;
    // Match by phone in description
    if (userPhone && event.description && event.description.includes(userPhone)) found = true;
    return found;
}

export function setupAppointmentTools(server: McpServer, env: any) {
  registerRecommendAppointmentTimesTool(server, env);
  registerScheduleAppointmentTool(server, env);
  registerCancelAppointmentTool(server, env);
  registerRescheduleAppointmentTool(server, env);
  registerGetUserAppointmentsTool(server, env);
}
