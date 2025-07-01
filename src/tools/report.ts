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
  
  // Search reports
  server.tool("search_reports", {
    description: "Search for client reports by client ID",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "number", description: "Client ID" }
      },
      required: ["client_id"]
    }
  }, async (args: any) => {
    try {
      const clientId = typeof args.client_id === 'string' ? parseInt(args.client_id) : args.client_id;
      
      if (!clientId || isNaN(clientId)) {
        return { content: [{ type: 'text', text: 'Error: Please provide a valid client ID' }] };
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
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });

  // Get report by ID
  server.tool("get_report", {
    description: "Get specific report by unique ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Unique report ID" }
      },
      required: ["id"]
    }
  }, async (args: any) => {
    try {
      const id = typeof args.id === 'string' ? parseInt(args.id) : args.id;
      
      if (!id || isNaN(id)) {
        return { content: [{ type: 'text', text: 'Error: Please provide a valid report ID' }] };
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
        `**Stats:** ADC: ${r.adc}, RADC: ${r.radc}, RAGC: ${r.ragc}, AGC: ${r.agc}, RC: ${r.rc}`
      ].join('\n');

      return { content: [{ type: 'text', text: details }] };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });
}
