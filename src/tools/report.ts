import mysql from 'mysql2/promise';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Database configuration with connection pooling
const DB_CONFIG = {
  host: 'ls-88ff1aa05e7d04e62a925bf4fd2b33f1b050d027.cifqbroovvmr.ap-south-1.rds.amazonaws.com',
  port: 3306,
  user: 'dbadmin',
  password: 'mFyW^(5mVR9SAxzcN((^e1MykGd#$_js',
  database: 'franchises',
  connectionLimit: 10,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
};

// Enhanced type definitions
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

interface SearchOptions {
  limit?: number;
  includeEmpty?: boolean;
  sortBy?: 'date' | 'name' | 'id';
  sortOrder?: 'asc' | 'desc';
}

// Connection pool for better performance
let connectionPool: mysql.Pool | null = null;

function getConnectionPool(): mysql.Pool {
  if (!connectionPool) {
    connectionPool = mysql.createPool(DB_CONFIG);
  }
  return connectionPool;
}

// Enhanced client identifier extraction with validation
function extractClientIdentifier(args: any): string | null {
  if (!args || typeof args !== 'object') {
    return null;
  }

  // Priority-based parameter extraction
  const parameterPriority = [
    'client_identifier',
    'query', 
    'client_id',
    'client_name',
    'id',
    'name',
    'search',
    'term'
  ];

  // Direct parameter access
  for (const param of parameterPriority) {
    if (args[param] && typeof args[param] === 'string' && args[param].trim()) {
      return args[param].trim();
    }
  }

  // Nested object search
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

  // Deep search with pattern matching
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.trim()) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes('client') || 
          keyLower.includes('name') || 
          keyLower.includes('id') ||
          keyLower.includes('search') ||
          keyLower.includes('query')) {
        return value.trim();
      }
    }
  }

  return null;
}

// Sanitize and validate input
function sanitizeInput(input: string): string {
  return input.replace(/[^\w\s.-]/g, '').trim();
}

// Build dynamic query based on search options
function buildSearchQuery(options: SearchOptions = {}): string {
  const { limit = 10, includeEmpty = false, sortBy = 'date', sortOrder = 'desc' } = options;
  
  let query = `
    SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
    FROM zipfile 
    WHERE (ClientName LIKE ? OR ClientID = ? OR FileName LIKE ?)
  `;
  
  if (!includeEmpty) {
    query += ` AND ReportPath != '' AND ReportPath IS NOT NULL`;
  }
  
  // Add sorting
  switch (sortBy) {
    case 'name':
      query += ` ORDER BY ClientName ${sortOrder.toUpperCase()}`;
      break;
    case 'id':
      query += ` ORDER BY ClientID ${sortOrder.toUpperCase()}`;
      break;
    default:
      query += ` ORDER BY UploadTime ${sortOrder.toUpperCase()}`;
  }
  
  query += ` LIMIT ${Math.min(Math.max(1, limit), 50)}`; // Limit between 1-50
  
  return query;
}

