import mysql from 'mysql2/promise';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Database configuration
const DB_CONFIG = {
  host: 'ls-88ff1aa05e7d04e62a925bf4fd2b33f1b050d027.cifqbroovvmr.ap-south-1.rds.amazonaws.com',
  port: 3306,
  user: 'dbadmin',
  password: 'mFyW^(5mVR9SAxzcN((^e1MykGd#$_js',
  database: 'franchises'
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

// Export function to register the report tools
export function registerReportTools(server: McpServer, env?: any): void {
  server.tool(
    "get_report_path",
    {
      description: "Get report path for a client by name or ID. Use this when user asks for report, report path, or client information.",
      inputSchema: {
        type: "object",
        properties: {
          client_identifier: {
            type: "string",
            description: "Client name or client ID to search for (primary parameter)"
          },
          client_id: {
            type: "string", 
            description: "Client ID to search for (alternative parameter)"
          },
          client_name: {
            type: "string",
            description: "Client name to search for (alternative parameter)"
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
        additionalProperties: false
      }
    },
    async (args) => {
      let connection: any = null;
      
      try {
        // Extract identifier from multiple possible parameter names
        const client_identifier = args.client_identifier || 
                                args.client_id || 
                                args.client_name || 
                                args.id || 
                                args.name;
        
        // Debug: Log the received parameters
        console.log('Received args:', JSON.stringify(args, null, 2));
        console.log('Extracted client_identifier:', client_identifier);
        
        if (!client_identifier) {
          return {
            content: [{
              type: 'text',
              text: `Error: No valid client identifier found. Please provide client_identifier, client_id, client_name, id, or name parameter. Received: ${JSON.stringify(args, null, 2)}`
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
          `**Main Report:** ${r.reportPath}\n` +
          `**PDF Report:** ${r.reportPdfPath || 'N/A'}\n` +
          `**File Name:** ${r.fileName}\n` +
          `**Upload Time:** ${r.uploadTime.toISOString()}\n`
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

  // Add a second tool with more flexible parameter handling
  server.tool(
    "search_client_reports",
    {
      description: "Search for client reports using flexible parameter names. Handles various parameter formats.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query - can be client name, ID, or any identifier"
          }
        },
        required: ["query"],
        additionalProperties: true
      }
    },
    async (args) => {
      let connection: any = null;
      
      try {
        console.log('search_client_reports received args:', JSON.stringify(args, null, 2));
        
        const searchQuery = args.query;
        
        if (!searchQuery) {
          return {
            content: [{
              type: 'text',
              text: `Error: query parameter is required. Received: ${JSON.stringify(args, null, 2)}`
            }]
          };
        }
        
        connection = await getConnection();
        
        const query = `
          SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
          FROM zipfile 
          WHERE (ClientName LIKE ? OR ClientID = ?) AND ReportPath != ''
          ORDER BY UploadTime DESC
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
          `**Client:** ${r.clientName} (ID: ${r.clientId})\n` +
          `**Report Path:** ${r.reportPath}\n` +
          `**PDF Path:** ${r.reportPdfPath || 'N/A'}\n` +
          `**File:** ${r.fileName}\n` +
          `**Uploaded:** ${r.uploadTime.toISOString()}\n`
        ).join('\n---\n');
        
        return {
          content: [{
            type: 'text',
            text: `Found ${results.length} report(s):\n\n${reportText}`
          }]
        };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Database error:', error);
        return {
          content: [{
            type: 'text',
            text: `Error: ${errorMessage}`
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
