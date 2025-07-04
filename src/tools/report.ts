import { z } from 'zod';

// Define types for the API response
interface ClientInfo {
  ClientID: number;
  ClientName: string;
  ContactNumber: string;
  Email: string;
}

interface ReportData {
  uniqueid: number;
  FileName: string;
  UploadTime: string;
  ClientName: string;
  ReportPath: string;
  ReportPdfPath: string;
  ClientID: number;
  FilePath: string;
  Count: number;
  adc: number;
  radc: number;
  ragc: number;
  agc: number;
  rc: number;
}

interface ClientWithReports {
  client_info: ClientInfo;
  reports: ReportData[];
  reports_count: number;
}

interface ApiResponse {
  message: string;
  data: ClientWithReports[];
  clients_found: number;
  query_params: {
    phone?: string;
    email?: string;
    limit: number;
  };
}

export function registerReportTools(server: any) {
  server.tool(
    "get_report_by_contact",
    "Get user reports by phone number or email address. At least one contact method (phone or email) must be provided.",
    {
      phone: z.string().optional().describe("Phone number to search for (optional if email is provided)"),
      email: z.string().optional().describe("Email address to search for (optional if phone is provided)"),
      limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10, max: 100)")
    },
    async ({ phone, email, limit = 10 }: { phone?: string; email?: string; limit?: number }) => {
      try {
        // Validate that at least one contact method is provided
        if (!phone && !email) {
          return { 
            content: [{ 
              type: 'text', 
              text: 'Error: Either phone number or email address is required to search for reports.' 
            }] 
          };
        }

        // Validate and sanitize inputs
        const cleanPhone = phone?.trim();
        const cleanEmail = email?.trim();
        const searchLimit = Math.min(Math.max(limit, 1), 100); // Ensure limit is between 1 and 100

        // Build query parameters
        const queryParams = new URLSearchParams();
        if (cleanPhone) queryParams.append('phone', cleanPhone);
        if (cleanEmail) queryParams.append('email', cleanEmail);
        queryParams.append('limit', searchLimit.toString());

        console.log(`Searching for reports with contact info - Phone: ${cleanPhone || 'Not provided'}, Email: ${cleanEmail || 'Not provided'}`);

        const response = await fetch(`https://dimt-api.onrender.com/api/user-reports-by-contact?${queryParams}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            return { 
              content: [{ 
                type: 'text', 
                text: `No user found with the provided contact information.${cleanPhone ? `\nPhone: ${cleanPhone}` : ''}${cleanEmail ? `\nEmail: ${cleanEmail}` : ''}` 
              }] 
            };
          }
          
          return { 
            content: [{ 
              type: 'text', 
              text: `API Error: ${response.status} - ${response.statusText}` 
            }] 
          };
        }

        const data: ApiResponse = await response.json();
        
        if (data.clients_found === 0) {
          return { 
            content: [{ 
              type: 'text', 
              text: `No users found with the provided contact information.${cleanPhone ? `\nPhone: ${cleanPhone}` : ''}${cleanEmail ? `\nEmail: ${cleanEmail}` : ''}` 
            }] 
          };
        }

        // Format the response
        let resultText = `Found ${data.clients_found} user(s) matching your search:\n\n`;
        
        data.data.forEach((clientData, index) => {
          const { client_info, reports, reports_count } = clientData;
          
          resultText += `${index + 1}. Client Information:\n`;
          resultText += `   Name: ${client_info.ClientName}\n`;
          resultText += `   ID: ${client_info.ClientID}\n`;
          resultText += `   Phone: ${client_info.ContactNumber}\n`;
          resultText += `   Email: ${client_info.Email}\n`;
          resultText += `   Total Reports: ${reports_count}\n\n`;
          
          if (reports_count > 0) {
            resultText += `   Recent Reports:\n`;
            reports.slice(0, 5).forEach((report, reportIndex) => {
              resultText += `   ${reportIndex + 1}. ${report.FileName} (${report.UploadTime})\n`;
              resultText += `      Report Path: ${report.ReportPath}\n`;
              if (report.ReportPdfPath) {
                resultText += `      PDF Path: ${report.ReportPdfPath}\n`;
              }
            });
            
            if (reports_count > 5) {
              resultText += `   ... and ${reports_count - 5} more reports\n`;
            }
          } else {
            resultText += `   No reports found for this client.\n`;
          }
          
          resultText += `\n`;
        });

        return {
          content: [{
            type: 'text',
            text: resultText
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred while searching for reports'}`
          }]
        };
      }
    }
  );
}
