import * as Ink from 'ink';
import { useState, useEffect } from 'react';
import TextInput from 'ink-text-input';
import { useInput } from 'ink';
import { useTuiStore } from '../store/tui-store.js';

const MODELS = [
	'GLM-4.7',
	'GLM-4.7 Flash',
	'GLM-4.6',
	'GLM-4.6V',
	'GLM-4.5',
	'GLM-4.5-Air',
	'GLM-4.5V',
] as const;

interface Command {
	id: string;
	label: string;
	shortcut: string;
	action?: () => void;
	isModelSelector?: true;
}

const getCommands = (store: ReturnType<typeof useTuiStore.getState>): Command[] => [
	{
		id: 'toggle-thinking',
		label: 'Toggle Thinking Mode',
		shortcut: 'Tab',
		action: () => store.toggleThinking(),
	},
	{
		id: 'cycle-mode',
		label: 'Cycle Execution Mode',
		shortcut: 'Shift+Tab',
		action: () => store.cycleMode(),
	},
	{
		id: 'clear-transcript',
		label: 'Clear Transcript',
		shortcut: 'Ctrl+L',
		action: () => store.clearMessages(),
	},
	{
		id: 'export-transcript',
		label: 'Export Transcript',
		shortcut: 'Ctrl+E',
		action: () => store.exportTranscript(),
	},
	{
		id: 'switch-model',
		label: `Switch Model: ${store.model}`,
		shortcut: '←/→',
		isModelSelector: true,
	},
	{
		id: 'background-tasks',
		label: 'Background Tasks',
		shortcut: 'Ctrl+O',
		action: () => store.setOverlayMode('background'),
	},
	{
		id: 'rewind',
		label: 'Rewind / Restore Checkpoint',
		shortcut: 'Ctrl+Z',
		action: () => store.setOverlayMode('rewind'),
	},
	{
		id: 'create-checkpoint',
		label: 'Create Manual Checkpoint',
		shortcut: '',
		action: async () => {
			// This would need project context - placeholder for now
			console.log('Checkpoint creation would go here');
		},
	},
];

export function CommandPalette() {
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [modelIndex, setModelIndex] = useState(0);
	const store = useTuiStore();
	const closeOverlay = useTuiStore((state) => state.closeOverlay);

	// Find current model index
	useEffect(() => {
		const idx = MODELS.indexOf(store.model as any);
		if (idx >= 0) setModelIndex(idx);
	}, [store.model]);

	const commands = getCommands(store);
	const filteredCommands = commands.filter(cmd =>
		cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    cmd.shortcut.toLowerCase().includes(query.toLowerCase())
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

	// Handle keyboard input for navigation and execution
	useInput((input, key) => {
		// Left/right arrows cycle models when switch-model is selected
		const selectedCmd = filteredCommands[selectedIndex];
		if (selectedCmd?.isModelSelector) {
			if (key.leftArrow) {
				const newIdx = modelIndex > 0 ? modelIndex - 1 : MODELS.length - 1;
				setModelIndex(newIdx);
				store.setModel(MODELS[newIdx]);
				return;
			}
			if (key.rightArrow) {
				const newIdx = (modelIndex + 1) % MODELS.length;
				setModelIndex(newIdx);
				store.setModel(MODELS[newIdx]);
				return;
			}
		}

		// Handle navigation
		if (key.upArrow) {
			setSelectedIndex((prev) =>
				prev > 0 ? prev - 1 : filteredCommands.length - 1
			);
			return;
		}

		if (key.downArrow) {
			setSelectedIndex((prev) =>
				prev < filteredCommands.length - 1 ? prev + 1 : 0
			);
			return;
		}

		// Handle number keys for quick selection
		const num = parseInt(input, 10);
		if (num >= 1 && num <= filteredCommands.length) {
			const cmd = filteredCommands[num - 1];
			if (!cmd.isModelSelector && cmd.action) {
				cmd.action();
				closeOverlay();
			}
			setQuery('');
			return;
		}

		// Execute selected command on Enter
		if (key.return && filteredCommands.length > 0) {
			const cmd = filteredCommands[selectedIndex];
			if (cmd.action) {
				cmd.action();
				closeOverlay();
			}
			setQuery('');
			return;
		}

		// Close on Escape
		if (key.escape) {
			closeOverlay();
			setQuery('');
			return;
		}
	});

	return (
    <Ink.Box
      flexDirection="column"
      borderStyle="double"
      borderColor="#6B50FF"
      paddingX={1}
      width={60}
      height={20}
    >
      <Ink.Box marginBottom={1}>
        <Ink.Text bold>Command Palette</Ink.Text>
        <Ink.Text dimColor> [Esc: Close]</Ink.Text>
      </Ink.Box>

      <Ink.Box marginBottom={1}>
        <Ink.Text color="#FFC107">{'> '}</Ink.Text>
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Type to filter commands..."
        />
      </Ink.Box>

      <Ink.Box flexDirection="column" flexGrow={1}>
        {filteredCommands.length === 0 ? (
          <Ink.Box paddingY={1}>
            <Ink.Text dimColor>No commands found</Ink.Text>
          </Ink.Box>
        ) : (
          filteredCommands.map((cmd, index) => (
            <Ink.Box key={cmd.id} paddingY={0}>
              <Ink.Text
                backgroundColor={index === selectedIndex ? '#6B50FF' : undefined}
                color="#82AAFF"
              >{`[${index + 1}]`}</Ink.Text>
              <Ink.Text
                backgroundColor={index === selectedIndex ? '#6B50FF' : undefined}
                bold={index === selectedIndex}
              > {cmd.label}</Ink.Text>
              <Ink.Text
                backgroundColor={index === selectedIndex ? '#6B50FF' : undefined}
                dimColor
              > ({cmd.shortcut})</Ink.Text>
            </Ink.Box>
          ))
        )}
      </Ink.Box>

      <Ink.Box marginTop={1}>
        <Ink.Text dimColor>
          ↑/↓: Navigate • Enter: Execute • 1-9: Quick select • Esc: Close
        </Ink.Text>
      </Ink.Box>
    </Ink.Box>
  );
}