// Format results for display
function formatResults(results: ReportResult[], searchTerm: string): string {
  if (results.length === 0) {
    return `❌ No reports found for "${searchTerm}". Please verify the client name or ID.`;
  }

  const header = `🔍 Found ${results.length} report(s) for "${searchTerm}":`;
  
  const reportList = results.map((r, index) => 
    `**${index + 1}. ${r.clientName}** (ID: ${r.clientId})\n` +
    `   📄 **Report:** \`${r.reportPath}\`\n` +
    `   📋 **PDF:** ${r.reportPdfPath ? `\`${r.reportPdfPath}\`` : 'Not available'}\n` +
    `   📁 **File:** ${r.fileName}\n` +
    `   📅 **Uploaded:** ${r.uploadTime.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`
  ).join('\n\n');
  
  return `${header}\n\n${reportList}`;
}

// Export function to register the report tools
export function registerReportTools(server: McpServer, env?: any): void {
  
  // Enhanced search tool with advanced options
  server.tool(
    "search_client_reports",
    {
      description: "Search for client reports by name, ID, or filename with advanced filtering options",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Client name, ID, or filename to search for"
          },
          limit: {
            type: "number",
            description: "Maximum number of results (1-50, default: 10)",
            minimum: 1,
            maximum: 50,
            default: 10
          },
          include_empty: {
            type: "boolean",
            description: "Include records with empty report paths (default: false)",
            default: false
          },
          sort_by: {
            type: "string",
            enum: ["date", "name", "id"],
            description: "Sort results by date, client name, or client ID (default: date)",
            default: "date"
          },
          sort_order: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort order: ascending or descending (default: desc)",
            default: "desc"
          }
        },
        required: ["query"]
      }
    },
    async (...args: any[]) => {
      const pool = getConnectionPool();
      
      try {
        // Extract parameters
        const params = args[0] || {};
        const searchQuery = extractClientIdentifier(params);
        
        if (!searchQuery) {
          return {
            content: [{
              type: 'text',
              text: `❌ Error: No search query provided. Please specify a client name, ID, or filename.\n\nReceived: ${JSON.stringify(args[0], null, 2)}`
            }]
          };
        }

        // Validate and sanitize input
        const sanitizedQuery = sanitizeInput(searchQuery);
        if (!sanitizedQuery) {
          return {
            content: [{
              type: 'text',
              text: `❌ Error: Invalid search query. Please provide a valid client name, ID, or filename.`
            }]
          };
        }

        // Extract search options
        const options: SearchOptions = {
          limit: params.limit || 10,
          includeEmpty: params.include_empty || false,
          sortBy: params.sort_by || 'date',
          sortOrder: params.sort_order || 'desc'
        };

        const query = buildSearchQuery(options);
        const searchTerm = `%${sanitizedQuery}%`;
        const clientId = isNaN(Number(sanitizedQuery)) ? -1 : parseInt(sanitizedQuery);
        
        console.log(`Searching for: "${sanitizedQuery}" with options:`, options);
        
        const [rows] = await pool.execute(query, [searchTerm, clientId, searchTerm]);
        const typedRows = rows as DatabaseRow[];
        
        const results: ReportResult[] = typedRows.map((row: DatabaseRow) => ({
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
            text: formatResults(results, sanitizedQuery)
          }]
        };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown database error';
        console.error('Database error in search_client_reports:', error);
        
        return {
          content: [{
            type: 'text',
            text: `❌ Database Error: ${errorMessage}\n\nPlease try again or contact support if the issue persists.`
          }]
        };
      }
    }
  );

  // Quick search tool for simple queries
  server.tool(
    "quick_report_search",
    {
      description: "Quick search for client reports (simplified version)",
      inputSchema: {
        type: "object",
        properties: {
          client: {
            type: "string",
            description: "Client name or ID"
          }
        },
        required: ["client"]
      }
    },
    async (...args: any[]) => {
      const pool = getConnectionPool();
      
      try {
        const params = args[0] || {};
        const searchQuery = params.client || extractClientIdentifier(params);
        
        if (!searchQuery) {
          return {
            content: [{
              type: 'text',
              text: `❌ Please provide a client name or ID to search for.`
            }]
          };
        }

        const sanitizedQuery = sanitizeInput(searchQuery);
        const query = `
          SELECT uniqueid, FileName, ClientName, ClientID, ReportPath, ReportPdfPath, UploadTime
          FROM zipfile 
          WHERE (ClientName LIKE ? OR ClientID = ?) 
            AND ReportPath != '' 
            AND ReportPath IS NOT NULL
          ORDER BY UploadTime DESC
          LIMIT 5
        `;
        
        const searchTerm = `%${sanitizedQuery}%`;
        const clientId = isNaN(Number(sanitizedQuery)) ? -1 : parseInt(sanitizedQuery);
        
        const [rows] = await pool.execute(query, [searchTerm, clientId]);
        const typedRows = rows as DatabaseRow[];
        
        if (typedRows.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `❌ No reports found for "${sanitizedQuery}"`
            }]
          };
        }

        const result = typedRows[0];
        return {
          content: [{
            type: 'text',
            text: `✅ **${result.ClientName}** (ID: ${result.ClientID})\n` +
                  `📄 **Report:** \`${result.ReportPath}\`\n` +
                  `📋 **PDF:** ${result.ReportPdfPath || 'Not available'}\n` +
                  `📅 **Date:** ${result.UploadTime.toLocaleDateString()}\n\n` +
                  `${typedRows.length > 1 ? `_Found ${typedRows.length} total results. Use search_client_reports for more._` : ''}`
          }]
        };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Quick search error:', error);
        
        return {
          content: [{
            type: 'text',
            text: `❌ Error: ${errorMessage}`
          }]
        };
      }
    }
  );

  // Health check tool
  server.tool(
    "database_health_check",
    {
      description: "Check database connection and basic statistics",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    async () => {
      const pool = getConnectionPool();
      
      try {
        const [rows] = await pool.execute(`
          SELECT 
            COUNT(*) as total_records,
            COUNT(CASE WHEN ReportPath != '' AND ReportPath IS NOT NULL THEN 1 END) as records_with_reports,
            COUNT(DISTINCT ClientID) as unique_clients,
            MAX(UploadTime) as latest_upload
          FROM zipfile
        `);
        
        const stats = (rows as any[])[0];
        
        return {
          content: [{
            type: 'text',
            text: `✅ **Database Connection: Healthy**\n\n` +
                  `📊 **Statistics:**\n` +
                  `• Total Records: ${stats.total_records.toLocaleString()}\n` +
                  `• Records with Reports: ${stats.records_with_reports.toLocaleString()}\n` +
                  `• Unique Clients: ${stats.unique_clients.toLocaleString()}\n` +
                  `• Latest Upload: ${new Date(stats.latest_upload).toLocaleDateString()}`
          }]
        };
        
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `❌ **Database Connection: Failed**\n\nError: ${(error as Error).message}`
          }]
        };
      }
    }
  );

  // Cleanup function for graceful shutdown
  process.on('SIGINT', async () => {
    if (connectionPool) {
      console.log('Closing database connection pool...');
      await connectionPool.end();
    }
    process.exit(0);
  });
}
