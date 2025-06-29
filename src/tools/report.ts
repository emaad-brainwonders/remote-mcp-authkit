import mysql from 'mysql2/promise';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Database configuration
const DB_CONFIG = {
  host: 'ls-88ff1aa05e7d04e62a925bf4fd2b33f1b050d027.cifqbroovvmr.ap-south-1.rds.amazonaws.com',
  port: 3306,
  user: 'dbadmin',
  password: 'mFyW^(5mVR9SAxzcN((^e1MykGd#$_js',
  database: 'tmuat'
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

// Tool handler function - Updated to match MCP SDK signature
async function handleGetReport(
  args: { [key: string]: any }, 
  extra: any
): Promise<{
  content: Array<{
    type: 'text';
    text: string;
  }>;
}> {
  let connection: any = null;
  
  try {
    // Debug: Log the received args
    console.log('Received args:', JSON.stringify(args));
    
    // Extract client_identifier from args with fallback options
    const clientIdentifier = args.client_identifier || args.client_name || args.client_id;
    
    console.log('Extracted clientIdentifier:', clientIdentifier);
    
    if (!clientIdentifier) {
      return {
        content: [{
          type: 'text',
          text: `Error: client_identifier parameter is required. Received args: ${JSON.stringify(args)}`
        }]
      };
    }
    
    connection = await getConnection();
    
    // Search by both ClientName and ClientID
    const query = `
      SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
      FROM zipfile 
      WHERE ClientName LIKE ? OR ClientID = ?
      ORDER BY UploadTime DESC
    `;
    
    const searchTerm = `%${clientIdentifier}%`;
    const clientId = isNaN(Number(clientIdentifier)) ? -1 : parseInt(clientIdentifier);
    
    console.log('Executing query with:', { searchTerm, clientId });
    
    // Use execute method (should work with mysql2/promise)
    const [rows] = await connection.execute(query, [searchTerm, clientId]);
    const typedRows = rows as DatabaseRow[];
    
    if (!Array.isArray(typedRows) || typedRows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No reports found for client: ${clientIdentifier}`
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
      `Client: ${r.clientName} (ID: ${r.clientId})\n` +
      `File Name: ${r.fileName}\n` +
      `Report Path: ${r.reportPath}\n` +
      `PDF Path: ${r.reportPdfPath || 'N/A'}\n` +
      `Upload Time: ${r.uploadTime.toISOString()}\n`
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

// Export function to register the report tools
export function registerReportTools(server: McpServer, env?: any): void {
  // Alternative registration approach - try this if the previous doesn't work
  server.tool(
    'get_report_path',
    {
      client_identifier: {
        type: 'string',
        description: 'Client name or client ID to search for'
      }
    },
    handleGetReport
  );
}
