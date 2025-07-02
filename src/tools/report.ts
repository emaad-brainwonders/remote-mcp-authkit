import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const API_BASE_URL = 'https://dimt-api.onrender.com';

// Simple schema for report path response
const ReportPathSchema = z.object({
  uniqueid: z.number(),
  ReportPath: z.string(),
  ClientName: z.string(),
  ClientID: z.number(),
});

const ApiResponseSchema = z.object({
  message: z.string(),
  data: z.array(ReportPathSchema),
  count: z.number(),
});

import { z } from 'zod';

export function registerReportTools(server: any) {
  server.tool(
    "get_report_path",
    "Get report path for a client ID. Call this when user asks for reports for a specific client ID or user ID.",
    {
      client_id: z.string().describe("The client ID number as a string (e.g., '10000', '1001', '5555')")
    },
    async ({ client_id }) => {
      try {
        const clientId = parseInt(client_id);
        
        if (!clientId || isNaN(clientId)) {
          return { 
            content: [{ 
              type: 'text', 
              text: `Error: Invalid client ID "${client_id}". Please provide a numeric value.` 
            }] 
          };
        }

        console.log(`Fetching reports for client ID: ${clientId}`);

        const response = await fetch(`https://dimt-api.onrender.com/api/report-path?client_id=${clientId}`);
        
        if (!response.ok) {
          return { 
            content: [{ 
              type: 'text', 
              text: `API Error: ${response.status} - ${response.statusText}` 
            }] 
          };
        }

        const data = await response.json();
        
        if (data.count === 0) {
          return { 
            content: [{ 
              type: 'text', 
              text: `No reports found for client ID: ${clientId}` 
            }] 
          };
        }

        const pathInfo = data.data.map((report: any) => 
          `Client: ${report.ClientName} (ID: ${report.ClientID})\nReport Path: ${report.ReportPath}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Found ${data.count} report(s) for client ID ${clientId}:\n\n${pathInfo}`
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }]
        };
      }
    }
  );
}
