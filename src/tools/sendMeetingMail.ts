import nodemailer from "nodemailer";

/**
 * Sends a meeting email to the attendee
 * @param to Email address of the attendee
 * @param meetingDescription Description of the meeting
 * @param salesContact Email or contact info of your sales team
 */
export async function sendMeetingMail({
  to,
  meetingDescription,
  salesContact
}: {
  to: string;
  meetingDescription: string;
  salesContact: string;
}) {
  const transporter = nodemailer.createTransporter({
    service: "gmail",
    auth: {
      user: "emaad.brainwonders@gmail.com", // Replace with your Gmail
      pass: "nurf eynr msuk fkmx",    // Replace with your App Password
    },
  });

  const mailOptions = {
    from: '"Brainwonders" <your-email@gmail.com>', // Replace with your Gmail
    to,
    subject: "Your Meeting Appointment",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Meeting Appointment</h2>
        <p>${meetingDescription}</p>
        <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f44336;">
          <strong>Payment Required:</strong> Your fees are not yet paid. Please contact our sales team: ${salesContact}
        </div>
        <p>Best regards,<br>Brainwonders Team</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}
