import * as Ink from 'ink';

export function HelpOverlay() {
  return (
    <Ink.Box
      flexDirection="column"
      borderStyle="double"
      borderColor="#6B50FF"
      paddingX={2}
      paddingY={1}
      width={90}
      height={30}
    >
      <Ink.Box marginBottom={1}>
        <Ink.Text bold color="#FF60FF">FLOYD - Prefix Commands (47% Gift from Claude)</Ink.Text>
        <Ink.Text dimColor> [Esc: Close]</Ink.Text>
      </Ink.Box>

      <Ink.Box flexDirection="column" gap={1}>
        {/* Bash Mode (!) - 47% Speed Boost */}
        <Ink.Box>
          <Ink.Text bold color="#FF60FF">⚡ Bash Mode (!) - 47% Faster</Ink.Text>
        </Ink.Box>
        <Ink.Box flexDirection="column" marginLeft={2}>
          <Ink.Box>
            <Ink.Text color="#FF60FF">!!        </Ink.Text>
            <Ink.Text>Repeat last tool call instantly</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#FF60FF">!*        </Ink.Text>
            <Ink.Text>Execute all pending tools</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#FF60FF">!c        </Ink.Text>
            <Ink.Text>Continue/complete last task</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#FF60FF">!u        </Ink.Text>
            <Ink.Text>Undo last action</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#FF60FF">!r        </Ink.Text>
            <Ink.Text>Redo last action</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#FFC107">!cmd      </Ink.Text>
            <Ink.Text>Execute shell command directly</Ink.Text>
          </Ink.Box>
        </Ink.Box>

        {/* Preset Tools */}
        <Ink.Box marginTop={1}>
          <Ink.Text bold color="#4CAF50">🔧 Preset Tools (! shorthand)</Ink.Text>
        </Ink.Box>
        <Ink.Box flexDirection="column" marginLeft={2}>
          <Ink.Box>
            <Ink.Text color="#4CAF50">!test     </Ink.Text>
            <Ink.Text>Run test suite</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#4CAF50">!build    </Ink.Text>
            <Ink.Text>Build project</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#4CAF50">!lint     </Ink.Text>
            <Ink.Text>Run linter</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#4CAF50">!git_status</Ink.Text>
            <Ink.Text>Show git status</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#4CAF50">!git_diff </Ink.Text>
            <Ink.Text>Show git diff</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#4CAF50">!ls       </Ink.Text>
            <Ink.Text>List project structure</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#4CAF50">!cache_stats</Ink.Text>
            <Ink.Text>Show cache statistics</Ink.Text>
          </Ink.Box>
        </Ink.Box>

        {/* Slash Commands (/) */}
        <Ink.Box marginTop={1}>
          <Ink.Text bold color="#2196F3">📋 Slash Commands (/)</Ink.Text>
        </Ink.Box>
        <Ink.Box flexDirection="column" marginLeft={2}>
          <Ink.Box>
            <Ink.Text color="#2196F3">/help     </Ink.Text>
            <Ink.Text>Show this help message</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/explain  </Ink.Text>
            <Ink.Text>Explain a topic</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/commit   </Ink.Text>
            <Ink.Text>Create git commit</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/diff     </Ink.Text>
            <Ink.Text>Show git diff</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/status   </Ink.Text>
            <Ink.Text>Show git status</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/clear    </Ink.Text>
            <Ink.Text>Clear conversation</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/tools    </Ink.Text>
            <Ink.Text>List available tools</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/mode     </Ink.Text>
            <Ink.Text>Switch execution mode</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#2196F3">/whoami   </Ink.Text>
            <Ink.Text>Show current configuration</Ink.Text>
          </Ink.Box>
        </Ink.Box>

        {/* Agent/Tool/File Modes */}
        <Ink.Box marginTop={1}>
          <Ink.Text bold color="#FFC107">Other Prefix Modes</Ink.Text>
        </Ink.Box>
        <Ink.Box flexDirection="column" marginLeft={2}>
          <Ink.Box>
            <Ink.Text color="#9C27B0">@agent [task]</Ink.Text>
            <Ink.Text>Delegate to sub-agent (future)</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#FF9800">&amp;tool [args]</Ink.Text>
            <Ink.Text>Direct tool invocation (future)</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#00BCD4">&gt;file</Ink.Text>
            <Ink.Text>Include file in context</Ink.Text>
          </Ink.Box>
        </Ink.Box>

        {/* Execution Modes */}
        <Ink.Box marginTop={1}>
          <Ink.Text bold color="#82AAFF">⌨️ Keyboard Shortcuts</Ink.Text>
        </Ink.Box>
        <Ink.Box flexDirection="column" marginLeft={2}>
          <Ink.Box>
            <Ink.Text color="#82AAFF">Ctrl+Q    </Ink.Text>
            <Ink.Text>Exit application</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#82AAFF">Ctrl+/    </Ink.Text>
            <Ink.Text>Toggle help overlay</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#82AAFF">Ctrl+P    </Ink.Text>
            <Ink.Text>Open command palette</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#82AAFF">Shift+Tab </Ink.Text>
            <Ink.Text>Cycle execution mode</Ink.Text>
          </Ink.Box>
          <Ink.Box>
            <Ink.Text color="#82AAFF">Tab       </Ink.Text>
            <Ink.Text>Toggle thinking mode</Ink.Text>
          </Ink.Box>
        </Ink.Box>
      </Ink.Box>
    </Ink.Box>
  );
}
