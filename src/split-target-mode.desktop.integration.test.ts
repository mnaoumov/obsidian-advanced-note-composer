import type {
  App,
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
  /**
   * The note to read back once the extraction has landed - which differs by mode, and has to be read before
   * the next pass resets it.
   */
  readonly readPath: string;
  readonly shouldForceCreate: boolean;
  readonly typedName: string;
}

/**
 * What one pass through the picker observed.
 */
interface ExtractInModeResult {
  /**
   * The `readPath` note's content once the extraction had landed.
   */
  readonly contentAfter: string;

  /**
   * What the picker showed while it was open.
   */
  readonly observations: PickerObservations;
}

interface PickerObservations {
  hasCreateRowForUnknownName: boolean;
  isSwitchOn: boolean;
  isTreatTitleAsPathDisabled: boolean;
  isUnresolvedPathDisabled: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: SplitTargetModeSettings) => void) => Promise<void>;
  settings: SplitTargetModeSettings;
}

/**
 * The picker box's `spellcheck` attribute, keyed by the mode the switch reported when it was read.
 */
type SpellcheckByMode = Record<string, null | string>;

interface SplitTargetModeSettings {
  defaultSplitTargetMode: string;
  shouldAskBeforeSplitting: boolean;
}

const SOURCE_PATH = 'split-mode-source.md';
const TARGET_BASENAME = 'split-mode-target';
const TARGET_PATH = `${TARGET_BASENAME}.md`;
// What `Create` makes of a name an existing note already holds: a second, numbered note beside it.
const CREATED_BESIDE_TARGET_PATH = `${TARGET_BASENAME} 1.md`;
const FORCED_BASENAME = 'split-mode-forced';
const FORCED_PATH = `${FORCED_BASENAME}.md`;
// Matches no note in the vault, so it is the name that tells the two modes apart: `Create` offers
// to make it, `Merge` offers nothing at all.
const UNKNOWN_NAME = 'split-mode-nothing-matches-this';
const SOURCE_CONTENT = 'alpha bravo charlie\n';
// The option checkboxes the instruction bar renders, in order: `Include frontmatter`, `Treat title
// as path`, `Fix footnotes`, `Allow only current folder`, `Merge headings`, `Allow split into
// unresolved path`.
const TREAT_TITLE_AS_PATH_CHECKBOX_INDEX = 1;
const UNRESOLVED_PATH_CHECKBOX_INDEX = 5;

