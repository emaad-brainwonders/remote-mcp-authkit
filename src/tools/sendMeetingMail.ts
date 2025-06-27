export async function sendMeetingMail({
  to,
  meetingDescription,
  salesContact,
  accessToken
}: {
  to: string;
  meetingDescription: string;
  salesContact: string;
  accessToken: string;
}) {
  const emailContent = `To: ${to}
Subject: Your Meeting Appointment
Content-Type: text/html; charset=utf-8

<div style="font-family: Arial, sans-serif; padding: 20px;">
  <h2>Meeting Appointment</h2>
  <p>${meetingDescription}</p>
  <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f44336;">
    <strong>Payment Required:</strong> Your fees are not yet paid. Please contact our sales team: ${salesContact}
  </div>
  <p>Best regards,<br>Brainwonders Team</p>
</div>`;

  // Encode the email in base64url format
  const encodedEmail = btoa(emailContent)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
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
      throw new Error(`Gmail API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log("Email sent via Gmail API:", result.id);
    return result;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}
