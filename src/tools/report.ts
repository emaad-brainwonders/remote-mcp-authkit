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
    description: "Get report path for a specific client ID. Use this tool when a user asks for reports, report paths, or report details for a specific client ID or user ID. The client_id parameter is required.",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { 
          type: "string",
          description: "The client ID number as a string. Examples: '10000', '1001', '5555', '50001'. This parameter is REQUIRED." 
        }
      },
      required: ["client_id"],
      additionalProperties: false
    }
  }, async (args: any) => {
    console.log("=== get_report_path TOOL CALLED ===");
    console.log("Raw args received:", JSON.stringify(args, null, 2));
    console.log("Args type:", typeof args);
    console.log("Args keys:", Object.keys(args || {}));
    
    try {
      // Validate that we have the required parameter
      if (!args || typeof args !== 'object') {
        console.log("ERROR: Invalid args - not an object");
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: Invalid arguments provided. Expected an object with client_id property.` 
          }] 
        };
      }

      if (!args.client_id) {
        console.log("ERROR: Missing client_id parameter");
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: Missing required parameter 'client_id'. Please provide a client ID (e.g., "10000", "1001", "5555").` 
          }] 
        };
      }

      const clientIdStr = String(args.client_id).trim();
      const clientId = parseInt(clientIdStr);
      
      console.log(`Client ID string: "${clientIdStr}"`);
      console.log(`Parsed client ID: ${clientId}`);
      
      if (!clientId || isNaN(clientId) || clientId <= 0) {
        console.log(`ERROR: Invalid client ID "${clientIdStr}"`);
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: Invalid client ID "${clientIdStr}". Please provide a valid numeric client ID (e.g., "10000", "1001", "5555").` 
          }] 
        };
      }

      console.log(`Making API request for client ID: ${clientId}`);
      const apiUrl = `${API_BASE_URL}/api/report-path?client_id=${clientId}`;
      console.log(`API URL: ${apiUrl}`);

      const response = await fetch(apiUrl);
      console.log(`API Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`API Error response: ${errorText}`);
        return { 
          content: [{ 
            type: 'text', 
            text: `API Error: ${response.status} - ${response.statusText}. The API may be unavailable or the client ID may not exist.` 
          }] 
        };
      }

      const rawData = await response.json();
      console.log("Raw API Response:", JSON.stringify(rawData, null, 2));
      
      // Validate the response data using Zod schema
      const parseResult = ApiResponseSchema.safeParse(rawData);
      
      if (!parseResult.success) {
        console.log("Schema validation failed:", parseResult.error.errors);
        console.log("Raw data that failed validation:", rawData);
        
        // Try to provide a helpful response even if schema validation fails
        if (rawData && typeof rawData === 'object' && 'count' in rawData && rawData.count === 0) {
          return { 
            content: [{ 
              type: 'text', 
              text: `No reports found for client ID: ${clientId}` 
            }] 
          };
        }
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: Unexpected API response format. Raw response: ${JSON.stringify(rawData)}` 
          }] 
        };
      }

      const data = parseResult.data;
      console.log(`Validated data - count: ${data.count}, reports: ${data.data.length}`);
      
      if (data.count === 0) {
        return { 
          content: [{ 
            type: 'text', 
            text: `No reports found for client ID: ${clientId}` 
          }] 
        };
      }

      const pathInfo = data.data.map((report, index) => 
        `Report ${index + 1}:\n  Client: ${report.ClientName} (ID: ${report.ClientID})\n  Report Path: ${report.ReportPath}\n  Unique ID: ${report.uniqueid}`
      ).join('\n\n');

      const result = `Found ${data.count} report(s) for client ID ${clientId}:\n\n${pathInfo}`;
      console.log("Success - returning result:", result);

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };

    } catch (error) {
      console.error("=== TOOL EXECUTION ERROR ===");
      console.error("Error type:", error?.constructor?.name);
      console.error("Error message:", error instanceof Error ? error.message : String(error));
      console.error("Error stack:", error instanceof Error ? error.stack : 'No stack trace');
      
      return {
        content: [{
          type: 'text',
          text: `Error executing get_report_path: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  });

  // Log that the tool was registered
  console.log("=== REPORT TOOL REGISTERED ===");
  console.log("Tool name: get_report_path");
  console.log("Tool description: Get report path for a specific client ID");
  console.log("Required parameters: client_id (string)");
}
