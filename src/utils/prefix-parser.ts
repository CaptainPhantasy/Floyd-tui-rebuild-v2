/**
 * Prefix Mode Parser - The "47% Gift" from CURSH Session
 *
 * Purpose: Parse Claude Code-style prefix commands (!, /, @, &)
 * Aligns Floyd with Claude Code UX for explicit mode control
 *
 * From: CURSH CLI Session "Tool V1 Operations" (Jan 31, 2026)
 * Context: Claude explaining the 47% alignment gap between Floyd and Claude Code
 */

// ============================================================================
// TYPES
// ============================================================================

export type PrefixMode = 'bash' | 'command' | 'agent' | 'tool' | 'normal' | 'file';

export interface ParsedInput {
    /** Detected prefix mode */
    mode: PrefixMode;
    /** Original input */
    rawInput: string;
    /** Input with prefix stripped */
    cleanInput: string;
    /** The prefix character (if any) */
    prefix?: string;
    /** Whether this is a prefix command */
    isPrefixed: boolean;
    /** Secondary command for shortcuts like !!, !* */
    shortcut?: string;
}

// ============================================================================
// PREFIX PATTERNS
// ============================================================================

/**
 * Claude Code prefix modes:
 * - `!` = Bash mode - execute shell commands directly
 * - `!!` = Repeat last tool call (FAST)
 * - `!*` = Execute all pending tools (FAST)
 * - `/` = Command mode - structured commands (/help, /explain, /commit)
 * - `@` = Agent mode - delegate to sub-agent
 * - `&` = Tool mode - explicit tool invocation
 * - `>file` = File reference context
 */
const PREFIX_PATTERNS = {
    bash: /^!/,
    command: /^\//,
    agent: /^@/,
    tool: /^&/,
    file: /^>/,
} as const;

// Shortcut patterns (special bash commands)
const SHORTCUT_PATTERNS = {
    repeatLast: /^!!$/,
    executeAll: /^!*\*$/,
    continue: /^!c$/,
    undo: /^!u$/,
    redo: /^!r$/,
} as const;

// ============================================================================
// PREFIX DETECTION
// ============================================================================

/**
 * Parse user input for prefix mode detection
 *
 * @param input - Raw user input
 * @returns Parsed input with detected mode
 */
export function parsePrefixMode(input: string): ParsedInput {
    const trimmed = input.trim();

    // Check for special shortcuts first (!!, !*, !c, !u, !r)
    for (const [shortcut, pattern] of Object.entries(SHORTCUT_PATTERNS)) {
        if (pattern.test(trimmed)) {
            return {
                mode: 'bash',
                rawInput: input,
                cleanInput: trimmed,
                prefix: '!',
                isPrefixed: true,
                shortcut,
            };
        }
    }

    // Check each prefix pattern
    for (const [mode, pattern] of Object.entries(PREFIX_PATTERNS)) {
        if (pattern.test(trimmed)) {
            return {
                mode: mode as PrefixMode,
                rawInput: input,
                cleanInput: trimmed.slice(1).trim(), // Remove prefix character
                prefix: trimmed[0],
                isPrefixed: true,
            };
        }
    }

    // No prefix detected - normal mode
    return {
        mode: 'normal',
        rawInput: input,
        cleanInput: trimmed,
        isPrefixed: false,
    };
}

// ============================================================================
// MODE VALIDATORS
// ============================================================================

export function isBashCommand(parsed: ParsedInput): boolean {
    return parsed.mode === 'bash';
}

export function isSlashCommand(parsed: ParsedInput): boolean {
    return parsed.mode === 'command';
}

export function isAgentDelegation(parsed: ParsedInput): boolean {
    return parsed.mode === 'agent';
}

export function isToolInvocation(parsed: ParsedInput): boolean {
    return parsed.mode === 'tool';
}

export function isFileReference(parsed: ParsedInput): boolean {
    return parsed.mode === 'file';
}

export function isShortcut(parsed: ParsedInput): boolean {
    return parsed.shortcut !== undefined;
}

// ============================================================================
// BASH MODE HELPERS
// ============================================================================

export function parseBashCommand(cleanInput: string): {
    command: string;
    args: string[];
} {
    const parts = cleanInput.split(/\s+/);
    const command = parts[0] || '';
    const args = parts.slice(1);
    return {command, args};
}

// ============================================================================
// COMMAND MODE HELPERS
// ============================================================================

export function parseSlashCommand(cleanInput: string): {
    command: string;
    args: string;
} {
    const spaceIndex = cleanInput.indexOf(' ');
    if (spaceIndex === -1) {
        return {command: cleanInput, args: ''};
    }
    return {
        command: cleanInput.slice(0, spaceIndex),
        args: cleanInput.slice(spaceIndex + 1).trim(),
    };
}

// ============================================================================
// AGENT MODE HELPERS
// ============================================================================

