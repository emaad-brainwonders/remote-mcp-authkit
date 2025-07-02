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

export function registerReportTools(server: McpServer): void {
  
  server.tool("get_report_path", {
    description: "Get report path for a client ID. Simply provide the client ID and get back the report path(s).",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { 
          type: "string",
          description: "The client ID to get report path for (e.g., '10000')" 
        }
      },
      required: ["client_id"]
    }
  }, async (args: any) => {
    try {
      const clientId = parseInt(args.client_id);
      
      if (!clientId || isNaN(clientId)) {
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: Invalid client ID. Please provide a numeric value. Got: ${args.client_id}` 
          }] 
        };
      }

      // Call the API
      const response = await fetch(`${API_BASE_URL}/api/report-path?client_id=${clientId}`);
      
      if (!response.ok) {
        return { 
          content: [{ 
            type: 'text', 
            text: `API Error: ${response.status} - ${response.statusText}` 
          }] 
        };
      }

      const data = await response.json();
      const parsedData = ApiResponseSchema.parse(data);
      
      if (parsedData.count === 0) {
        return { 
          content: [{ 
            type: 'text', 
            text: `No reports found for client ID: ${clientId}` 
          }] 
        };
      }

      // Format the response - just show the essential path info
      const pathInfo = parsedData.data.map(report => 
        `Client: ${report.ClientName} (ID: ${report.ClientID})\nReport Path: ${report.ReportPath}`
      ).join('\n\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${parsedData.count} report(s) for client ID ${clientId}:\n\n${pathInfo}`
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
  });
}
