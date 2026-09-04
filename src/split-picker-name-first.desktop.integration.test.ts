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
 * Coverage for issue #238: in `Create` mode the split/extract picker took a destination before it had a
 * name. The reporter erased the seeded heading name, clicked an existing note in the list, and got an
 * `Untitled` note in Obsidian's default new-note location - the note they clicked was read for nothing.
 *
 * Both halves of the fix are picker behavior, and `SplitFileModal` is `v8 ignore`d, so neither is observable
 * from a model-level unit test:
 * - an unnamed creation cannot be chosen at all, and says so;
 * - the note that IS picked names the folder the new note is created in.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-picker-name-first.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: NameFirstSettings;
}

interface NameFirstSettings {
  defaultSplitTargetMode: string;
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldSplitHeadingsAutomatically: boolean;
  shouldSplitIntoFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: NameFirstSettings) => void): Promise<void>;
  settings: NameFirstSettings;
}

describe('the split/extract picker asks for a name before a destination (issue #238)', () => {
  it('refuses to choose anything while a creation has no name, and says why', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive on purpose: the whole aggregate run shares ONE vault, so a generic name here would
        // Make another suite's link ambiguous.
        const SOURCE_PATH = 'split-picker-name-first-source.md';
        const SIBLING_PATH = 'split-picker-name-first-folder/split-picker-name-first-sibling.md';
        const HEADING = 'split-picker-name-first-heading';
        const SOURCE_CONTENT = `# Note\n\n## ${HEADING}\nrefusal body one\nrefusal body two\n`;
        const HEADING_LINE_INDEX = 2;
        const HEADING_COUNT = 2;
        // What an unnamed creation used to produce, in the folder Obsidian's own new-file resolution picks.
        const UNTITLED_PATH = 'Untitled.md';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            // The picker has to actually OPEN: with headings split automatically, `Extract this heading...`
            // Skips it entirely and there is no box to observe.
            settings.shouldSplitHeadingsAutomatically = false;
            settings.defaultSplitTargetMode = 'Create';
          });

          await ensureFolder('split-picker-name-first-folder');
          const sibling = await resetFile(SIBLING_PATH, 'sibling body\n');
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);

          // Opening the sibling FIRST puts it in Obsidian's recent files, which is what the picker offers
          // While the box is empty - so the reporter's "click a note with no name typed" has a row to click.
          await openAndGetEditor(sibling);
          const editor = await openAndGetEditor(source);
          // Reset through the EDITOR: an open buffer wins over `vault.modify`, so a line-based cursor would
          // Otherwise land in the previous run's text.
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          await waitUntil({
            message: 'the heading cache is not ready',
            predicate: () => (app.metadataCache.getFileCache(source)?.headings?.length ?? 0) === HEADING_COUNT
          });

          editor.setCursor({ ch: 0, line: HEADING_LINE_INDEX });
          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // With the heading name in the box there is nothing to refuse, and nothing to explain.
          const isHintVisibleWhileNamed = isHintVisible();

          typeIntoPicker('');
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isHintVisibleWhileUnnamed = isHintVisible();

          /*
           * Issue #257 carved the CLICK out of this refusal: a row naming an existing note is unambiguous
           * even with nothing typed, so it now flips the picker to `Merge` and goes through — covered by
           * "chooses an existing note clicked while nothing is typed" below. What stays refused here is
           * every way of choosing that really would be a nameless CREATION, which is what `Enter` is with
           * an empty box.
           */
          const suggestionCount = document.querySelectorAll('.suggestion-item').length;

          await pressEnter();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isPickerOpenAfterEnter = document.querySelector('.prompt') !== null;

          // A space is still no name: `fixFileName` would have turned it into `Untitled` exactly as an
          // Empty box does.
          const BLANK_NAME_LENGTH = 3;
          typeIntoPicker(' '.repeat(BLANK_NAME_LENGTH));
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isHintVisibleWhileBlank = isHintVisible();

          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            isHintVisibleWhileBlank,
            isHintVisibleWhileNamed,
            isHintVisibleWhileUnnamed,
            isPickerOpenAfterEnter,
            suggestionCount,
            // The source keeps its heading: a refused choice must not have extracted anything either.
            wasHeadingExtracted: !editor.getValue().includes(HEADING),
            wasUntitledCreated: app.vault.getAbstractFileByPath(UNTITLED_PATH) !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldSplitHeadingsAutomatically = original.shouldSplitHeadingsAutomatically;
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

        function getPickerInput(): HTMLInputElement {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          return input;
        }

        function isHintVisible(): boolean {
          const hint = document.querySelector('.advanced-note-composer-name-required-hint');
          if (!(hint instanceof HTMLElement)) {
            return false;
          }
          return hint.isShown();
        }

        async function pressEnter(): Promise<void> {
          getPickerInput().focus();
          await pressKey({ key: 'Enter' });
        }

        function typeIntoPicker(value: string): void {
          const input = getPickerInput();
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function ensureFolder(path: string): Promise<void> {
          if (!app.vault.getAbstractFileByPath(path)) {
            await app.vault.createFolder(path);
          }
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

    // The rule is stated only while it applies, so a named creation reads exactly as it did before.
    expect(result.isHintVisibleWhileNamed).toBe(false);
    expect(result.isHintVisibleWhileUnnamed).toBe(true);
    expect(result.isHintVisibleWhileBlank).toBe(true);

    // A row really was there — so the refusal below is about the rule, not an empty list.
    expect(result.suggestionCount).toBeGreaterThan(0);
    expect(result.isPickerOpenAfterEnter).toBe(true);

    // The bug itself: an unnamed creation used to become `Untitled` somewhere the user never chose.
    expect(result.wasUntitledCreated).toBe(false);
    expect(result.wasHeadingExtracted).toBe(false);
  });

  it('creates the new note in the folder of the note picked in the list', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickElement, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'split-picker-name-first-picked-source.md';
        const FOLDER_PATH = 'split-picker-name-first-picked-folder';
        const SIBLING_NAME = 'split-picker-name-first-picked-sibling';
        const SIBLING_PATH = `${FOLDER_PATH}/${SIBLING_NAME}.md`;
        // A PREFIX of the sibling's name, deliberately: the picker's list is what the typed name matches,
        // So a name sharing nothing with any note offers no row to pick. This is the real shape of the
        // Interaction - a new note named near an existing one, dropped into that one's folder.
        const NEW_NOTE_NAME = 'split-picker-name-first-picked-sib';
        const EXPECTED_PATH = `${FOLDER_PATH}/${NEW_NOTE_NAME}.md`;
        const HEADING = 'split-picker-name-first-picked-heading';
        const SOURCE_CONTENT = `# Note\n\n## ${HEADING}\npicked body one\npicked body two\n`;
        const HEADING_LINE_INDEX = 2;
        const HEADING_COUNT = 2;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldSplitHeadingsAutomatically = false;
            settings.defaultSplitTargetMode = 'Create';
            // Straight through to the split: the confirmation dialog is a different suite's subject, and a
            // Confirmed one re-arms `shouldAskBeforeSplitting` in the shared `data.json`.
            settings.shouldAskBeforeSplitting = false;
            // Both would decide the destination themselves, which is the thing under test here.
            settings.shouldAllowOnlyCurrentFolderByDefault = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            // The note must land in the picked folder itself, not in a folder of its own inside it.
            settings.shouldSplitIntoFolder = false;
          });

          await ensureFolder(FOLDER_PATH);
          const sibling = await resetFile(SIBLING_PATH, 'picked sibling body\n');
          await trashIfExists(EXPECTED_PATH);
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);

          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          await waitUntil({
            message: 'the heading cache is not ready',
            predicate: () => (app.metadataCache.getFileCache(source)?.headings?.length ?? 0) === HEADING_COUNT
          });

          editor.setCursor({ ch: 0, line: HEADING_LINE_INDEX });
          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Name first...
          typeIntoPicker(NEW_NOTE_NAME);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // ...then pick the sibling it matched. In `Create` mode that row is not a note to write into -
          // It says WHERE the new note goes.
          const siblingRow = [...document.querySelectorAll<HTMLElement>('.suggestion-item')]
            .find((row) => row.textContent.includes(SIBLING_NAME));
          if (!siblingRow) {
            throw new Error('The sibling note was not offered in the split picker.');
          }
          await clickElement({ element: siblingRow });

          await waitUntil({
            message: `the new note was not created at ${EXPECTED_PATH}`,
            predicate: () => app.vault.getAbstractFileByPath(EXPECTED_PATH) !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const wasCreatedBesideThePickedNote = app.vault.getAbstractFileByPath(EXPECTED_PATH) !== null;
          // The old behavior, spelled out: the picked row ignored, the note dropped wherever Obsidian's
          // New-file resolution puts one.
          const wasCreatedAtTheDefaultLocation = app.vault.getAbstractFileByPath(`${NEW_NOTE_NAME}.md`) !== null;
          const siblingContent = await app.vault.read(sibling);
          const wasSiblingMergedInto = siblingContent.includes('picked body one');

          await trashIfExists(EXPECTED_PATH);

          return {
            wasCreatedAtTheDefaultLocation,
            wasCreatedBesideThePickedNote,
            wasSiblingMergedInto
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAllowOnlyCurrentFolderByDefault = original.shouldAllowOnlyCurrentFolderByDefault;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldSplitHeadingsAutomatically = original.shouldSplitHeadingsAutomatically;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
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

        function typeIntoPicker(value: string): void {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function ensureFolder(path: string): Promise<void> {
          if (!app.vault.getAbstractFileByPath(path)) {
            await app.vault.createFolder(path);
          }
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
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

    expect(result.wasCreatedBesideThePickedNote).toBe(true);
    // The two ways it could have gone wrong: the old silent default, or reading the row as a merge target.
    expect(result.wasCreatedAtTheDefaultLocation).toBe(false);
    expect(result.wasSiblingMergedInto).toBe(false);
  });

  /*
   * Issue #257: the reporter opened this picker, saw a list of notes, clicked one, and nothing happened —
   * because the picker was in `Create` mode with an empty box, where a click could only ever have said
   * WHERE a note that does not exist yet would go. A row naming an existing note is unambiguous, so it now
   * flips the switch to `Merge` and extracts into that note.
   *
   * It is the same shape as the test above, minus the typing: what the user did, and what they expected.
   */
  it('chooses an existing note clicked while nothing is typed, instead of doing nothing', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickElement, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'split-picker-name-first-nameless-source.md';
        const FOLDER_PATH = 'split-picker-name-first-nameless-folder';
        const SIBLING_NAME = 'split-picker-name-first-nameless-sibling';
        const SIBLING_PATH = `${FOLDER_PATH}/${SIBLING_NAME}.md`;
        const HEADING = 'split-picker-name-first-nameless-heading';
        const SOURCE_CONTENT = `# Note\n\n## ${HEADING}\nnameless body one\nnameless body two\n`;
        const HEADING_LINE_INDEX = 2;
        const HEADING_COUNT = 2;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldSplitHeadingsAutomatically = false;
            settings.defaultSplitTargetMode = 'Create';
            // Straight through to the split: the confirmation dialog is a different suite's subject, and a
            // Confirmed one re-arms `shouldAskBeforeSplitting` in the shared `data.json`.
            settings.shouldAskBeforeSplitting = false;
            // Both would decide the destination themselves, which is the thing under test here.
            settings.shouldAllowOnlyCurrentFolderByDefault = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            // The note must land in the picked folder itself, not in a folder of its own inside it.
            settings.shouldSplitIntoFolder = false;
          });

          await ensureFolder(FOLDER_PATH);
          const sibling = await resetFile(SIBLING_PATH, 'nameless sibling body\n');
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);

          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          await waitUntil({
            message: 'the heading cache is not ready',
            predicate: () => (app.metadataCache.getFileCache(source)?.headings?.length ?? 0) === HEADING_COUNT
          });

          editor.setCursor({ ch: 0, line: HEADING_LINE_INDEX });
          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Nothing typed — the box is seeded with the heading name, so it has to be cleared to be the
          // Reporter's case.
          const seededFirstRow = document.querySelector('.suggestion-item');
          typeIntoPicker('');

          /*
           * Clearing the box re-filters the list ASYNCHRONOUSLY, and the seeded heading name already
           * matched the sibling — so a fixed sleep can hand back a row from the PREVIOUS render, detached
           * by the time the click lands. The click then chooses nothing and the picker never closes, which
           * is precisely how this test failed in the aggregate while passing alone, and it was the head of
           * the cascade T795 measured. Wait for the re-render itself (the chooser rebuilds its rows, so
           * the first one is a new element), then re-query.
           */
          await waitUntil({
            message: 'the picker did not re-filter after the name was cleared',
            predicate: () => document.querySelector('.suggestion-item') !== seededFirstRow
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const siblingRow = [...document.querySelectorAll<HTMLElement>('.suggestion-item')]
            .find((row) => row.textContent.includes(SIBLING_NAME));
          if (!siblingRow) {
            throw new Error('The sibling note was not offered in the split picker.');
          }
          await clickElement({ element: siblingRow });

          await waitUntil({
            message: 'the click chose nothing: the picker is still open',
            predicate: () => document.querySelector('.prompt') === null
          });
          await waitUntil({
            message: 'the heading was not extracted into the clicked note',
            predicate: () => app.vault.getAbstractFileByPath(SIBLING_PATH) !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const siblingContent = await app.vault.read(sibling);
          await resetFile(SIBLING_PATH, 'nameless sibling body\n');

          return {
            // A creation named after nothing is what the old code would have had to do — and #238 refuses.
            wasSiblingMergedInto: siblingContent.includes('nameless body one'),
            wasUntitledCreated: app.vault.getAbstractFileByPath('Untitled.md') !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAllowOnlyCurrentFolderByDefault = original.shouldAllowOnlyCurrentFolderByDefault;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldSplitHeadingsAutomatically = original.shouldSplitHeadingsAutomatically;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
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

        function typeIntoPicker(value: string): void {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function ensureFolder(path: string): Promise<void> {
          if (!app.vault.getAbstractFileByPath(path)) {
            await app.vault.createFolder(path);
          }
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

    // The report, answered: the clicked path IS chosen, and the extract lands in it.
    expect(result.wasSiblingMergedInto).toBe(true);
    // And it is a merge, not the nameless creation #238 exists to refuse.
    expect(result.wasUntitledCreated).toBe(false);
  });
});
