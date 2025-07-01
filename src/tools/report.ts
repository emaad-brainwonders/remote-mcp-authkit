import mysql from 'mysql2/promise';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Database configuration
const DB_CONFIG = {
  host: '',
  port: 1,
  user: '',
  password: '',
  database: ''
};

// Type definitions
interface DatabaseRow {
  uniqueid: number;
  FileName: string;
  ClientName: string;
  ClientID: number;
  ReportPath: string;
  ReportPdfPath: string | null;
  UploadTime: Date;
}

interface ReportResult {
  id: number;
  fileName: string;
  clientName: string;
  clientId: number;
  reportPath: string;
  reportPdfPath: string | null;
  uploadTime: Date;
}

// Database connection helper
async function getConnection() {
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    return connection;
  } catch (error) {
    throw new Error(`Database connection failed: ${(error as Error).message}`);
  }
}

// Extract client identifier from various parameter formats
function extractClientIdentifier(args: any): string | null {
  if (!args || typeof args !== 'object') {
    return null;
  }

  // Method 1: Direct parameter access
  const directParams = [
    args.client_identifier,
    args.client_id,
    args.client_name,
    args.id,
    args.name,
    args.query
  ];

  for (const param of directParams) {
    if (param && typeof param === 'string') {
      return param;
    }
  }

  // Method 2: Check for nested parameters object
  const nestedObjects = [
    args.parameters,
    args.arguments,
    args.params,
    args.input,
    args.data
  ];

  for (const nested of nestedObjects) {
    if (nested && typeof nested === 'object') {
      const nestedResult = extractClientIdentifier(nested);
      if (nestedResult) {
        return nestedResult;
      }
    }
  }

  // Method 3: Deep search for client identifiers
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      // Check if key suggests it's a client identifier
      const keyLower = key.toLowerCase();
      if (keyLower.includes('client') || keyLower.includes('name') || keyLower.includes('id')) {
        return value;
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const deepResult = extractClientIdentifier(value);
      if (deepResult) {
        return deepResult;
      }
    }
  }

  return null;
}