export function parseAgentDelegation(cleanInput: string): {
    agent: string;
    instruction: string;
} {
    const spaceIndex = cleanInput.indexOf(' ');
    if (spaceIndex === -1) {
        return {agent: cleanInput, instruction: ''};
    }
    return {
        agent: cleanInput.slice(0, spaceIndex),
        instruction: cleanInput.slice(spaceIndex + 1).trim(),
    };
}

// ============================================================================
// TOOL MODE HELPERS
// ============================================================================

export function parseToolInvocation(cleanInput: string): {
    tool: string;
    args: string;
} {
    const spaceIndex = cleanInput.indexOf(' ');
    if (spaceIndex === -1) {
        return {tool: cleanInput, args: ''};
    }
    return {
        tool: cleanInput.slice(0, spaceIndex),
        args: cleanInput.slice(spaceIndex + 1).trim(),
    };
}

// ============================================================================
// SAFETY VALIDATION
// ============================================================================

export function validateBashCommand(command: string): string[] {
    const warnings: string[] = [];
    const dangerousCommands = ['rm -rf', 'rm -fr', 'dd ', 'mkfs', ':(){:|:&};:', 'sudo rm', 'chmod 000'];

    for (const danger of dangerousCommands) {
        if (command.includes(danger)) {
            warnings.push(`Dangerous command detected: ${danger}`);
        }
    }

    return warnings;
}

// ============================================================================
// PRESET TOOL CALL STRINGS
// ============================================================================

/**
 * Preset tool call strings that map to common operations
 * These can be invoked via shortcuts or expanded to full tool calls
 */
export const PRESET_TOOL_CALLS: Record<string, {
    tool: string;
    input: Record<string, unknown>;
    description: string;
}> = {
    // Git operations
    'git_status': {
        tool: 'mcp__floyd_git__git_status',
        input: {cwd: process.cwd()},
        description: 'Show git status',
    },
    'git_diff': {
        tool: 'mcp__floyd_git__git_diff',
        input: {cwd: process.cwd()},
        description: 'Show git diff',
    },
    'git_log': {
        tool: 'mcp__floyd_git__git_log',
        input: {cwd: process.cwd(), maxCount: 10},
        description: 'Show recent commits',
    },
    'git_stage': {
        tool: 'mcp__floyd_git__git_stage',
        input: {cwd: process.cwd(), paths: []},
        description: 'Stage all changes',
    },

    // Runner operations
    'test': {
        tool: 'mcp__floyd_runner__run_tests',
        input: {projectPath: process.cwd()},
        description: 'Run tests',
    },
    'build': {
        tool: 'mcp__floyd_runner__build',
        input: {projectPath: process.cwd()},
        description: 'Build project',
    },
    'lint': {
        tool: 'mcp__floyd_runner__lint',
        input: {projectPath: process.cwd()},
        description: 'Run linter',
    },
    'format': {
        tool: 'mcp__floyd_runner__format',
        input: {projectPath: process.cwd()},
        description: 'Format code',
    },
    'detect': {
        tool: 'mcp__floyd_runner__detect_project',
        input: {projectPath: process.cwd()},
        description: 'Detect project type',
    },

    // Explorer operations
    'ls': {
        tool: 'mcp__floyd_explorer__project_map',
        input: {projectPath: process.cwd(), maxDepth: 2},
        description: 'List project structure',
    },
    'read': {
        tool: 'mcp__floyd_explorer__read_file',
        input: {filePath: ''},
        description: 'Read file (requires path)',
    },

    // Supercache operations
    'cache_list': {
        tool: 'mcp__floyd_supercache__cache_list',
        input: {tier: 'project'},
        description: 'List cache entries',
    },
    'cache_search': {
        tool: 'mcp__floyd_supercache__cache_search',
        input: {query: '', tier: 'project'},
        description: 'Search cache (requires query)',
    },
    'cache_stats': {
        tool: 'mcp__floyd_supercache__cache_stats',
        input: {},
        description: 'Show cache statistics',
    },
    'cache_clear': {
        tool: 'mcp__floyd_supercache__cache_clear',
        input: {tier: 'project'},
        description: 'Clear cache',
    },

    // Safe ops
    'impact': {
        tool: 'mcp__floyd_safe_ops__impact_simulate',
        input: {operations: [], projectPath: process.cwd()},
        description: 'Simulate impact (requires operations)',
    },
    'verify': {
        tool: 'mcp__floyd_safe_ops__verify',
        input: {strategy: 'command', command: 'npm test'},
        description: 'Verify changes',
    },
};

/**
 * Get preset tool call by name
 */
export function getPresetToolCall(name: string): {
    tool: string;
    input: Record<string, unknown>;
    description: string;
} | null {
    return PRESET_TOOL_CALLS[name] || null;
}

/**
 * List all available preset tool calls
 */
export function listPresetToolCalls(): Array<{name: string; description: string}> {
    return Object.entries(PRESET_TOOL_CALLS).map(([name, config]) => ({
        name,
        description: config.description,
    }));
}