describe('the split/extract picker\'s create/merge switch (issue #227)', () => {
  it('should do what the switch says, whatever the typed name would have implied', async () => {
    // The three modes used to share ONE closure, which declared 96 000 ms of waiting against the transport's
    // ~30 s per-closure cap: one pass through the picker costs six ceilings and there are three passes, and
    // a helper's ceilings are charged once per CALL SITE. The eval could only ever die as a bare `script
    // timeout` naming the harness rather than the wait that overran. Each pass resets its own notes, so the
    // sequencing belongs in NODE, where no cap applies to it.
    const originalSettings = await configureSuite();
    try {
      const merge = await extractInMode({ mode: 'Merge', readPath: TARGET_PATH, shouldForceCreate: false, typedName: TARGET_BASENAME });
      const create = await extractInMode({ mode: 'Create', readPath: CREATED_BESIDE_TARGET_PATH, shouldForceCreate: false, typedName: TARGET_BASENAME });
      const forced = await extractInMode({ mode: 'Merge', readPath: FORCED_PATH, shouldForceCreate: true, typedName: FORCED_BASENAME });

      // `Merge` states itself: the switch is on, and a name nothing matches offers nothing to create.
      expect(merge.observations.isSwitchOn).toBe(true);
      expect(merge.observations.hasCreateRowForUnknownName).toBe(false);
      // Neither option has anything to act on when nothing is created, so both are off-limits.
      expect(merge.observations.isTreatTitleAsPathDisabled).toBe(true);
      expect(merge.observations.isUnresolvedPathDisabled).toBe(true);
      // ...and the extracted text landed IN the existing note.
      expect(merge.contentAfter).toContain('target body');
      expect(merge.contentAfter).toContain('bravo');

      // `Create` states the opposite, offers to make the unmatched name, and leaves both options available.
      expect(create.observations.isSwitchOn).toBe(false);
      expect(create.observations.hasCreateRowForUnknownName).toBe(true);
      expect(create.observations.isTreatTitleAsPathDisabled).toBe(false);
      expect(create.observations.isUnresolvedPathDisabled).toBe(false);
      // The SAME typed name - one an existing note already holds - now makes a new note beside it instead of
      // merging into it, which is the whole point of stating the mode.
      expect(create.contentAfter).toContain('bravo');

      // `Mod+Enter` still forces a creation FROM `Merge` mode, where there is no creatable suggestion at all.
      expect(forced.observations.isSwitchOn).toBe(true);
      expect(forced.contentAfter).toContain('bravo');
    } finally {
      await restoreSuite(originalSettings);
    }
  });

  it('should spell-check the box only while it names a note, following Editor > Spellcheck (issue #268)', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Before this shared budget it declared 42 400 ms, so the eval could only ever die
         * as a bare transport timeout - which names the harness rather than the wait that overran. Every step
         * waited for here settles in well under a second on a healthy machine. A helper that waits is charged
         * once per CALL SITE, so adding a call to one adds a whole ceiling: re-divide this budget by the new
         * count, not by the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SPELLCHECK_SOURCE_PATH = 'split-spellcheck-source.md';
        const SPELLCHECK_SOURCE_CONTENT = 'alpha bravo charlie\n';

        const originalSpellcheck = app.vault.getConfig('spellcheck');
        try {
          /*
           * Both directions, because either one alone is ambiguous: a reading of `true` in `Create` could
           * equally be a box that is ALWAYS checked, and a reading of `false` could be Obsidian's own
           * hardcoded `spellcheck="false"` still standing. Only the pair says the box follows the setting.
           */
          const whenEnabled = await readSpellcheckByMode(true);
          const whenDisabled = await readSpellcheckByMode(false);
          return { whenDisabled, whenEnabled };
        } finally {
          app.vault.setConfig('spellcheck', originalSpellcheck);
        }

        /**
         * Opens the picker once with the vault setting at the given value and reads the box in BOTH modes,
         * flipping between them with `Alt+M`.
         *
         * Deliberately cancels instead of choosing a target: choosing is what writes the mode back into
         * `Default split target mode`, and a leaked `Merge` breaks the later split files that assume the
         * shipped `Create` default. Cancelling also keeps this case out of the vault entirely.
         *
         * @param isSpellcheckEnabled - What to set the vault's `Editor > Spellcheck` to for this reading.
         * @returns The attribute seen in each mode, keyed by what the switch itself reported.
         */
        async function readSpellcheckByMode(isSpellcheckEnabled: boolean): Promise<SpellcheckByMode> {
          app.vault.setConfig('spellcheck', isSpellcheckEnabled);

          const editor = await openSourceEditor();
          const selectionStart = SPELLCHECK_SOURCE_CONTENT.indexOf('bravo');
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + 'bravo'.length));

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const spellcheckByMode: SpellcheckByMode = {};
          recordCurrentMode(spellcheckByMode);

          // The box has the cursor when the picker opens (issue #262), and `Alt+M` needs it to still be
          // there; focusing again costs nothing and makes that independent of the opening focus race.
          requirePickerInput().focus();
          await pressKey({ key: 'm', modifiers: ['Alt'] });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          recordCurrentMode(spellcheckByMode);

          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return spellcheckByMode;
        }

        /*
         * Keys the reading by what the SWITCH says rather than by what the mode was asked to be, so a
         * picker that opened in the other mode - or an `Alt+M` that never landed - shows up as a missing
         * key in the assertions instead of silently mislabelling a correct reading.
         */
        function recordCurrentMode(spellcheckByMode: SpellcheckByMode): void {
          const isMerge = document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container')?.classList.contains('is-enabled') ?? false;
          // The ATTRIBUTE, not the `spellcheck` IDL property: the value being corrected is the hardcoded
          // `spellcheck: "false"` Obsidian writes onto every `SuggestModal` input, and the IDL property
          // reports an inherited default for an element carrying no attribute at all.
          spellcheckByMode[isMerge ? 'Merge' : 'Create'] = requirePickerInput().getAttribute('spellcheck');
        }

        function requirePickerInput(): HTMLInputElement {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          return input;
        }

        async function openSourceEditor(): Promise<Editor> {
          const existing = app.vault.getAbstractFileByPath(SPELLCHECK_SOURCE_PATH);
          const file = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(SPELLCHECK_SOURCE_PATH, SPELLCHECK_SOURCE_CONTENT);

          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await app.workspace.revealLeaf(leaf);
          await waitUntil({
            message: `the editor for ${SPELLCHECK_SOURCE_PATH} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === SPELLCHECK_SOURCE_PATH,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          // Reset through the EDITOR: an open buffer wins over `vault.modify`, so an offset-based
          // selection against a stale buffer would grab the previous reading's text.
          view.editor.setValue(SPELLCHECK_SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => view.editor.getValue() === SPELLCHECK_SOURCE_CONTENT,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          return view.editor;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // `Create` is a name being invented, so it follows the setting exactly as every other name prompt in
    // the plugin does (issue #233) - rather than keeping the `spellcheck="false"` Obsidian hardcodes onto
    // every `SuggestModal` input.
    expect(result.whenEnabled['Create']).toBe('true');
    // `Merge` is a search box for notes that already exist. Nothing there is prose, so it stays unchecked
    // even with the setting on - which is also what proves the `Create` reading came from the MODE and not
    // from the box simply always being checked.
    expect(result.whenEnabled['Merge']).toBe('false');
    // ...and turning the vault setting off turns `Create` off too, which is what makes it the user's call.
    expect(result.whenDisabled['Create']).toBe('false');
    expect(result.whenDisabled['Merge']).toBe('false');
  });
});

/**
 * Turns the split confirmation off and clears what an earlier run left behind, reporting the settings the
 * run has to put back.
 * @returns The settings as they were before this suite touched them.
 */
async function configureSuite(): Promise<SplitTargetModeSettings> {
  return evalInObsidian({
    async callback({ app, createdBesideTargetPath, findSettingsComponent, forcedPath, pluginId }): Promise<SplitTargetModeSettings> {
      const settingsComponent = findSettingsComponent(app, pluginId);
      // Field by field rather than a spread: this value crosses the transport to reach `restoreSuite`, and
      // `PluginSettings` carries a `Map` that serializes to `{}` - carrying one out and back is how a
      // restore poisons every later suite in the shared instance.
      const original: SplitTargetModeSettings = {
        defaultSplitTargetMode: settingsComponent.settings.defaultSplitTargetMode,
        shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting
      };
      await settingsComponent.editAndSave((settings) => {
        settings.shouldAskBeforeSplitting = false;
      });

      for (const path of [createdBesideTargetPath, forcedPath]) {
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing) {
          await app.fileManager.trashFile(existing);
        }
      }
      return original;
    },
    input: {
      createdBesideTargetPath: CREATED_BESIDE_TARGET_PATH,
      findSettingsComponent: findSettingsComponentInObsidian,
      forcedPath: FORCED_PATH,
      pluginId: PLUGIN_ID
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Runs ONE pass through the split picker in one mode: opens it on a freshly reset source, reads what it
 * shows for a name nothing matches, then commits the typed name and reports what the target holds after.
 * @param pass - The mode, the name to type, whether to force a creation, and the note to read back.
 * @returns What the picker showed while it was open, and the target note's content afterwards.
 */
async function extractInMode(pass: ExtractInModeOptions): Promise<ExtractInModeResult> {
  return evalInObsidian({
    async callback({
      app,
      findSettingsComponent,
      lib: { pressKey, waitUntil },
      obsidianModule,
      options,
      pluginId,
      sourceContent,
      sourcePath,
      targetPath,
      treatTitleAsPathCheckboxIndex,
      unknownName,
      unresolvedPathCheckboxIndex
    }): Promise<ExtractInModeResult> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Six ceilings share one pass - the editor opening, the reset content landing, the
       * picker opening, a suggestion appearing, the picker closing, and the source losing the extracted
       * text - and each of those is a DOM change or a one-note vault write, well under a second apiece.
       * Adding a wait to this pass adds a whole ceiling: re-divide this budget by the new count.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
      const RENDER_DELAY_IN_MILLISECONDS = 400;

      await findSettingsComponent(app, pluginId).editAndSave((settings) => {
        settings.defaultSplitTargetMode = options.mode;
      });

      const source = await ensureFile(sourcePath, sourceContent);
      const editor = await openAndGetEditor(source);
      // Reset the source through the EDITOR, not the vault: the previous run left a link where `bravo`
      // was, and an open buffer wins over `vault.modify` - selecting by offset against a stale buffer
      // would extract that link instead of the word.
      editor.setValue(sourceContent);
      await waitUntil({
        message: 'the source editor did not catch up with the reset content',
        predicate: () => editor.getValue() === sourceContent,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      // The target is not the open note, so the vault is the right way to reset it.
      await resetFile(targetPath, 'target body\n');
      const selectionStart = sourceContent.indexOf('bravo');
      editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + 'bravo'.length));

      app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
      await waitUntil({
        message: 'the split picker did not open',
        predicate: () => document.querySelector('.prompt') !== null,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      await sleep(RENDER_DELAY_IN_MILLISECONDS);

      const input = document.querySelector('.prompt-input');
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('No split picker input.');
      }

      // A name nothing matches: only `Create` may offer to make it.
      typeIntoPicker(input, unknownName);
      await sleep(RENDER_DELAY_IN_MILLISECONDS);

      const checkboxes = [...document.querySelectorAll('.prompt-instructions input[type="checkbox"]')];
      const observations: PickerObservations = {
        hasCreateRowForUnknownName: [...document.querySelectorAll('.suggestion-action')].some((el) => el.textContent.includes('Enter to create')),
        isSwitchOn: document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container')?.classList.contains('is-enabled') ?? false,
        isTreatTitleAsPathDisabled: isCheckboxDisabled(checkboxes[treatTitleAsPathCheckboxIndex]),
        isUnresolvedPathDisabled: isCheckboxDisabled(checkboxes[unresolvedPathCheckboxIndex])
      };

      typeIntoPicker(input, options.typedName);
      if (options.shouldForceCreate) {
        // `Merge` offers nothing creatable, so there is deliberately no suggestion to wait for here:
        // `Mod+Enter` has to flip the switch to `Create` and create from what was typed.
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
      } else {
        await waitUntil({
          message: `no suggestion appeared for ${options.typedName}`,
          predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(options.typedName)),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
      }
      input.focus();
      await pressKey({ key: 'Enter', modifiers: options.shouldForceCreate ? ['Mod'] : [] });

      await waitUntil({
        message: 'the split picker did not close',
        predicate: () => document.querySelector('.prompt') === null,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      // The extraction rewrites the SOURCE note too, so waiting for that is what proves the operation
      // ran rather than the modal merely closing.
      await waitUntil({
        message: 'the selection was not extracted out of the source note',
        predicate: () => !editor.getValue().includes('bravo charlie'),
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      await sleep(RENDER_DELAY_IN_MILLISECONDS);

      // Read it NOW: every pass resets the target note, so a later pass would erase what this one wrote.
      const readFile = app.vault.getAbstractFileByPath(options.readPath);
      const contentAfter = readFile instanceof obsidianModule.TFile ? await app.vault.read(readFile) : '';
      return { contentAfter, observations };

      function typeIntoPicker(inputEl: HTMLInputElement, value: string): void {
        inputEl.value = value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      function isCheckboxDisabled(checkboxEl: Element | undefined): boolean {
        if (!(checkboxEl instanceof HTMLInputElement)) {
          throw new TypeError('The picker did not render its option checkboxes.');
        }
        return checkboxEl.disabled;
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
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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
    input: {
      findSettingsComponent: findSettingsComponentInObsidian,
      options: pass,
      pluginId: PLUGIN_ID,
      sourceContent: SOURCE_CONTENT,
      sourcePath: SOURCE_PATH,
      targetPath: TARGET_PATH,
      treatTitleAsPathCheckboxIndex: TREAT_TITLE_AS_PATH_CHECKBOX_INDEX,
      unknownName: UNKNOWN_NAME,
      unresolvedPathCheckboxIndex: UNRESOLVED_PATH_CHECKBOX_INDEX
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Walks the plugin's component tree for the settings carrier. Declared out here so every eval can take it
 * through `input` rather than re-declaring it inside each closure.
 * @param app - The Obsidian app.
 * @param pluginId - This plugin's id.
 * @returns The component that owns the settings.
 */
function findSettingsComponentInObsidian(app: App, pluginId: string): SettingsCarrier {
  const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
  const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    if (typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string') {
      return node as SettingsCarrier;
    }
    if (node._children) {
      queue.push(...node._children);
    }
  }
  throw new Error('Settings component was not found.');
}

/**
 * Puts the two settings back the way `configureSuite` found them.
 * @param originalState - What that call reported.
 */
async function restoreSuite(originalState: SplitTargetModeSettings): Promise<void> {
  await evalInObsidian({
    async callback({ app, findSettingsComponent, original, pluginId }): Promise<void> {
      await findSettingsComponent(app, pluginId).editAndSave((settings) => {
        settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
        settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
      });
    },
    input: { findSettingsComponent: findSettingsComponentInObsidian, original: originalState, pluginId: PLUGIN_ID },
    vaultPath: getTemporaryVault().path
  });
}
