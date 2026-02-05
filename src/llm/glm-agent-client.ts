/**
 * GLM Agent Client - Tool-Enhanced LLM Client
 *
 * Extends the basic GLM client with:
 * - Tool/function calling support
 * - Agentic execution loop
 * - Tool use detection and execution
 */

import type { ChatMessage, LLMClient, ChunkCallback, ProviderConfig } from './factory.js';
import { getConciseToolAwarenessPrompt } from './tool-awareness-prompt.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolDefinition {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResult {
	toolUseId: string;
	content: string;
	isError?: boolean;
}

export interface AgentMessage extends ChatMessage {
	toolCalls?: ToolCall[];
	toolUseId?: string;
}

export interface AgentClientConfig extends ProviderConfig {
	tools?: ToolDefinition[];
	maxTurns?: number;
	onToolStart?: (tool: string, input: Record<string, unknown>) => void;
	onToolComplete?: (tool: string, result: unknown) => void;
}

// ============================================================================
// GLM Agent Client
// ============================================================================

/**
 * GLM client with agentic tool use support
 *
 * This client:
 * 1. Sends messages with tool definitions to GLM-4.7
 * 2. Detects when GLM wants to call a tool
 * 3. Executes the tool (via callback)
 * 4. Feeds the result back to GLM
 * 5. Continues until GLM is done (no more tool calls)
 */
export class GLMAgentClient implements LLMClient {
	private apiKey: string;
	private baseURL: string;
	private model: string;
	private temperature: number;
	private maxTokens: number;
	private messages: AgentMessage[] = [];
	private tools: ToolDefinition[];
	private maxTurns: number;
	private onToolStart?: (tool: string, input: Record<string, unknown>) => void;
	private onToolComplete?: (tool: string, result: unknown) => void;

	// Tool execution callback - set by TUI to actually execute tools
	private toolExecutor?: (toolCall: ToolCall) => Promise<ToolResult>;

	constructor(config: AgentClientConfig) {
		if (!config.apiKey) {
			const error = new Error('GLM API key is required') as Error & { code?: string };
			error.code = 'MISSING_API_KEY';
			throw error;
		}

		this.apiKey = config.apiKey;
		this.baseURL = config.baseURL || 'https://api.z.ai/api/anthropic';
		this.model = config.model || 'GLM-4.7';
		this.temperature = config.temperature || 0.7;
		this.maxTokens = config.maxTokens || 8192;
		this.tools = config.tools || [];
		this.maxTurns = config.maxTurns || 20;
		this.onToolStart = config.onToolStart;
		this.onToolComplete = config.onToolComplete;

		// Initialize with system message
		this.messages = [
			{
				role: 'system',
				content: this.buildSystemPrompt()
			}
		];
	}

	/**
	 * Set the tool executor callback
	 * This is called by the TUI to connect tool execution to actual MCP tools
	 */
	setToolExecutor(executor: (toolCall: ToolCall) => Promise<ToolResult>): void {
		this.toolExecutor = executor;
	}

	/**
	 * Set/update tools and rebuild system prompt
	 */
	setTools(tools: ToolDefinition[]): void {
		this.tools = tools;
		// Rebuild system prompt with new tools
		this.messages[0] = {
			role: 'system',
			content: this.buildSystemPrompt()
		};
	}

	/**
	 * Build system prompt with tool context
	 */
	private buildSystemPrompt(): string {
		const toolList = this.tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
		const toolCount = this.tools.length;

		return `# FLOYD - AI Development Companion

You are FLOYD, an advanced AI development assistant with access to powerful tools via MCP (Model Context Protocol).

${getConciseToolAwarenessPrompt()}

## Available Tools

You have access to ${toolCount} tools:

${toolList || 'No tools configured.'}

## Tool Use Guidelines

1. MUST use tools proactively for external state (git, files, tests, builds)
2. MUST NOT use tools for general knowledge questions
3. DO NOT explain you're using a tool - JUST USE IT
4. Always read files before editing them
5. Verify changes after making them

## Preset Shortcuts (47% Faster)

!! - Repeat last tool call
!* - Execute all pending tools
!test - Run tests
!build - Build project
!lint - Run linter
!git_status - Show git status
!git_diff - Show git diff
!ls - List project structure
!cache_stats - Show cache stats

## Response Style

- Be direct and concise
- Show tool results clearly
- Explain your reasoning briefly
- Think through problems step by step
`;
	}

