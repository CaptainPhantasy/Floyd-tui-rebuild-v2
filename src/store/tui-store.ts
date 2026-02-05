import {create} from 'zustand';
import {
	saveState,
	loadState as loadPersistedState,
	clearState as clearPersistedState,
	initializeState,
} from '../utils/persistence.js';
import {getRandomPhraseUnique} from '../utils/whimsical-phrases.js';
import type {LLMProvider, AgentLLMClient} from '../llm/factory.js';
import {loadFloydEnv, getProviderApiKey} from '../utils/providerConfig.js';
import {TuiTagParser} from '../utils/tag-parser.js';
import {ToolBridge} from '../mcp/tool-bridge.js';
import {
	parsePrefixMode,
	isBashCommand,
	isSlashCommand,
	parseBashCommand,
	parseSlashCommand,
	parseAgentDelegation,
	parseToolInvocation,
	validateBashCommand,
	getPresetToolCall,
	SLASH_COMMANDS,
	type ParsedInput,
} from '../utils/prefix-parser.js';

export type OverlayMode =
	| 'none'
	| 'transcript'
	| 'history'
	| 'background'
	| 'command'
	| 'help'
	| 'diff'
	| 'config'
	| 'context'
	| 'editor'
	| 'rewind';

export type FloydMode =
	| 'ask'
	| 'plan'
	| 'auto'
	| 'discuss'
	| 'fuckit';

export type ConnectionStatus = 'online' | 'offline' | 'connecting';

interface BackgroundTask {
	id: string;
	command: string;
	status: 'running' | 'done' | 'failed';
	startTime: number;
	endTime?: number;
	exitCode?: number;
	output?: string;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	timestamp: number;
	streaming?: boolean;
	toolCalls?: ToolCall[];
}

interface ToolCall {
	id?: string;
	name: string;
	input?: Record<string, unknown>;
	status: 'pending' | 'running' | 'success' | 'error';
	result?: string | undefined;
	error?: string | undefined;
}

// Stored tool call for replay with !! shortcut
interface StoredToolCall {
	name: string;
	input: Record<string, unknown>;
	timestamp: number;
}

interface TuiStore {
	mode: FloydMode;
	model: string;
	provider: string;
	connectionStatus: ConnectionStatus;
	isThinking: boolean;
	thinkingEnabled: boolean;
	whimsicalPhrase: string | null;
	messages: ChatMessage[];
	streamingContent: string;
	input: string;
	overlayMode: OverlayMode;
	backgroundTasks: BackgroundTask[];
	diffViewer: {
		file1Path: string;
		file2Path: string;
		file1Content: string;
		file2Content: string;
		onClose: () => void;
	} | null;
	_initialized: boolean;
	// MCP ToolBridge integration
	toolBridge: ToolBridge | null;
	activeToolCalls: ToolCall[];
	// Last tool call for !! shortcut (repeat last tool)
	lastToolCall: StoredToolCall | null;

	setMode: (mode: FloydMode) => void;
	cycleMode: () => void;
	setModel: (model: string) => void;
	setProvider: (provider: string) => void;
	setConnectionStatus: (status: ConnectionStatus) => void;
	setThinking: (thinking: boolean, phrase?: string) => void;
	toggleThinking: () => void;
	setInput: (input: string) => void;
	addMessage: (message: ChatMessage) => void;
	clearMessages: () => void;
	exportTranscript: () => void;
	setStreamingContent: (content: string) => void;
	setOverlayMode: (mode: OverlayMode) => void;
	setDiffViewer: (diffData: TuiStore['diffViewer']) => void;
	closeOverlay: () => void;
	addBackgroundTask: (task: Omit<BackgroundTask, 'id'>) => string;
	updateBackgroundTask: (id: string, updates: Partial<BackgroundTask>) => void;
	sendMessage: (content: string) => Promise<string>;
	undoLastExchange: () => void;
	// Persistence actions
	initialize: () => Promise<void>;
	savePreferences: () => Promise<void>;
	loadPreferences: () => Promise<void>;
	clearPreferences: () => Promise<void>;
	// MCP ToolBridge actions
	initializeToolBridge: () => Promise<void>;
	setActiveToolCalls: (toolCalls: ToolCall[]) => void;
	// Claude-style shortcuts
	repeatLastTool: () => Promise<void>;
	executeAllPendingTools: () => Promise<void>;
}

