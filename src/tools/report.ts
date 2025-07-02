import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const API_BASE_URL = 'https://dimt-api.onrender.com';

// Zod schemas for API responses
const ReportSchema = z.object({
  uniqueid: z.number(),
  FileName: z.string(),
  UploadTime: z.string(),
  ClientName: z.string(),
  ReportPath: z.string(),
  ReportPdfPath: z.string().nullable(),
  ClientID: z.number(),
  FilePath: z.string(),
  Count: z.number(),
  adc: z.number(),
  radc: z.number(),
  ragc: z.number(),
  agc: z.number(),
  rc: z.number(),
});

const ApiResponseSchema = z.object({
  message: z.string(),
  data: z.array(ReportSchema),
  count: z.number(),
});

const SingleReportResponseSchema = z.object({
  message: z.string(),
  data: ReportSchema,
});

// API helper
async function apiCall<T>(endpoint: string, schema: z.ZodSchema<T>): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return schema.parse(data);
}

// Format date
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

// Format report for display
function formatReport(report: z.infer<typeof ReportSchema>): string {
  return [
    `**${report.ClientName}** (ID: ${report.ClientID})`,
    `📄 **Report:** ${report.ReportPath}`,
    `📋 **PDF:** ${report.ReportPdfPath || 'N/A'}`,
    `📅 **Date:** ${formatDate(report.UploadTime)}`,
    `🔢 **ID:** ${report.uniqueid}`
  ].join('\n');
}

export function registerReportTools(server: McpServer, env?: any): void {
  
  // Search reports by client ID
  server.tool("search_reports", {
    description: "Search for reports by client/user ID. Use this when someone asks to 'get report for user id X' or 'find reports for client X'. Returns a list of all reports belonging to that client/user with report details.",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { 
          type: "string", // Changed from "number" to "string"
          description: "The client/user ID to search reports for (e.g., when asked for 'user id 10000', use client_id: '10000')" 
        }
      },
      required: ["client_id"]
    }
  }, async (args: any) => {
    try {
      // Parse the string to number
      const clientId = parseInt(args.client_id);
      
      if (!clientId || isNaN(clientId)) {
        return { content: [{ type: 'text', text: `Error: Please provide a valid client ID (numeric value). Received: ${args.client_id}` }] };
      }

      const endpoint = `/api/report-path?client_id=${clientId}&limit=10`;
      
      const response = await apiCall(endpoint, ApiResponseSchema);
      
      if (response.count === 0) {
        return { content: [{ type: 'text', text: `No reports found for client ID: ${clientId}` }] };
      }

      const reports = response.data.map(formatReport).join('\n\n---\n\n');
      return {
        content: [{
          type: 'text',
          text: `Found ${response.count} report(s) for client ID "${clientId}":\n\n${reports}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error searching reports: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  });

  // Get specific report by unique ID
  server.tool("get_report", {
    description: "Get detailed information about a specific report using its unique report ID. Returns comprehensive report details including client info, file paths, upload time, and statistical data (ADC, RADC, RAGC, AGC, RC values).",
    inputSchema: {
      type: "object",
      properties: {
        id: { 
          type: "string", // Changed from "number" to "string"
          description: "The unique report ID (obtained from search_reports results)" 
        }
      },
      required: ["id"]
    }
  }, async (args: any) => {
    try {
      // Parse the string to number
      const id = parseInt(args.id);
      
      if (!id || isNaN(id)) {
        return { content: [{ type: 'text', text: `Error: Please provide a valid report ID (numeric value). Received: ${args.id}` }] };
      }

      const response = await apiCall(`/api/report-path/${id}`, SingleReportResponseSchema);
      const r = response.data;
      
      const details = [
        `**Report Details (ID: ${r.uniqueid})**`,
        `**Client:** ${r.ClientName} (ID: ${r.ClientID})`,
        `**File:** ${r.FileName}`,
        `**Report Path:** ${r.ReportPath}`,
        `**PDF Path:** ${r.ReportPdfPath || 'N/A'}`,
        `**File Path:** ${r.FilePath}`,
        `**Uploaded:** ${formatDate(r.UploadTime)}`,
        `**Count:** ${r.Count}`,
        `**Statistical Data:**`,
        `  - ADC: ${r.adc}`,
        `  - RADC: ${r.radc}`,
        `  - RAGC: ${r.ragc}`,
        `  - AGC: ${r.agc}`,
        `  - RC: ${r.rc}`
      ].join('\n');

      return { content: [{ type: 'text', text: details }] };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error retrieving report: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  });
}
