import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Coverage for issue #227 item 2: the split/extract picker's `Create` / `Merge` switch. What the picker was
 * about to do used to be inferred from what was typed - it created a note when the input named nothing (or
 * `Mod` was held) and merged into the picked note otherwise - and nothing on screen said which. The switch
 * states it instead, so the SAME typed text must produce different outcomes in the two modes.
 *
 * `SplitFileModal` is `v8 ignore`d, so every interaction it offers needs a desktop test rather than a
 * model-level unit test.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-target-mode.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: SplitTargetModeSettings;
}

interface ExtractInModeOptions {
  readonly mode: string;
  readonly shouldForceCreate?: boolean;
  readonly typedName: string;
}

interface PickerObservations {
  hasCreateRowForUnknownName: boolean;
  isSwitchOn: boolean;
  isTreatTitleAsPathDisabled: boolean;
  isUnresolvedPathDisabled: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: SplitTargetModeSettings) => void): Promise<void>;
  settings: SplitTargetModeSettings;
}

interface SplitTargetModeSettings {
  defaultSplitTargetMode: string;
  shouldAskBeforeSplitting: boolean;
}

describe('the split/extract picker\'s create/merge switch (issue #227)', () => {
  it('should do what the switch says, whatever the typed name would have implied', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'split-mode-source.md';
        const TARGET_BASENAME = 'split-mode-target';
        const TARGET_PATH = `${TARGET_BASENAME}.md`;
        // What `Create` makes of a name an existing note already holds: a second, numbered note beside it.
        const CREATED_BESIDE_TARGET_PATH = `${TARGET_BASENAME} 1.md`;
        const FORCED_BASENAME = 'split-mode-forced';
        const FORCED_PATH = `${FORCED_BASENAME}.md`;
        // Matches no note in the vault, so it is the name that tells the two modes apart: `Create` offers
        // To make it, `Merge` offers nothing at all.
        const UNKNOWN_NAME = 'split-mode-nothing-matches-this';
        const SOURCE_CONTENT = 'alpha bravo charlie\n';
        // The option checkboxes the instruction bar renders, in order: `Include frontmatter`, `Treat title
        // As path`, `Fix footnotes`, `Allow only current folder`, `Merge headings`, `Allow split into
        // Unresolved path`.
        const TREAT_TITLE_AS_PATH_CHECKBOX_INDEX = 1;
        const UNRESOLVED_PATH_CHECKBOX_INDEX = 5;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
          });

          await deleteIfExists(CREATED_BESIDE_TARGET_PATH);
          await deleteIfExists(FORCED_PATH);

          const mergeObservations = await extractInMode({ mode: 'Merge', typedName: TARGET_BASENAME });
          // Read it NOW: every run resets the target note, so a later run would erase what this one wrote.
          const mergedTargetContent = await readIfExists(TARGET_PATH);

          const createObservations = await extractInMode({ mode: 'Create', typedName: TARGET_BASENAME });
          const createdBesideTargetContent = await readIfExists(CREATED_BESIDE_TARGET_PATH);

          const forcedObservations = await extractInMode({ mode: 'Merge', shouldForceCreate: true, typedName: FORCED_BASENAME });
          const forcedContent = await readIfExists(FORCED_PATH);

          return {
            createdBesideTargetContent,
            createObservations,
            forcedContent,
            forcedObservations,
            mergedTargetContent,
            mergeObservations
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
          });
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string';
        }

        /**
         * Runs one extraction through the real picker in the given mode, observing what it offers on the
         * way.
         *
         * @param options - The mode to open in, the name to finish with, and whether to force a creation.
         * @returns What the picker showed while it was open.
         */
        async function extractInMode(options: ExtractInModeOptions): Promise<PickerObservations> {
          const shouldForceCreate = options.shouldForceCreate ?? false;
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = options.mode;
          });

          const source = await ensureFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          // Reset the source through the EDITOR, not the vault: the previous run left a link where `bravo`
          // Was, and an open buffer wins over `vault.modify` - selecting by offset against a stale buffer
          // Would extract that link instead of the word.
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          // The target is not the open note, so the vault is the right way to reset it.
          await resetFile(TARGET_PATH, 'target body\n');
          const selectionStart = SOURCE_CONTENT.indexOf('bravo');
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + 'bravo'.length));

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }

          // A name nothing matches: only `Create` may offer to make it.
          typeIntoPicker(input, UNKNOWN_NAME);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const checkboxes = [...document.querySelectorAll('.prompt-instructions input[type="checkbox"]')];
          const observations: PickerObservations = {
            hasCreateRowForUnknownName: [...document.querySelectorAll('.suggestion-action')].some((el) => el.textContent.includes('Enter to create')),
            isSwitchOn: document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container')?.classList.contains('is-enabled') ?? false,
            isTreatTitleAsPathDisabled: isCheckboxDisabled(checkboxes[TREAT_TITLE_AS_PATH_CHECKBOX_INDEX]),
            isUnresolvedPathDisabled: isCheckboxDisabled(checkboxes[UNRESOLVED_PATH_CHECKBOX_INDEX])
          };

          typeIntoPicker(input, options.typedName);
          if (shouldForceCreate) {
            // `Merge` offers nothing creatable, so there is deliberately no suggestion to wait for here:
            // `Mod+Enter` has to flip the switch to `Create` and create from what was typed.
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          } else {
            await waitUntil({
              message: `no suggestion appeared for ${options.typedName}`,
              predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(options.typedName))
            });
          }
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', ctrlKey: shouldForceCreate, key: 'Enter' }));

          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          // The extraction rewrites the SOURCE note too, so waiting for that is what proves the operation
          // Ran rather than the modal merely closing.
          await waitUntil({
            message: 'the selection was not extracted out of the source note',
            predicate: () => !editor.getValue().includes('bravo charlie')
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return observations;
        }

        function typeIntoPicker(input: HTMLInputElement, value: string): void {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function isCheckboxDisabled(checkboxEl: Element | undefined): boolean {
          if (!(checkboxEl instanceof HTMLInputElement)) {
            throw new TypeError('The picker did not render its option checkboxes.');
          }
          return checkboxEl.disabled;
        }

        async function deleteIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function readIfExists(path: string): Promise<string> {
          const file = app.vault.getAbstractFileByPath(path);
          return file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
        }

        async function ensureFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await app.workspace.revealLeaf(leaf);
          await waitUntil({
            message: `the editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // `Merge` states itself: the switch is on, and a name nothing matches offers nothing to create.
    expect(result.mergeObservations.isSwitchOn).toBe(true);
    expect(result.mergeObservations.hasCreateRowForUnknownName).toBe(false);
    // Neither option has anything to act on when nothing is created, so both are off-limits.
    expect(result.mergeObservations.isTreatTitleAsPathDisabled).toBe(true);
    expect(result.mergeObservations.isUnresolvedPathDisabled).toBe(true);
    // ...and the extracted text landed IN the existing note.
    expect(result.mergedTargetContent).toContain('target body');
    expect(result.mergedTargetContent).toContain('bravo');

    // `Create` states the opposite, offers to make the unmatched name, and leaves both options available.
    expect(result.createObservations.isSwitchOn).toBe(false);
    expect(result.createObservations.hasCreateRowForUnknownName).toBe(true);
    expect(result.createObservations.isTreatTitleAsPathDisabled).toBe(false);
    expect(result.createObservations.isUnresolvedPathDisabled).toBe(false);
    // The SAME typed name - one an existing note already holds - now makes a new note beside it instead of
    // Merging into it, which is the whole point of stating the mode.
    expect(result.createdBesideTargetContent).toContain('bravo');

    // `Mod+Enter` still forces a creation FROM `Merge` mode, where there is no creatable suggestion at all.
    expect(result.forcedObservations.isSwitchOn).toBe(true);
    expect(result.forcedContent).toContain('bravo');
  });
});