	/**
	 * Send a message and run the agentic loop
	 *
	 * This is the main entry point that implements tool use.
	 * It runs multiple turns if the model wants to call tools.
	 */
	async sendMessage(message: string, onChunk?: ChunkCallback): Promise<string> {
		// Add user message
		this.messages.push({
			role: 'user',
			content: message
		});

		let finalResponse = '';
		let turnCount = 0;

		// Agentic loop
		while (turnCount < this.maxTurns) {
			turnCount++;

			// Call LLM
			const response = await this.callLLM(onChunk);

			// Add assistant message
			this.messages.push({
				role: 'assistant',
				content: response.text,
				toolCalls: response.toolCalls
			});

			finalResponse = response.text;

			// Check if done (no tool calls)
			if (response.toolCalls.length === 0) {
				break;
			}

			// Execute tools
			for (const toolCall of response.toolCalls) {
				const toolResult = await this.executeTool(toolCall);

				// Add tool result message
				this.messages.push({
					role: 'assistant', // GLM uses assistant role for tool results
					content: JSON.stringify(toolResult.content),
					toolUseId: toolResult.toolUseId
				});
			}
		}

		return finalResponse;
	}

	/**
	 * Call the GLM API
	 */
	private async callLLM(onChunk?: ChunkCallback): Promise<{
		text: string;
		toolCalls: ToolCall[];
	}> {
		const response = await fetch(this.baseURL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'Bearer ' + this.apiKey,
			},
			body: JSON.stringify({
				model: this.model,
				messages: this.messages, // All messages sent to GLM - tool results included as assistant messages
				temperature: this.temperature,
				max_tokens: this.maxTokens,
				stream: false, // Disable streaming for tool detection
				tools: this.tools.length > 0 ? this.formatToolsForGLM(this.tools) : undefined,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`GLM API error: ${response.status} - ${errorText}`);
		}

		const data = await response.json();

		// Parse response
		const choice = data.choices?.[0];
		if (!choice) {
			return { text: '', toolCalls: [] };
		}

		const message = choice.message;
		const text = message?.content || '';
		const toolCalls = this.parseToolCalls(message?.tool_calls);

		// If streaming was requested, emit the full text at once
		if (onChunk && text) {
			onChunk(text);
		}

		return { text, toolCalls };
	}