// Export function to register the report tools
export function registerReportTools(server: McpServer, env?: any): void {
  
  // Debug tool to inspect raw parameters
  server.tool(
    "debug_report_params",
    {
      description: "Debug tool to inspect what parameters are being received by report tools",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true
      }
    },
    async (...args: any[]) => {
      console.log('=== DEBUG REPORT PARAMS ===');
      console.log('Number of arguments:', args.length);
      console.log('All arguments:', JSON.stringify(args, null, 2));
      
      for (let i = 0; i < args.length; i++) {
        console.log(`Argument ${i}:`, typeof args[i], JSON.stringify(args[i], null, 2));
      }
      
      // Try to extract client identifier from all arguments
      let extractedId = null;
      for (const arg of args) {
        const id = extractClientIdentifier(arg);
        if (id) {
          extractedId = id;
          break;
        }
      }
      
      console.log('Extracted client identifier:', extractedId);
      console.log('===============================');
      
      return {
        content: [{
          type: 'text',
          text: `Debug Info:\n\nArguments received: ${args.length}\n\nArg 0: ${JSON.stringify(args[0], null, 2)}\n\nArg 1: ${JSON.stringify(args[1], null, 2)}\n\nExtracted ID: ${extractedId}`
        }]
      };
    }
  );

  server.tool(
    "get_report_path",
    {
      description: "Get report path for a client by name or ID. Use this when user asks for report, report path, or client information.",
      inputSchema: {
        type: "object",
        properties: {
          client_identifier: {
            type: "string",
            description: "Client name or client ID to search for"
          },
          client_id: {
            type: "string", 
            description: "Client ID to search for"
          },
          client_name: {
            type: "string",
            description: "Client name to search for"
          },
          id: {
            type: "string",
            description: "Client ID (alternative parameter name)"
          },
          name: {
            type: "string", 
            description: "Client name (alternative parameter name)"
          }
        },
        additionalProperties: true
      }
    },
    async (...args: any[]) => {
      let connection: any = null;
      
      try {
        console.log('=== GET_REPORT_PATH CALL ===');
        console.log('Number of arguments:', args.length);
        console.log('All arguments:', JSON.stringify(args, null, 2));
        
        // Try to extract client identifier from all arguments
        let client_identifier = null;
        
        for (const arg of args) {
          client_identifier = extractClientIdentifier(arg);
          if (client_identifier) {
            console.log('Found client_identifier in arg:', JSON.stringify(arg, null, 2));
            break;
          }
        }
        
        console.log('Final extracted client_identifier:', client_identifier);
        console.log('==============================');
        
        if (!client_identifier) {
          const debugInfo = args.map((arg, index) => `Arg ${index}: ${JSON.stringify(arg)}`).join('\n');
          return {
            content: [{
              type: 'text',
              text: `Error: No valid client identifier found.\n\nDEBUG INFO:\n${debugInfo}\n\nPlease provide client ID or name as a parameter.`
            }]
          };
        }
        
        connection = await getConnection();
        
        // Search by both ClientName and ClientID, prioritize records with report paths
        const query = `
          SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
          FROM zipfile 
          WHERE (ClientName LIKE ? OR ClientID = ?) AND ReportPath != ''
          ORDER BY UploadTime DESC
        `;
        
        const searchTerm = `%${client_identifier}%`;
        const clientId = isNaN(Number(client_identifier)) ? -1 : parseInt(client_identifier);
        
        console.log('Executing query with:', { searchTerm, clientId });
        
        const [rows] = await connection.execute(query, [searchTerm, clientId]);
        const typedRows = rows as DatabaseRow[];
        
        if (!Array.isArray(typedRows) || typedRows.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No reports found for client: ${client_identifier}. Please check if the client name or ID is correct.`
            }]
          };
        }
        
        const results: ReportResult[] = typedRows.map((row: DatabaseRow) => ({
          id: row.uniqueid,
          fileName: row.FileName,
          clientName: row.ClientName,
          clientId: row.ClientID,
          reportPath: row.ReportPath,
          reportPdfPath: row.ReportPdfPath,
          uploadTime: row.UploadTime
        }));
        
        const reportText = results.map(r => 
          `**Client:** ${r.clientName} (ID: ${r.clientId})\n` +
          `**Report Path:** ${r.reportPath}\n` +
          `**PDF Path:** ${r.reportPdfPath || 'N/A'}\n` +
          `**File:** ${r.fileName}\n` +
          `**Uploaded:** ${r.uploadTime.toISOString()}\n`
        ).join('\n---\n');
        
        return {
          content: [{
            type: 'text',
            text: `Found ${results.length} report(s) for client "${client_identifier}":\n\n${reportText}`
          }]
        };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Database error:', error);
        return {
          content: [{
            type: 'text',
            text: `Error fetching report: ${errorMessage}`
          }]
        };
      } finally {
        if (connection) {
          try {
            await connection.end();
          } catch (endError) {
            console.error('Error closing database connection:', endError);
          }
        }
      }
    }
  );

  // Alternative tool with simpler parameter handling
  server.tool(
    "search_client_reports",
    {
      description: "Search for client reports by name or ID",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Client name or ID to search for"
          }
        },
        required: ["query"]
      }
    },
    async (...args: any[]) => {
      let connection: any = null;
      
      try {
        console.log('=== SEARCH_CLIENT_REPORTS CALL ===');
        console.log('Arguments:', JSON.stringify(args, null, 2));
        
        let searchQuery = null;
        
        // Extract query from arguments
        for (const arg of args) {
          if (arg && typeof arg === 'object') {
            searchQuery = arg.query || extractClientIdentifier(arg);
            if (searchQuery) break;
          } else if (typeof arg === 'string') {
            searchQuery = arg;
            break;
          }
        }
        
        console.log('Extracted search query:', searchQuery);
        console.log('==================================');
        
        if (!searchQuery) {
          return {
            content: [{
              type: 'text',
              text: `Error: No search query found in arguments: ${JSON.stringify(args, null, 2)}`
            }]
          };
        }
        
        connection = await getConnection();
        
        const query = `
          SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
          FROM zipfile 
          WHERE (ClientName LIKE ? OR ClientID = ?) AND ReportPath != ''
          ORDER BY UploadTime DESC
          LIMIT 10
        `;
        
        const searchTerm = `%${searchQuery}%`;
        const clientId = isNaN(Number(searchQuery)) ? -1 : parseInt(searchQuery);
        
        const [rows] = await connection.execute(query, [searchTerm, clientId]);
        const typedRows = rows as DatabaseRow[];
        
        if (!Array.isArray(typedRows) || typedRows.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No reports found for: ${searchQuery}`
            }]
          };
        }
        
        const results: ReportResult[] = typedRows.map((row: DatabaseRow) => ({
          id: row.uniqueid,
          fileName: row.FileName,
          clientName: row.ClientName,
          clientId: row.ClientID,
          reportPath: row.ReportPath,
          reportPdfPath: row.ReportPdfPath,
          uploadTime: row.UploadTime
        }));
        
        const reportText = results.map(r => 
          `**${r.clientName}** (ID: ${r.clientId})\n` +
          `📄 **Report:** ${r.reportPath}\n` +
          `📋 **PDF:** ${r.reportPdfPath || 'N/A'}\n` +
          `📅 **Date:** ${r.uploadTime.toLocaleDateString()}\n`
        ).join('\n---\n');
        
        return {
          content: [{
            type: 'text',
            text: `🔍 Found ${results.length} report(s) for "${searchQuery}":\n\n${reportText}`
          }]
        };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Database error:', error);
        return {
          content: [{
            type: 'text',
            text: `❌ Error: ${errorMessage}`
          }]
        };
      } finally {
        if (connection) {
          try {
            await connection.end();
          } catch (endError) {
            console.error('Error closing connection:', endError);
          }
        }
      }
    }
  );
}
