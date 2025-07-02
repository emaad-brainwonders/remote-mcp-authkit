// Try this format if your LLM expects OpenAI function calling format
export function registerReportPathToolOpenAI(server: McpServer): void {
  
  server.tool("get_report_path", {
    description: "Get report path for a client ID. Call this when user asks for reports for a specific client ID or user ID.",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { 
          type: "string",
          description: "The client ID number as a string (e.g., '10000', '1001', '5555')" 
        }
      },
      required: ["client_id"],
      additionalProperties: false
    }
  }, async (args: any) => {
    console.log("get_report_path called with args:", args); // Add logging
    
    try {
      const clientId = parseInt(args.client_id);
      
      if (!clientId || isNaN(clientId)) {
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: Invalid client ID "${args.client_id}". Please provide a numeric value.` 
          }] 
        };
      }

      console.log(`Fetching reports for client ID: ${clientId}`); // Add logging

      const response = await fetch(`https://dimt-api.onrender.com/api/report-path?client_id=${clientId}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`API Error: ${response.status} - ${errorText}`); // Add logging
        return { 
          content: [{ 
            type: 'text', 
            text: `API Error: ${response.status} - ${response.statusText}` 
          }] 
        };
      }

      const data = await response.json();
      console.log("API Response:", data); // Add logging
      
      if (data.count === 0) {
        return { 
          content: [{ 
            type: 'text', 
            text: `No reports found for client ID: ${clientId}` 
          }] 
        };
      }

      const pathInfo = data.data.map((report: any) => 
        `Client: ${report.ClientName} (ID: ${report.ClientID})\nReport Path: ${report.ReportPath}`
      ).join('\n\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${data.count} report(s) for client ID ${clientId}:\n\n${pathInfo}`
        }]
      };

    } catch (error) {
      console.error("Tool execution error:", error); // Add logging
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  });
}
