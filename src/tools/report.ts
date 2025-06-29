import mysql from 'mysql2/promise';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'ls-88ff1aa05e7d04e62a925bf4fd2b33f1b050d027.cifqbroovvmr.ap-south-1.rds.amazonaws.com',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'dbadmin',
  password: process.env.DB_PASS || 'mFyW^(5mVR9SAxzcN((^e1MykGd#$_js',
  database: 'tmuat'
};

// Database connection helper
async function getConnection() {
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    return connection;
  } catch (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }
}

// Main function to register the report tools
export function registerReportTools(server: McpServer, env?: any) {
  
  // Register the tool in the list tools handler
  const existingListHandler = server.getRequestHandler(ListToolsRequestSchema);
  
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    // Get existing tools if handler exists
    let existingTools = [];
    if (existingListHandler) {
      const existingResult = await existingListHandler(request);
      existingTools = existingResult.tools || [];
    }

    // Add our report tool
    return {
      tools: [
        ...existingTools,
        {
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
        }
      ]
    };
  });

  // Register the tool call handler
  const existingCallHandler = server.getRequestHandler(CallToolRequestSchema);
  
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Handle our report tool
    if (name === 'get_report_path') {
      return await handleGetReport(args);
    }

    // Delegate to existing handler for other tools
    if (existingCallHandler) {
      return await existingCallHandler(request);
    }

    throw new Error(`Unknown tool: ${name}`);
  });
}

// Tool handler function
async function handleGetReport(args: { client_identifier: string }) {
  const connection = await getConnection();
  
  try {
    // Search by both ClientName and ClientID
    const query = `
      SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
      FROM zipfile 
      WHERE ClientName LIKE ? OR ClientID = ?
      ORDER BY UploadTime DESC
    `;
    
    const searchTerm = `%${args.client_identifier}%`;
    const clientId = isNaN(Number(args.client_identifier)) ? -1 : parseInt(args.client_identifier);
    
    const [rows] = await connection.execute(query, [searchTerm, clientId]);
    
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No reports found for client: ${args.client_identifier}`
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
        text: `Found ${results.length} report(s):\n\n` +
              results.map(r => 
                `Client: ${r.clientName} (ID: ${r.clientId})\n` +
                `Report Path: ${r.reportPath}\n` +
                `PDF Path: ${r.reportPdfPath || 'N/A'}\n` +
                `Upload Time: ${r.uploadTime}\n`
              ).join('\n---\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error fetching report: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    };
  } finally {
    await connection.end();
  }
}
