import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthkitHandler } from "./authkit-handler";
//import { setEnv } from "./env"; // Import the setEnv function
import type { Props } from "./props";
import { registerDateTool } from "./tools/date";
import { registerAppointmentTools } from "./tools/appointment";

/*type Env = { 
  AI?: any;
  GOOGLE_ACCESS_TOKEN?: string;
  // Add other environment variables as needed
};*/

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "MCP server demo using AuthKit",
    version: "1.0.0",
  });

  async init() {
    // Set the environment variables globally at initialization
    if (this.env) {
      setEnv(this.env);
    }
    
    // Register tools directly
    registerDateTool(this.server);
    registerAppointmentTools(this.server);
  }
}

export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: MyMCP.mount("/sse") as any,
  defaultHandler: AuthkitHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
