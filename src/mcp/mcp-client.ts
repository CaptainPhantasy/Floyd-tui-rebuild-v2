/**
 * MCP Client for FLOYD TUI
 *
 * Real MCP client using @modelcontextprotocol/sdk to connect to MCP servers via stdio.
 * Replaces the hardcoded ToolBridge with dynamic tool discovery and execution.
 */

import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from '../llm/glm-agent-client.js';

// ============================================================================
// Types
// ============================================================================

export interface MCPServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface MCPConfig {
	mcpServers: Record<string, MCPServerConfig>;
}

export interface MCPToolExecutionResult {
	success: boolean;
	data?: unknown;
	error?: string;
	tool: string;
	server: string;
	timestamp: number;
}

interface ServerConnection {
	client: Client;
	transport: StdioClientTransport;
	serverName: string;
	config: MCPServerConfig;
	tools: Tool[];
}

// ============================================================================
// MCP Client Class
// ============================================================================

export class MCPClient {
	private servers: Map<string, ServerConnection> = new Map();
	private tools: Map<string, ToolDefinition> = new Map();
	private initialized = false;

	/**
	 * Get default MCP config path
	 */
	private getConfigPath(): string {
		const home = homedir();
		// Try Floyd config first, then Claude config
		return join(home, '.floyd', 'mcp.json');
	}

	/**
	 * Load MCP configuration from file
	 */
	async loadConfig(configPath?: string): Promise<MCPConfig> {
		const path = configPath || this.getConfigPath();
		try {
			const content = await readFile(path, 'utf-8');
			return JSON.parse(content) as MCPConfig;
		} catch (error) {
			console.error(`[MCP] Failed to load config from ${path}:`, error);
			return { mcpServers: {} };
		}
	}

	/**
	 * Connect to a single MCP server via stdio
	 */
	private async connectServer(serverName: string, config: MCPServerConfig): Promise<ServerConnection | null> {
		const args = config.args || [];
		const env: Record<string, string> = { ...config.env };
		// Add some process.env vars that are safe to inherit
		if (process.env.PATH) env.PATH = process.env.PATH;
		if (process.env.HOME) env.HOME = process.env.HOME;

		// Silent: console.log(`[MCP] Spawning ${serverName}: ${config.command} ${args.join(' ')}`);

		// Silent mode: ignore all server stderr to prevent UI disruption
		// MCP servers output startup messages that break the TUI layout
		const stderr = 'ignore';

		// Create stdio transport - this spawns the process
		const transport = new StdioClientTransport({
			command: config.command,
			args,
			env,
			stderr
		});

		const client = new Client(
			{ name: 'floyd-tui', version: '1.0.0' },
			{ capabilities: {} }
		);

		try {
			// Connect with timeout - connect() calls transport.start() automatically
			await Promise.race([
				client.connect(transport),
				new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
			]) as unknown;

			return { client, transport, serverName, config, tools: [] };
		} catch (error) {
			console.error(`[MCP] Failed to connect to ${serverName}:`, error);
			await transport.close().catch(() => {});
			return null;
		}
	}

	/**
	 * Initialize all MCP servers from config
	 */
	async connect(configPath?: string): Promise<void> {
		if (this.initialized) {
			return;
		}

		const config = await this.loadConfig(configPath);
		const { mcpServers } = config;

		// Silent: console.log(`[MCP] Loading ${Object.keys(mcpServers).length} servers from config`);

		// Add built-in servers
		const builtInServers: Record<string, MCPServerConfig> = {
			'floyd-runner': {
				command: 'node',
				args: ['/Volumes/Storage/FLOYD_CLI/dist/mcp/runner-server.js']
			},
			'floyd-git': {
				command: 'node',
				args: ['/Volumes/Storage/FLOYD_CLI/dist/mcp/git-server.js']
			},
			'floyd-patch': {
				command: 'node',
				args: ['/Volumes/Storage/FLOYD_CLI/dist/mcp/patch-server.js']
			},
			'floyd-explorer': {
				command: 'node',
				args: ['/Volumes/Storage/FLOYD_CLI/dist/mcp/explorer-server.js']
			},
			'floyd-cache': {
				command: 'node',
				args: ['/Volumes/Storage/FLOYD_CLI/dist/mcp/cache-server.js']
			},
			'floyd-browser': {
				command: 'node',
				args: ['/Volumes/Storage/FLOYD_CLI/dist/mcp/browser-server.js']
			}
		};

		// Merge built-in with external
		const allServers = { ...builtInServers, ...mcpServers };

		// Connect to each server
		for (const [serverName, serverConfig] of Object.entries(allServers)) {
			const connection = await this.connectServer(serverName, serverConfig);
			if (connection) {
				this.servers.set(serverName, connection);
			}
		}

		// Discover tools from all connected servers
		await this.refreshTools();

		this.initialized = true;
		// Silent: console.log(`[MCP] Connected to ${this.servers.size} servers with ${this.tools.size} tools`);
	}