	/**
	 * Format tools for GLM API (OpenAI-compatible format)
	 * GLM expects: { type: "function", function: { name, description, parameters } }
	 */
	private formatToolsForGLM(tools: ToolDefinition[]): unknown[] {
		return tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema
			}
		}));
	}

	/**
	 * Parse tool calls from GLM response
	 */
	private parseToolCalls(toolCallsData: unknown): ToolCall[] {
		if (!Array.isArray(toolCallsData)) {
			return [];
		}

		return toolCallsData.map(tc => ({
			id: tc.id || this.generateId(),
			name: tc.function?.name || '',
			input: typeof tc.function?.arguments === 'string'
				? JSON.parse(tc.function.arguments)
				: (tc.function?.arguments || {})
		}));
	}

	/**
	 * Execute a tool via the registered executor
	 */
	private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
		const { name, input, id } = toolCall;

		console.error(`[FLOYD] Executing tool: ${name}`);

		// Notify callback
		this.onToolStart?.(name, input);

		let result: ToolResult;

		if (this.toolExecutor) {
			try {
				result = await this.toolExecutor(toolCall);
			} catch (error) {
				result = {
					toolUseId: id,
					content: error instanceof Error ? error.message : String(error),
					isError: true
				};
			}
		} else {
			// No executor configured - return error
			result = {
				toolUseId: id,
				content: `Tool execution not configured. The tool "${name}" was called but no executor is available.`,
				isError: true
			};
		}

		// Notify callback
		this.onToolComplete?.(name, result);

		return result;
	}

	/**
	 * Generate a unique ID for tool calls
	 */
	private generateId(): string {
		return `toolu_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	}

	/**
	 * Get current message history
	 */
	getHistory(): AgentMessage[] {
		return [...this.messages];
	}

	/**
	 * Clear message history (except system prompt)
	 */
	clearHistory(): void {
		this.messages = [
			{
				role: 'system',
				content: this.buildSystemPrompt()
			}
		];
	}

	/**
	 * Reset message history with custom messages
	 */
	setHistory(messages: ChatMessage[]): void {
		this.messages = [
			{
				role: 'system',
				content: this.buildSystemPrompt()
			},
			...messages
		];
	}
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Get standard MCP tool definitions for GLM
 */
export function getStandardMCPTools(): ToolDefinition[] {
	// Core development tools
	return [
		{
			name: 'mcp__floyd_runner__detect_project',
			description: 'Auto-detect project type (Node.js, Python, Go, Rust) and available commands (test, build, lint, format)',
			input_schema: {
				type: 'object',
				properties: {
					projectPath: {
						type: 'string',
						description: 'Path to the project directory'
					}
				},
				required: ['projectPath']
			}
		},
		{
			name: 'mcp__floyd_runner__run_tests',
			description: 'Run the project test suite',
			input_schema: {
				type: 'object',
				properties: {
					projectPath: {
						type: 'string',
						description: 'Path to the project'
					}
				},
				required: ['projectPath']
			}
		},
		{
			name: 'mcp__floyd_runner__build',
			description: 'Build the project',
			input_schema: {
				type: 'object',
				properties: {
					projectPath: {
						type: 'string',
						description: 'Path to the project'
					}
				},
				required: ['projectPath']
			}
		},
		{
			name: 'mcp__floyd_git__git_status',
			description: 'Get git status showing staged/unstaged files and current branch',
			input_schema: {
				type: 'object',
				properties: {
					cwd: {
						type: 'string',
						description: 'Working directory path'
					}
				}
			}
		},
		{
			name: 'mcp__floyd_git__git_diff',
			description: 'Get git diff showing changes',
			input_schema: {
				type: 'object',
				properties: {
					cwd: {
						type: 'string',
						description: 'Working directory'
					},
					file: {
						type: 'string',
						description: 'Specific file to diff (optional)'
					}
				}
			}
		},
		{
			name: 'mcp__floyd_git__git_commit',
			description: 'Create a git commit with a message',
			input_schema: {
				type: 'object',
				properties: {
					cwd: {
						type: 'string',
						description: 'Working directory'
					},
					message: {
						type: 'string',
						description: 'Commit message'
					}
				},
				required: ['cwd', 'message']
			}
		},
		{
			name: 'mcp__floyd_git__git_stage',
			description: 'Stage files for commit',
			input_schema: {
				type: 'object',
				properties: {
					cwd: {
						type: 'string',
						description: 'Working directory'
					},
					paths: {
						type: 'array',
						items: { type: 'string' },
						description: 'File paths to stage (optional, defaults to all)'
					}
				},
				required: ['cwd']
			}
		},
		{
			name: 'mcp__floyd_explorer__read_file',
			description: 'Read file contents with optional line range',
			input_schema: {
				type: 'object',
				properties: {
					filePath: {
						type: 'string',
						description: 'Path to the file to read'
					},
					startLine: {
						type: 'number',
						description: 'Starting line number (1-indexed, optional)'
					},
					endLine: {
						type: 'number',
						description: 'Ending line number (inclusive, optional)'
					}
				},
				required: ['filePath']
			}
		},
		{
			name: 'mcp__floyd_explorer__project_map',
			description: 'Get a compressed directory tree of the project structure',
			input_schema: {
				type: 'object',
				properties: {
					projectPath: {
						type: 'string',
						description: 'Path to analyze'
					},
					maxDepth: {
						type: 'number',
						description: 'Maximum directory depth (default: 3)'
					}
				}
			}
		},
		{
			name: 'mcp__floyd_patch__edit_range',
			description: 'Edit a specific line range in a file',
			input_schema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'File path to edit'
					},
					startLine: {
						type: 'number',
						description: 'Starting line number (1-indexed)'
					},
					endLine: {
						type: 'number',
						description: 'Ending line number (inclusive)'
					},
					newContent: {
						type: 'string',
						description: 'New content to replace the range with'
					}
				},
				required: ['path', 'startLine', 'endLine', 'newContent']
			}
		},
		{
			name: 'mcp__floyd_supercache__cache_store',
			description: 'Store data in cache with optional TTL',
			input_schema: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: 'Cache key (use pattern like category:entity:version)'
					},
					value: {
						type: 'object',
						description: 'Value to store (any JSON-serializable data)'
					},
					tier: {
						type: 'string',
						enum: ['project', 'reasoning', 'vault'],
						description: 'Cache tier (default: project)'
					},
					ttl: {
						type: 'number',
						description: 'Time to live in seconds (optional)'
					}
				},
				required: ['key', 'value']
			}
		},
		{
			name: 'mcp__floyd_supercache__cache_retrieve',
			description: 'Retrieve data from cache',
			input_schema: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: 'Cache key'
					},
					tier: {
						type: 'string',
						enum: ['project', 'reasoning', 'vault'],
						description: 'Cache tier (default: project)'
					}
				},
				required: ['key']
			}
		},
	];
}