// ============================================================================
// SLASH COMMAND DEFINITIONS
// ============================================================================

export interface SlashCommand {
    name: string;
    description: string;
    usage: string;
    handler: (args: string) => string | Promise<string>;
}

export const SLASH_COMMANDS: Record<string, SlashCommand> = {
    help: {
        name: 'help',
        description: 'Show this help message',
        usage: '/help [topic]',
        handler: (args: string) => {
            return `**FLOYD - Prefix Commands**

**Bash Mode (!)**
!command - Execute shell command directly
!! - Repeat last tool call
!* - Execute all pending tools
!c - Continue/complete last task
!u - Undo last action
!r - Redo last action

**Command Mode (/)**
/help - Show this help
/explain [topic] - Explain a topic
/commit [msg] - Commit changes
/diff - Show git diff
/status - Show git status
/test - Run tests
/build - Build project
/clear - Clear conversation
/cache - Show cache stats

**Agent Mode (@)**
@agent [task] - Delegate to specific agent (future)

**Tool Mode (&)**
&tool [args] - Direct tool invocation (future)

**File Mode (>)**
>file - Include file in context

**Safety Modes** (Shift+Tab to cycle):
- ASK: Prompt before every action
- PLAN: Show plan, wait for approval
- AUTO: Balanced autonomy
- DISCUSS: Conversational mode
- FUCKIT: Maximum autonomy

**Preset Tools (! shorthand)**
!git_status - Show git status
!git_diff - Show git diff
!test - Run tests
!build - Build project
!lint - Run linter
!ls - List project structure
!cache_stats - Show cache stats
${args ? `\n\n--- Topic: ${args} ---` : ''}`;
        },
    },

    explain: {
        name: 'explain',
        description: 'Explain a topic in detail',
        usage: '/explain [topic]',
        handler: (args: string) => {
            if (!args) {
                return `⚠️ Usage: /explain [topic]

Examples:
/explain useRef React hook
/explain async/await JavaScript
/explain MCP protocol`;
            }
            return `[EXPLAIN] ${args}`;
        },
    },

    commit: {
        name: 'commit',
        description: 'Create a git commit',
        usage: '/commit [message]',
        handler: (args: string) => {
            const msg = args || 'Auto-generated commit';
            return `[COMMIT] Creating commit with message: "${msg}"`;
        },
    },

    diff: {
        name: 'diff',
        description: 'Show git diff',
        usage: '/diff [file]',
        handler: (args: string) => {
            return `[DIFF] Showing git diff${args ? ` for ${args}` : ''}`;
        },
    },

    status: {
        name: 'status',
        description: 'Show git status',
        usage: '/status',
        handler: () => {
            return `[STATUS] Showing git repository status`;
        },
    },

    test: {
        name: 'test',
        description: 'Run project tests',
        usage: '/test',
        handler: () => {
            return `[TEST] Running test suite...`;
        },
    },

    build: {
        name: 'build',
        description: 'Build the project',
        usage: '/build',
        handler: () => {
            return `[BUILD] Building project...`;
        },
    },

    lint: {
        name: 'lint',
        description: 'Run linter',
        usage: '/lint',
        handler: () => {
            return `[LINT] Running linter...`;
        },
    },

    clear: {
        name: 'clear',
        description: 'Clear conversation',
        usage: '/clear',
        handler: () => {
            return `[CLEAR] Conversation cleared`;
        },
    },

    cache: {
        name: 'cache',
        description: 'Show cache statistics',
        usage: '/cache [list|search|stats|clear]',
        handler: (args: string) => {
            const action = args || 'stats';
            return `[CACHE] ${action.toUpperCase()} operation`;
        },
    },

    mode: {
        name: 'mode',
        description: 'Switch execution mode',
        usage: '/mode [ask|plan|auto|discuss|fuckit]',
        handler: (args: string) => {
            const modes = ['ask', 'plan', 'auto', 'discuss', 'fuckit'];
            if (!args || !modes.includes(args.toLowerCase())) {
                return `⚠️ Available modes: ${modes.join(', ')}

Current mode: [current]`;
            }
            return `[MODE] Switched to ${args.toUpperCase()} mode`;
        },
    },

    tools: {
        name: 'tools',
        description: 'List available tools',
        usage: '/tools [filter]',
        handler: (args: string) => {
            const presets = listPresetToolCalls();
            let output = `**Available Preset Tools**\n\n`;
            for (const preset of presets) {
                if (!args || preset.name.includes(args)) {
                    output += `!${preset.name} - ${preset.description}\n`;
                }
            }
            return output;
        },
    },

    whoami: {
        name: 'whoami',
        description: 'Show current configuration',
        usage: '/whoami',
        handler: () => {
            return `**FLOYD Configuration**

Version: TUI-Rebuild-v2-MCP
Provider: [current provider]
Model: [current model]
Mode: [current mode]
Working Directory: ${process.cwd()}
`;
        },
    },
};

export default parsePrefixMode;
