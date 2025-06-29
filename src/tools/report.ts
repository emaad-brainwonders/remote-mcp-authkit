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
// Database connection helper
async function getConnection() {
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    return connection;
  } catch (error) {
    throw new Error(Database connection failed: ${(error as Error).message});
  }
}
// Tool handler function
async function handleGetReport(args: { client_identifier: string }) {
  const connection = await getConnection();

  try {
    // Search by both ClientName and ClientID
    const query = 
      SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
      FROM zipfile 
      WHERE ClientName LIKE ? OR ClientID = ?
      ORDER BY UploadTime DESC
    ;

    const searchTerm = %${args.client_identifier}%;
    const clientId = isNaN(Number(args.client_identifier)) ? -1 : parseInt(args.client_identifier);

    const [rows] = await connection.execute(query, [searchTerm, clientId]) as any[];

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: No reports found for client: ${args.client_identifier}
        }]
      };
    }
    const results = rows.map((row: any) => ({
      id: row.uniqueid,
      fileName: row.FileName,
      clientName: row.ClientName,
      clientId: row.ClientID,
      reportPath: row.ReportPath,
      reportPdfPath: row.ReportPdfPath,
      uploadTime: row.UploadTime
    }));
    return {
      content: [{
        type: 'text',
        text: Found ${results.length} report(s):\n\n +
              results.map(r => 
                Client: ${r.clientName} (ID: ${r.clientId})\n +
                Report Path: ${r.reportPath}\n +
                PDF Path: ${r.reportPdfPath || 'N/A'}\n +
                Upload Time: ${r.uploadTime}\n
              ).join('\n---\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: Error fetching report: ${error instanceof Error ? error.message : 'Unknown error'}
      }]
    };
  } finally {
    await connection.end();
  }
}
// Export function to register the report tools (following your existing pattern)
export function registerReportTools(server: McpServer, env?: any) {
  // Add the tool definition
  server.addTool({
    name: 'get_report_path',
    description: 'Get report path from database by client name or client ID',
    inputSchema: {
      type: 'object',
      properties: {
        client_identifier: {
          type: 'string',
          description: 'Client name or client ID to search for'
        }
      },
      required: ['client_identifier']
    }
  }, handleGetReport);
}
