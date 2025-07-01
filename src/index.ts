import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkOS } from "@workos-inc/node";
import type { Props } from "./props";
import { registerDateTool } from "./tools/date";
import { setupAppointmentTools } from "./tools/appointment";
import { registerEmailTools } from "./tools/mail";
import { CalendarReminderService } from "./automation/calendarreminder";
import { registerReportTools } from "./tools/report";

// Define the Env type to match wrangler.json bindings
interface Env { 
  AI: any;
  GOOGLE_ACCESS_TOKEN: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_CLIENT_SECRET: string;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
}

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "MCP server demo using AuthKit",
    version: "1.0.0",
  });

  private reminderService: CalendarReminderService | null = null;
  private workOS: WorkOS | null = null;

  // Initialize WorkOS instance
  private getWorkOS(): WorkOS {
    if (!this.workOS) {
      this.workOS = new WorkOS(this.env.WORKOS_CLIENT_SECRET);
    }
    return this.workOS;
  }

  // Add token validation middleware
  async validateToken(request: Request): Promise<boolean> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('Missing or invalid Authorization header');
      return false;
    }

    const token = authHeader.substring(7);
    if (!token) {
      console.warn('Empty token in Authorization header');
      return false;
    }

    try {
      // Validate token with WorkOS
      const workOS = this.getWorkOS();
      
      // Try to get user information using the access token
      // Note: This might need to be adjusted based on WorkOS API
      const user = await workOS.userManagement.getUser(token);
      
      if (user) {
        console.log(`Token validation successful for user: ${user.id}`);
        return true;
      }
      
      console.warn('Token validation failed: No user returned');
      return false;
    } catch (error) {
      console.error('Token validation failed:', error);
      return false;
    }
  }

  // Alternative validation method using JWT decode
  async validateTokenJWT(request: Request): Promise<boolean> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.substring(7);
    try {
      // Import jose for JWT validation
      const { jwtVerify } = await import('jose');
      
      // You'll need to get the public key from WorkOS
      // This is a placeholder - replace with actual WorkOS public key
      const publicKey = await this.getWorkOSPublicKey();
      
      const { payload } = await jwtVerify(token, publicKey);
      
      // Check token expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        console.warn('Token has expired');
        return false;
      }

      console.log(`JWT validation successful for subject: ${payload.sub}`);
      return true;
    } catch (error) {
      console.error('JWT validation failed:', error);
      return false;
    }
  }

  // Placeholder for getting WorkOS public key
  private async getWorkOSPublicKey(): Promise<any> {
    // This should fetch the actual public key from WorkOS
    // Check WorkOS documentation for the correct endpoint
    throw new Error('WorkOS public key retrieval not implemented');
  }

  // Enhanced request handler with proper error handling
  private async handleAuthenticatedRequest(request: any): Promise<any> {
    try {
      // Check if this is an internal MCP protocol message
      // that doesn't require authentication
      if (this.isInternalMCPRequest(request)) {
        return await this.server.handleRequest(request);
      }

      // For external requests, validate authentication
      const isValid = await this.validateToken(request);
      if (!isValid) {
        throw new Error('Authentication required: Invalid or missing access token');
      }

      // Process the authenticated request
      return await this.server.handleRequest(request);
    } catch (error) {
      console.error('Request handling error:', error);
      throw error;
    }
  }

  // Check if request is internal MCP protocol
  private isInternalMCPRequest(request: any): boolean {
    // Add logic to identify internal MCP protocol messages
    // This might include initialization, capability exchange, etc.
    return request?.method === 'initialize' || 
           request?.method === 'notifications/initialized' ||
           request?.method === 'ping';
  }

  async init() {
    console.log('Initializing MyMCP server...');

    try {
      // Set up the request handler with authentication
      this.server.setRequestHandler(async (request) => {
        return await this.handleAuthenticatedRequest(request);
      });

      // Register tools
      console.log('Registering tools...');
      registerDateTool(this.server);
      setupAppointmentTools(this.server, this.env);
      registerEmailTools(this.server);
      registerReportTools(this.server, this.env);

      // Initialize reminder service
      console.log('Starting calendar reminder service...');
      this.reminderService = new CalendarReminderService(this.env);
      await this.reminderService.startReminderAutomation();

      console.log('MyMCP server initialization complete');
    } catch (error) {
      console.error('Failed to initialize MyMCP server:', error);
      throw error;
    }
  }

  // Handle server errors gracefully
  async handleError(error: Error): Promise<void> {
    console.error('MyMCP server error:', error);
    
    // You might want to report errors to a monitoring service here
    // or perform other error handling logic
  }

  // Get user information from props (available after authentication)
  getCurrentUser(): Props['user'] | null {
    return this.props?.user || null;
  }

  // Get user permissions from props
  getUserPermissions(): string[] {
    return this.props?.permissions || [];
  }

  // Check if user has specific permission
  hasPermission(permission: string): boolean {
    const userPermissions = this.getUserPermissions();
    return userPermissions.includes(permission);
  }

  // Get organization ID if available
  getOrganizationId(): string | undefined {
    return this.props?.organizationId;
  }

  async cleanup() {
    console.log('Cleaning up MyMCP server...');
    
    try {
      if (this.reminderService) {
        await this.reminderService.cleanup();
        this.reminderService = null;
      }

      // Clean up WorkOS instance
      this.workOS = null;

      console.log('MyMCP server cleanup complete');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}