export const useTuiStore = create<TuiStore>((set, get) => ({
	mode: 'ask',
	model: 'GLM-4.7',
	provider: 'glm',
	connectionStatus: 'offline',
	isThinking: false,
	thinkingEnabled: true,
	whimsicalPhrase: null,
	messages: [],
	streamingContent: '',
	input: '',
	overlayMode: 'none',
	backgroundTasks: [],
	diffViewer: null,
	_initialized: false,
	toolBridge: null,
	activeToolCalls: [],
	lastToolCall: null,

	setMode: mode => {
		set({mode});
		// Auto-save mode preference
		saveState({mode}).catch(() => {});
	},
	setInput: input => set({input}),
	cycleMode: () => {
		const modes: FloydMode[] = [
			'ask',
			'plan',
			'auto',
			'discuss',
			'fuckit',
		];
		const currentIdx = modes.indexOf(get().mode);
		const nextMode = modes[(currentIdx + 1) % modes.length];
		set({mode: nextMode});
		saveState({mode: nextMode}).catch(() => {});
	},

	setModel: model => {
		set({model});
		saveState({model}).catch(() => {});
	},
	setProvider: provider => {
		set({provider});
		saveState({provider}).catch(() => {});
	},
	setConnectionStatus: connectionStatus => set({connectionStatus}),
	setDiffViewer: diffViewer => set({diffViewer}),

	setThinking: (isThinking, whimsicalPhrase) => {
		const phrase =
			isThinking && !whimsicalPhrase
				? getRandomPhraseUnique(get().whimsicalPhrase ?? undefined)
				: whimsicalPhrase;
		set({isThinking, whimsicalPhrase: phrase ?? null});
	},
	toggleThinking: () => {
		const newState = !get().thinkingEnabled;
		set({thinkingEnabled: newState});
		saveState({thinkingEnabled: newState}).catch(() => {});
	},

	addMessage: message =>
		set(state => ({
			messages: [...state.messages, message],
		})),
	clearMessages: () => set({messages: []}),
	exportTranscript: () => {
		const {messages} = get();
		const timestamp = new Date().toISOString();
		const filename = `floyd-transcript-${timestamp}.txt`;
		const content = messages
			.map(
				m =>
					`[${new Date(m.timestamp).toISOString()}] ${m.role.toUpperCase()}: ${
						m.content
					}`,
			)
			.join('\n\n');
		// In a real implementation, this would write to a file
		// For now, we'll just log it
		console.log(`\n--- Export to ${filename} ---\n${content}\n`);
	},
	setStreamingContent: streamingContent => set({streamingContent}),

	setOverlayMode: overlayMode => set({overlayMode}),
	closeOverlay: () => set({overlayMode: 'none'}),

	addBackgroundTask: task => {
		const id = Math.random().toString(36).substring(7);
		set(state => ({
			backgroundTasks: [...state.backgroundTasks, {...task, id}],
		}));
		return id;
	},
	updateBackgroundTask: (id, updates) =>
		set(state => ({
			backgroundTasks: state.backgroundTasks.map(task =>
				task.id === id ? {...task, ...updates} : task,
			),
		})),

	sendMessage: async content => {
		const trimmedContent = content.trim();

		// ========================================================================
		// PREFIX MODE DETECTION (Claude Code alignment - "47% Gift")
		// ========================================================================
		const parsed: ParsedInput = parsePrefixMode(trimmedContent);

		// Handle shortcuts (!!, !*, !c, !u, !r)
		if (parsed.shortcut === 'repeatLast') {
			await get().repeatLastTool();
			return 'Repeating last tool call...';
		}

		if (parsed.shortcut === 'executeAll') {
			await get().executeAllPendingTools();
			return 'Executing all pending tools...';
		}

		if (parsed.shortcut === 'continue') {
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: '⏩ Continuing last task...',
				timestamp: Date.now(),
			});
			return 'Continuing...';
		}

		if (parsed.shortcut === 'undo') {
			get().undoLastExchange();
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: '↩️ Undid last exchange',
				timestamp: Date.now(),
			});
			return 'Undo complete';
		}

		if (parsed.shortcut === 'redo') {
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: '↪️ Redo - feature coming soon',
				timestamp: Date.now(),
			});
			return 'Redo coming soon';
		}

		// Handle bash mode (!command)
		if (isBashCommand(parsed)) {
			const {command, args} = parseBashCommand(parsed.cleanInput);
			const fullCommand = `${command} ${args.join(' ')}`.trim();

			// Check for preset tool calls first
			const preset = getPresetToolCall(fullCommand);
			if (preset) {
				get().addMessage({
					id: Math.random().toString(36).substring(7),
					role: 'user',
					content: `!${fullCommand}`,
					timestamp: Date.now(),
				});

				// Execute preset tool via toolBridge
				let {toolBridge} = get();

				// Auto-initialize ToolBridge if not present
				if (!toolBridge) {
					toolBridge = new ToolBridge();
					set({toolBridge});
					console.log('[TUI] ToolBridge auto-initialized for preset tool');
				}

				const callId = `${preset.tool}_${Date.now()}`;
				set({
					activeToolCalls: [
						...get().activeToolCalls,
						{id: callId, name: preset.tool, status: 'running'},
					],
				});

				try {
					const result = await toolBridge.executeTool(preset.tool, preset.input);
					set({
						activeToolCalls: get().activeToolCalls.map(call =>
							call.id === callId
								? {...call, status: 'success' as const, result: JSON.stringify(result).slice(0, 200)}
								: call,
						),
						lastToolCall: {
							name: preset.tool,
							input: preset.input,
							timestamp: Date.now(),
						},
					});

					get().addMessage({
						id: Math.random().toString(36).substring(7),
						role: 'assistant',
						content: `[Tool Result] ${preset.description} completed successfully`,
						timestamp: Date.now(),
						toolCalls: [{id: callId, name: preset.tool, status: 'success'}],
					});
					return `Executed: ${preset.description}`;
				} catch (error) {
					set({
						activeToolCalls: get().activeToolCalls.map(call =>
							call.id === callId
								? {...call, status: 'error' as const, error: String(error)}
								: call,
						),
					});
					return `Tool failed: ${error}`;
				}
			}

			// Validate bash command safety
			const warnings = validateBashCommand(fullCommand);
			if (warnings.length > 0) {
				const mode = get().mode;
				if (mode !== 'fuckit' && mode !== 'auto') {
					get().addMessage({
						id: Math.random().toString(36).substring(7),
						role: 'system',
						content: `⚠️ Dangerous command detected:\n${warnings.join('\n')}\n\nSwitch to FUCKIT mode to override.`,
						timestamp: Date.now(),
					});
					return 'Command blocked - dangerous operation detected';
				}
			}

			// Add bash command as background task
			get().addBackgroundTask({
				command: fullCommand,
				status: 'running',
				startTime: Date.now(),
			});

			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'user',
				content: `!${fullCommand}`,
				timestamp: Date.now(),
			});

			// Fall through to LLM for bash execution
			content = `Execute this bash command: ${fullCommand}`;
		}

		// Handle slash commands (/help, /explain, etc.)
		else if (isSlashCommand(parsed)) {
			const {command, args} = parseSlashCommand(parsed.cleanInput);

			// Check built-in slash commands
			const slashCmd = SLASH_COMMANDS[command];
			if (slashCmd) {
				const result = await slashCmd.handler(args);
				get().addMessage({
					id: Math.random().toString(36).substring(7),
					role: 'system',
					content: result,
					timestamp: Date.now(),
				});
				return result;
			}

			// Unknown slash command
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: `⚠️ Unknown command: /${command}\nType /help for available commands`,
				timestamp: Date.now(),
			});
			return `Unknown command: /${command}`;
		}

		// Handle agent mode (@agent task)
		else if (parsed.mode === 'agent') {
			const {agent, instruction} = parseAgentDelegation(parsed.cleanInput);

			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'user',
				content: `@${agent}: ${instruction}`,
				timestamp: Date.now(),
			});

			// Delegate to sub-agent (future feature)
			content = `I'm delegating this task to the @${agent} agent: ${instruction}`;
		}

		// Handle tool mode (&tool args)
		else if (parsed.mode === 'tool') {
			const {tool, args} = parseToolInvocation(parsed.cleanInput);

			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'user',
				content: `&${tool} ${args}`,
				timestamp: Date.now(),
			});

			// Direct tool invocation (future feature)
			content = `Invoke tool ${tool} with args: ${args}`;
		}

		// Handle file reference mode (>file)
		else if (parsed.mode === 'file') {
			const filePath = parsed.cleanInput;

			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: `📁 File reference: ${filePath}`,
				timestamp: Date.now(),
			});

			// Include file in context for next message
			content = `I'm referencing file: ${filePath}`;
		}

		// Normal mode - continue with standard LLM message handling
		const userMessage: ChatMessage = {
			id: Math.random().toString(36).substring(7),
			role: 'user',
			content: parsed.isPrefixed ? content : parsed.cleanInput,
			timestamp: Date.now(),
		};
		const phrase = getRandomPhraseUnique(get().whimsicalPhrase ?? undefined);

		// Add user message immediately
		set({
			messages: [...get().messages, userMessage],
			isThinking: true,
			whimsicalPhrase: phrase,
			connectionStatus: 'connecting',
		});

		// Get provider from store
		let provider = get().provider;
		const model = get().model;

		// Load API key and endpoint from ~/.floyd/.env.local
		const env = loadFloydEnv();
		let apiKey = getProviderApiKey(provider);

		// Smart fallback: if current provider has no key, try to use GLM
		let effectiveModel = model;
		if (!apiKey && provider !== 'glm') {
			const glmKey = getProviderApiKey('glm');
			if (glmKey) {
				console.log(
					`[FLOYD] No API key for "${provider}", falling back to GLM`,
				);
				provider = 'glm';
				apiKey = glmKey;
				// Also reset model to GLM default when falling back
				effectiveModel = 'GLM-4.7';
				// Update store to reflect fallback
				set({provider, model: effectiveModel});
			}
		}

		// Get endpoint from env if available
		let baseURL = undefined;
		if (provider === 'glm') {
			baseURL = env.FLOYD_GLM_ENDPOINT || 'https://api.z.ai/api/anthropic';
		}

		if (!apiKey) {
			set({
				isThinking: false,
				connectionStatus: 'offline',
			});
			throw new Error(
				`API key not found for provider "${provider}". Configure with: floyd-config`,
			);
		}

		// Get LLM client
		const {createLLMClient} = await import('../llm/factory.js');
		const client = createLLMClient(provider as LLMProvider, {
			apiKey,
			model: effectiveModel,
			baseURL,
		});

		// Initialize ToolBridge if using agent mode
		const useToolAgent = typeof process !== 'undefined' && process.env?.USE_TOOL_AGENT === 'true';
		if (useToolAgent && 'setToolExecutor' in client) {
			let {toolBridge} = get();
			let isNewBridge = false;
			if (!toolBridge) {
				toolBridge = new ToolBridge();
				set({toolBridge});
				isNewBridge = true;
			}

			// Type-safe narrowing: we already checked 'setToolExecutor' in client above
			const agentClient = client as unknown as AgentLLMClient;

			// Only discover tools once when bridge is first created
			if (isNewBridge) {
				let tools: {name: string; description: string; server: string; input_schema: Record<string, unknown>}[] = [];
				let formattedTools: {name: string; description: string; input_schema: Record<string, unknown>}[] = [];
				try {
					tools = await toolBridge.discoverTools();
					formattedTools = await toolBridge.formatForLLM();
					console.log(`[TUI] ToolBridge connected with ${tools.length} tools`);
				} catch (discoveryError) {
					console.error('[TUI] Tool discovery failed:', discoveryError);
					// Continue with empty tools - agent will work without tools
				}
				agentClient.setTools(formattedTools);
			}

			// Set up tool executor callback
			agentClient.setToolExecutor(async (toolCall) => {
				// Generate unique call ID for this execution
				const callId = `${toolCall.name}_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;

				// Update active tool calls for UI
				const currentCalls = get().activeToolCalls;
				set({
					activeToolCalls: [
						...currentCalls,
						{id: callId, name: toolCall.name, status: 'running'},
					],
				});

				let result;
				const TOOL_TIMEOUT_MS = 30000; // 30 second timeout
				try {
					// Execute the tool with timeout
					const timeoutPromise = new Promise<never>((_, reject) => {
						setTimeout(() => reject(new Error(`Tool execution timeout after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS);
					});
					result = await Promise.race([
						toolBridge.executeTool(toolCall.name, toolCall.input),
						timeoutPromise
					]);
				} catch (execError) {
					result = {
						success: false,
						error: execError instanceof Error ? execError.message : String(execError),
						tool: toolCall.name,
						server: 'unknown',
						timestamp: Date.now(),
					};
				}

				// Update tool call status by unique ID
				const updatedCalls = get().activeToolCalls.map(call =>
					call.id === callId
						? {...call, status: (result.success ? 'success' : 'error') as ToolCall['status'], result: result.success ? JSON.stringify(result.data) : undefined, error: result.error}
						: call,
				);
				set({activeToolCalls: updatedCalls});

				// Store successful tool call for !! shortcut (repeat last tool)
				if (result.success) {
					set({
						lastToolCall: {
							name: toolCall.name,
							input: toolCall.input,
							timestamp: Date.now(),
						},
					});
				}

				// Add tool result message to conversation
				const resultContent = result.success
					? `Tool "${toolCall.name}" completed successfully`
					: `Tool "${toolCall.name}" failed: ${result.error || 'Unknown error'}`;

				// TODO: Tool results displayed as 'assistant' for UI compatibility
			// GLM agent client maintains separate message history for LLM API
			get().addMessage({
					id: Math.random().toString(36).substring(7),
					role: 'assistant',
					content: `[Tool Result] ${resultContent}`,
					timestamp: Date.now(),
					toolCalls: [{id: callId, name: toolCall.name, status: (result.success ? 'success' : 'error') as ToolCall['status']}],
				});

				return {
					toolUseId: toolCall.id,
					content: result.success
						? JSON.stringify(result.data)
						: result.error || 'Unknown error',
					isError: !result.success,
				};
			});
		}

		// Create assistant message for streaming
		const assistantId = Math.random().toString(36).substring(7);
		const assistantMessage: ChatMessage = {
			id: assistantId,
			role: 'assistant',
			content: '',
			timestamp: Date.now(),
			streaming: true,
		};

		// Add empty assistant message that will be updated
		set(state => ({
			messages: [...state.messages, assistantMessage],
			connectionStatus: 'online',
		}));

		try {
			let fullResponse = '';
			const parser = new TuiTagParser(['thinking']);
			let inThinking = false;

			await client.sendMessage(content, (chunk: string) => {
				for (const event of parser.process(chunk)) {
					if (event.type === 'tag_open' && event.tagName === 'thinking') {
						inThinking = true;
						// Update whimsical phrase for each new thinking block
						const newPhrase = getRandomPhraseUnique(get().whimsicalPhrase ?? undefined);
						set({isThinking: true, whimsicalPhrase: newPhrase});
						continue;
					}

					if (event.type === 'tag_close' && event.tagName === 'thinking') {
						inThinking = false;
						// Brief pause after thinking
						set({isThinking: false, whimsicalPhrase: null});
						continue;
					}

					if (event.type === 'text' && event.content) {
						if (inThinking) {
							// Thinking content is suppressed from main transcript but keeps thinking status active
							continue;
						}

						// Actual text content
						fullResponse += event.content;
						
						// If we were thinking but now have text, clear thinking state
						if (get().isThinking) {
							set({isThinking: false, whimsicalPhrase: null});
						}

						// Update the streaming message with new content
						set(state => ({
							messages: state.messages.map(msg =>
								msg.id === assistantId
									? {...msg, content: fullResponse, streaming: true}
									: msg,
							),
						}));
					}
				}
			});

			// Final update - mark streaming complete and clear active tool calls
			set(state => ({
				messages: state.messages.map(msg =>
					msg.id === assistantId ? {...msg, streaming: false} : msg,
				),
				isThinking: false,
				whimsicalPhrase: null,
				activeToolCalls: [], // Clear completed tool calls
			}));

			return fullResponse;
		} catch (error) {
			console.error('Failed to send message:', error);

			// Remove the incomplete assistant message on error and clear tool calls
			set(state => ({
				messages: state.messages.filter(msg => msg.id !== assistantId),
				isThinking: false,
				connectionStatus: 'offline',
				activeToolCalls: [], // Clear any stuck tool calls on error
			}));

			throw error;
		}
	},
	undoLastExchange: () =>
		set(state => ({
			messages: state.messages.slice(0, -2),
		})),

	// Persistence actions
	initialize: async () => {
		if (get()._initialized) return;

		const cached = await initializeState();
		if (cached.mode) set({mode: cached.mode});
		if (cached.thinkingEnabled !== undefined)
			set({thinkingEnabled: cached.thinkingEnabled});
		if (cached.provider) set({provider: cached.provider});
		if (cached.model) set({model: cached.model});
		if (cached.recentMessages) set({messages: cached.recentMessages});

		set({_initialized: true});
	},

	savePreferences: async () => {
		const {mode, thinkingEnabled, provider, model} = get();
		await saveState({mode, thinkingEnabled, provider, model});
	},

	loadPreferences: async () => {
		const cached = await loadPersistedState();
		if (cached.mode) set({mode: cached.mode});
		if (cached.thinkingEnabled !== undefined)
			set({thinkingEnabled: cached.thinkingEnabled});
		if (cached.provider) set({provider: cached.provider});
		if (cached.model) set({model: cached.model});
		if (cached.recentMessages) set({messages: cached.recentMessages});
	},

	clearPreferences: async () => {
		await clearPersistedState();
		// Reset to defaults
		set({
			mode: 'ask',
			thinkingEnabled: true,
			provider: 'glm',
			model: 'GLM-4.7',
		});
	},

	initializeToolBridge: async () => {
		const bridge = new ToolBridge();
		set({toolBridge: bridge});
		console.log('[TUI] ToolBridge initialized');
	},

	setActiveToolCalls: (toolCalls: ToolCall[]) => {
		set({activeToolCalls: toolCalls});
	},

	// !! - Repeat last tool call shortcut
	repeatLastTool: async () => {
		const {lastToolCall, toolBridge} = get();

		if (!lastToolCall) {
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: '⚠️ No previous tool call to repeat. Use a tool first, then !! will replay it.',
				timestamp: Date.now(),
			});
			return;
		}

		if (!toolBridge) {
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: '⚠️ ToolBridge not initialized.',
				timestamp: Date.now(),
			});
			return;
		}

		// Generate call ID
		const callId = `${lastToolCall.name}_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;

		// Add to active calls
		set(state => ({
			activeToolCalls: [
				...state.activeToolCalls,
				{id: callId, name: lastToolCall.name, status: 'running'},
			],
		}));

		get().addMessage({
			id: Math.random().toString(36).substring(7),
			role: 'system',
			content: `🔄 Repeating tool: ${lastToolCall.name}`,
			timestamp: Date.now(),
		});

		try {
			const result = await toolBridge.executeTool(lastToolCall.name, lastToolCall.input);

			// Update status
			set(state => ({
				activeToolCalls: state.activeToolCalls.map(call =>
					call.id === callId
						? {...call, status: 'success' as const, result: JSON.stringify(result).slice(0, 200)}
						: call,
				),
			}));

			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'assistant',
				content: `[Tool Result] ${lastToolCall.name} completed successfully`,
				timestamp: Date.now(),
				toolCalls: [{id: callId, name: lastToolCall.name, status: 'success'}],
			});
		} catch (error) {
			set(state => ({
				activeToolCalls: state.activeToolCalls.map(call =>
					call.id === callId
						? {...call, status: 'error' as const, error: String(error)}
						: call,
				),
			}));

			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: `❌ Tool "${lastToolCall.name}" failed: ${error}`,
				timestamp: Date.now(),
			});
		}
	},

	// !* - Execute all pending tool calls (batch approve)
	executeAllPendingTools: async () => {
		const {toolBridge, activeToolCalls} = get();

		if (!toolBridge) {
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: '⚠️ ToolBridge not initialized.',
				timestamp: Date.now(),
			});
			return;
		}

		const pendingCalls = activeToolCalls.filter(call => call.status === 'pending');

		if (pendingCalls.length === 0) {
			get().addMessage({
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: 'ℹ️ No pending tool calls to execute.',
				timestamp: Date.now(),
			});
			return;
		}

		get().addMessage({
			id: Math.random().toString(36).substring(7),
			role: 'system',
			content: `🚀 Executing ${pendingCalls.length} pending tool(s)...`,
			timestamp: Date.now(),
		});

		// Execute all pending tools in parallel
		const executions = pendingCalls.map(async (call) => {
			if (!call.input) return;

			// Update to running
			set(state => ({
				activeToolCalls: state.activeToolCalls.map(c =>
					c.id === call.id ? {...c, status: 'running'} : c,
				),
			}));

			try {
				const result = await toolBridge.executeTool(call.name, call.input);

				// Update to success
				set(state => ({
					activeToolCalls: state.activeToolCalls.map(c =>
						c.id === call.id
							? {...c, status: 'success' as const, result: JSON.stringify(result).slice(0, 200)}
							: c,
					),
				}));

				get().addMessage({
					id: Math.random().toString(36).substring(7),
					role: 'assistant',
					content: `[Tool Result] ${call.name} completed`,
					timestamp: Date.now(),
					toolCalls: [{id: call.id!, name: call.name, status: 'success'}],
				});
			} catch (error) {
				set(state => ({
					activeToolCalls: state.activeToolCalls.map(c =>
						c.id === call.id
							? {...c, status: 'error' as const, error: String(error)}
							: c,
					),
				}));
			}
		});

		await Promise.all(executions);

		get().addMessage({
			id: Math.random().toString(36).substring(7),
			role: 'system',
			content: `✓ Batch execution complete for ${pendingCalls.length} tool(s)`,
			timestamp: Date.now(),
		});
	},
}));
