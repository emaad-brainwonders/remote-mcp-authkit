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

        // Clean and validate inputs - Fix the null string issue
        const cleanPhone = phone?.trim() === 'null' ? undefined : phone?.trim();
        const cleanEmail = email?.trim() === 'null' ? undefined : email?.trim();
        const searchLimit = Math.min(Math.max(limit, 1), 100);

        // Validate that we still have at least one contact method after cleaning
        if (!cleanPhone && !cleanEmail) {
          return { 
            content: [{ 
              type: 'text', 
              text: 'Error: Either phone number or email address is required to search for reports.' 
            }] 
          };
        }

        // Build query parameters
        const queryParams = new URLSearchParams();
        if (cleanPhone) queryParams.append('phone', cleanPhone);
        if (cleanEmail) queryParams.append('email', cleanEmail);
        queryParams.append('limit', searchLimit.toString());

        const apiUrl = `https://dimt-api.onrender.com/api/user-reports-by-contact?${queryParams}`;
        
        console.log(`API URL: ${apiUrl}`);
        console.log(`Searching for reports with contact info - Phone: ${cleanPhone || 'Not provided'}, Email: ${cleanEmail || 'Not provided'}`);

        const response = await fetch(apiUrl);
        
        // Log response details for debugging
        console.log(`Response status: ${response.status}`);
        console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
          const errorText = await response.text();
          console.log(`Error response body: ${errorText}`);
          
          if (response.status === 404) {
            return { 
              content: [{ 
                type: 'text', 
                text: `No user found with the provided contact information.${cleanPhone ? `\nPhone: ${cleanPhone}` : ''}${cleanEmail ? `\nEmail: ${cleanEmail}` : ''}\n\nAPI URL: ${apiUrl}` 
              }] 
            };
          }
          
          return { 
            content: [{ 
              type: 'text', 
              text: `API Error: ${response.status} - ${response.statusText}\nResponse: ${errorText}\nAPI URL: ${apiUrl}` 
            }] 
          };
        }

        const responseText = await response.text();
        console.log(`Response body: ${responseText}`);
        
        let data: ApiResponse;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          return { 
            content: [{ 
              type: 'text', 
              text: `Failed to parse API response: ${parseError}\nRaw response: ${responseText}` 
            }] 
          };
        }
        
        if (data.clients_found === 0) {
          return { 
            content: [{ 
              type: 'text', 
              text: `No users found with the provided contact information.${cleanPhone ? `\nPhone: ${cleanPhone}` : ''}${cleanEmail ? `\nEmail: ${cleanEmail}` : ''}\n\nAPI returned: ${JSON.stringify(data, null, 2)}` 
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
        console.error('Tool error:', error);
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred while searching for reports'}`
          }]
        };
      }
    }
  );

  // Add a new diagnostic tool to test the API directly
  server.tool(
    "test_api_directly",
    "Test the API directly to see what data is available",
    {
      endpoint: z.string().optional().default("user-reports-by-contact").describe("API endpoint to test"),
      params: z.string().optional().describe("Query parameters as a string (e.g., 'phone=123&email=test@example.com')")
    },
    async ({ endpoint = "user-reports-by-contact", params }: { endpoint?: string; params?: string }) => {
      try {
        const baseUrl = "https://dimt-api.onrender.com/api";
        const fullUrl = params ? `${baseUrl}/${endpoint}?${params}` : `${baseUrl}/${endpoint}`;
        
        console.log(`Testing API directly: ${fullUrl}`);
        
        const response = await fetch(fullUrl);
        const responseText = await response.text();
        
        return {
          content: [{
            type: 'text',
            text: `API Test Results:\nURL: ${fullUrl}\nStatus: ${response.status}\nHeaders: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}\nResponse: ${responseText}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `API Test Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );
}