	/**
	 * Discover all tools from connected servers
	 */
	private async refreshTools(): Promise<void> {
		for (const [serverName, connection] of this.servers) {
			try {
				const response = await connection.client.listTools();
				const tools = response?.tools;
				if (tools) {
					connection.tools = tools;
					for (const tool of tools) {
						const fullName = `mcp__${serverName}__${tool.name}`;
						this.tools.set(fullName, {
							name: fullName,
							description: tool.description || '',
							input_schema: (tool.inputSchema as Record<string, unknown>) || {}
						});
					}
					// Silent: console.log(`[MCP] ${serverName}: ${tools.length} tools`);
				}
			} catch (error) {
				console.error(`[MCP] Failed to discover tools from ${serverName}:`, error);
			}
		}
	}

	/**
	 * Get all discovered tools in format compatible with LLM client
	 */
	async discoverTools(): Promise<ToolDefinition[]> {
		if (!this.initialized) {
			await this.connect();
		}
		return Array.from(this.tools.values());
	}

	/**
	 * Get tools formatted for LLM API
	 */
	async formatForLLM(): Promise<Array<{ name: string; description: string; input_schema: Record<string, unknown> }>> {
		const tools = await this.discoverTools();
		const result: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [];
		for (const tool of tools) {
			result.push({
				name: tool.name,
				description: tool.description,
				input_schema: tool.input_schema
			});
		}
		return result;
	}

	/**
	 * Execute a tool on the appropriate server
	 */
	async executeTool(toolName: string, input: Record<string, unknown>): Promise<MCPToolExecutionResult> {
		const parsed = this.parseToolName(toolName);
		if (!parsed) {
			return {
				success: false,
				error: `Invalid tool name: ${toolName}`,
				tool: toolName,
				server: 'unknown',
				timestamp: Date.now()
			};
		}

		const { server, tool } = parsed;
		const connection = this.servers.get(server);

		if (!connection) {
			return {
				success: false,
				error: `Server not connected: ${server}`,
				tool,
				server,
				timestamp: Date.now()
			};
		}

		try {
			const result = await connection.client.callTool({
				name: tool,
				arguments: input as Record<string, unknown>
			});

			return {
				success: true,
				data: result,
				tool,
				server,
				timestamp: Date.now()
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				tool,
				server,
				timestamp: Date.now()
			};
		}
	}

	/**
	 * Parse tool name to extract server and tool
	 * Format: mcp__{server}__{tool_name}
	 */
	private parseToolName(toolName: string): { server: string; tool: string } | null {
		const match = toolName.match(/^mcp__(.+?)__(.+)$/);
		if (match) {
			return { server: match[1], tool: match[2] };
		}
		return null;
	}

	/**
	 * Get server status
	 */
	getServerStatus(): Record<string, boolean> {
		const status: Record<string, boolean> = {};
		for (const [name, conn] of this.servers) {
			status[name] = conn.transport.pid !== null;
		}
		return status;
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.initialized && this.servers.size > 0;
	}

	/**
	 * Graceful shutdown - kill all server processes
	 */
	async shutdown(): Promise<void> {
		console.log(`[MCP] Shutting down ${this.servers.size} servers`);
		for (const [serverName, connection] of this.servers) {
			try {
				await connection.transport.close();
				console.log(`[MCP] Shut down ${serverName}`);
			} catch (error) {
				console.error(`[MCP] Error shutting down ${serverName}:`, error);
			}
		}
		this.servers.clear();
		this.tools.clear();
		this.initialized = false;
	}
}

export default MCPClient;
