// Schedule appointment tool (enhanced with relative date support)
server.tool(
	"scheduleAppointment",
	"Schedule an appointment via Google Calendar (uses Asia/Kolkata timezone, and includes today's date in the description). Supports relative dates like 'today', 'tomorrow', '10 days from now', etc.",
	{
		summary: z.string(),
		description: z.string().optional(),
		date: z.string().describe("Date in YYYY-MM-DD format or relative expression like 'today', 'tomorrow', '10 days from now', etc."),
		startTime: z.string().describe("Start time in HH:MM format (24-hour), e.g., '10:00'"),
		endTime: z.string().describe("End time in HH:MM format (24-hour), e.g., '11:00'"),
		attendees: z.union([
			z.array(z.object({ email: z.string() })),
			z.string().transform((val) => {
				try {
					// Try to parse JSON string
					const parsed = JSON.parse(val);
					if (Array.isArray(parsed)) {
						return parsed;
					}
					// If it's a single email string, convert to array format
					if (typeof parsed === 'string') {
						return [{ email: parsed }];
					}
					return [];
				} catch {
					// If JSON parsing fails, treat as single email
					return [{ email: val }];
				}
			})
		]).optional().default([]),
		checkAvailability: z.union([z.boolean(), z.string()]).default(true).transform((val) => {
			if (typeof val === 'string') {
				return val.toLowerCase() === 'true';
			}
			return val;
		}).describe("Check if the time slot is available before scheduling (true/false)"),
	},
	async ({
		summary,
		description,
		date,
		startTime,
		endTime,
		attendees = [],
		checkAvailability = true,
	}) => {
		const token = HARDCODED_GOOGLE_ACCESS_TOKEN;
		const today = await getCurrentDate();
		
		if (!token) throw new Error("Google OAuth access token is required.");
		
		// Parse the date input to handle relative expressions
		let parsedDate: string;
		try {
			parsedDate = parseRelativeDate(date);
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Error parsing date: ${error instanceof Error ? error.message : 'Invalid date format'}`,
					},
				],
			};
		}
		
		// Construct full datetime strings
		const startDateTime = `${parsedDate}T${startTime}:00`;
		const endDateTime = `${parsedDate}T${endTime}:00`;
		
		// Check availability if requested
		if (checkAvailability) {
			const dayStartTime = `${parsedDate}T00:00:00+05:30`;
			const dayEndTime = `${parsedDate}T23:59:59+05:30`;
			
			const checkResponse = await fetch(
				`https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
				`timeMin=${encodeURIComponent(dayStartTime)}&` +
				`timeMax=${encodeURIComponent(dayEndTime)}&` +
				`singleEvents=true&` +
				`orderBy=startTime`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
				}
			);
			
			if (checkResponse.ok) {
				const checkResult = await checkResponse.json() as { items?: any[] };
				const existingEvents = checkResult.items || [];
				
				if (!isTimeSlotAvailable(existingEvents, startDateTime, endDateTime)) {
					return {
						content: [
							{
								type: "text",
								text: `Time slot ${startTime} to ${endTime} on ${parsedDate} (interpreted from: "${date}") is not available. Please use the 'recommendAppointmentTimes' tool to find available slots.`,
							},
						],
					};
				}
			}
		}
		
		const fullDescription =
			(description ? description + "\n" : "") +
			`Scheduled on (UTC): ${today}`;
		
		const event = {
			summary,
			description: fullDescription,
			start: { dateTime: startDateTime, timeZone: "Asia/Kolkata" },
			end: { dateTime: endDateTime, timeZone: "Asia/Kolkata" },
			attendees,
		};
		
		const response = await fetch(
			"https://www.googleapis.com/calendar/v3/calendars/primary/events",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
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
		
		const result = (await response.json()) as { htmlLink?: string };
		return {
			content: [
				{
					type: "text",
					text: `Appointment successfully created for ${parsedDate} (interpreted from: "${date}") from ${startTime} to ${endTime}: ${result.htmlLink}`,
				},
			],
		};
	}
);
