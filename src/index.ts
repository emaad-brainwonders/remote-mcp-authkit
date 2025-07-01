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

  // Validate token using JWT decode (simpler approach that doesn't require API calls)
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
      // Use jose to decode JWT without verification for now
      // In production, you should verify the signature
      const { decodeJwt } = await import('jose');
      const payload = decodeJwt(token);
      
      // Check token expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        console.warn('Token has expired');
        return false;
      }

      // Check if token has required claims
      if (!payload.sub) {
        console.warn('Token missing subject claim');
        return false;
      }

      console.log(`Token validation successful for subject: ${payload.sub}`);
      return true;
    } catch (error) {
      console.error('Token validation failed:', error);
      return false;
    }
  }

  // Alternative validation using WorkOS API (more secure but requires API call)
  async validateTokenWithWorkOS(token: string): Promise<boolean> {
    try {
      const workOS = this.getWorkOS();
      
      // Try to validate the token by making an API call
      // Note: Adjust this based on actual WorkOS API methods
      const response = await fetch('https://api.workos.com/user_management/users/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const user = await response.json();
        console.log(`WorkOS validation successful for user: ${user.id}`);
        return true;
      }

      console.warn('WorkOS token validation failed:', response.status);
      return false;
    } catch (error) {
      console.error('WorkOS token validation error:', error);
      return false;
    }
  }

  // Check if the request requires authentication
  // Some MCP protocol messages might not need authentication
  private requiresAuthentication(request: Request): boolean {
    const url = new URL(request.url);
    
    // SSE connection requests are handled by OAuth provider
    if (url.pathname.endsWith('/sse') && request.method === 'GET') {
      return false;
    }

    // Add other exceptions as needed
    return true;
  }

  // Override connection validation to add authentication
  async validateConnection(request: Request): Promise<boolean> {
    if (!this.requiresAuthentication(request)) {
      return true;
    }

    return await this.validateToken(request);
  }

  async init() {
    console.log('Initializing MyMCP server...');

    try {
      // Set up error handling
      this.server.onerror = (error) => {
        console.error('MCP Server error:', error);
        this.handleError(error);
      };

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

  // Get access token from props
  getAccessToken(): string | null {
    return this.props?.accessToken || null;
  }

  // Get refresh token from props
  getRefreshToken(): string | null {
    return this.props?.refreshToken || null;
  }

  // Log user context for debugging
  logUserContext(): void {
    const user = this.getCurrentUser();
    const permissions = this.getUserPermissions();
    const orgId = this.getOrganizationId();

    console.log('User Context:', {
      userId: user?.id,
      email: user?.email,
      permissions,
      organizationId: orgId
    });
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
