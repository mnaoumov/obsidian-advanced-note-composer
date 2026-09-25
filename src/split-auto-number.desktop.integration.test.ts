import type {
  App,
  Editor,
  TFile
} from 'obsidian';

import {
  ContextId,
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/**
 * @file
 *
 * Auto-numbering what a split creates (issue #269), against a real Obsidian.
 *
 * Three things only a live vault can answer. The sibling scan reads `parentFolder.children`, so it needs a
 * real folder holding real folders and notes rather than a mock's array. The note side renumbers AFTER the
 * note exists, precisely because the destination is not settled until Obsidian's own new-file resolution
 * and de-duplication have run. And the recursive case is the reporter's actual ask — a tree produced by
 * passes that each create their note inside the folder the pass above just made.
 *
 * The reporter's example is reproduced verbatim, gap included: siblings `1.`, `3.`, `4.` continue at `5.`
 * and then `6.`, and the children of each new folder restart at `1.`.
 *
 * Each test runs in PHASES, each its own short eval, with the wait for the split done from Node. They used
 * to be one closure apiece, and in one aggregate run in seven the recursive one died as a bare
 * `EvalCapExceededError`: that names the transport rather than the step that hung, and it threw away
 * everything the closure had observed. A stall now reports the steps that completed and a snapshot of the
 * fixture's tree.
 *
 * The settings written here are RESTORED in a `finally` eval of their own: `data.json` is shared by the
 * whole aggregate run, so a leaked numbering template would rename what every later split suite creates.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-auto-number.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

const FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';
const NOTE_NAME_TEMPLATE = '{{index}}. {{safeName}}';

/*
 * The waits done from NODE. None is a closure's budget, so none is bound by the transport's ~30 s cap: a
 * slow aggregate gets real headroom, and a genuine stall reports the phase that stalled. The test budget
 * covers the phases' own evals on top of them.
 */
const SPLIT_TIMEOUT_IN_MILLISECONDS = 45_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

/**
 * Every setting any test here touches. All are recorded before the first write and all are restored, one
 * field at a time: `PluginSettings` carries a `Map`, which a spread would carry across the transport as `{}`.
 */
interface AutoNumberSettings {
  defaultSplitTargetMode: string;
  numberedSplitFolderNameTemplate: string;
  numberedSplitNoteNameTemplate: string;
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldSplitIntoFolder: boolean;
  shouldSplitRecursivelyIntoDefaultNewNoteFolder: boolean;
}

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: AutoNumberSettings;
}

/**
 * Text a produced note must contain, which is what says the composer has written into it.
 */
interface ContentExpectation {
  readonly path: string;
  readonly text: string;
}

/**
 * What a test waits for once the split has been started: every one of it holds, in one poll.
 */
interface Expectation {
  readonly content?: ContentExpectation;
  readonly link?: LinkExpectation;

  /**
   * Notes that must exist.
   */
  readonly paths: readonly string[];
}

/**
 * The split started through the picker, with a typed name.
 */
interface ExtractTrigger {
  readonly kind: 'extract';
  readonly noteName: string;
}

/**
 * The vault a test starts from, rebuilt from scratch so nothing is de-duplicated against a previous run.
 */
interface Fixture {
  readonly folders: readonly string[];
  readonly notes: readonly FixtureNote[];
  readonly rootFolder: string;

  /**
   * The source note's selection before the command runs.
   */
  readonly selection: FixtureSelection;

  readonly sourceContent: string;
  readonly sourcePath: string;
}

interface FixtureNote {
  readonly content: string;
  readonly path: string;
}

/**
 * A selection as offsets. Equal ends are a cursor.
 */
interface FixtureSelection {
  readonly from: number;
  readonly to: number;
}

/**
 * A link the source must resolve to, which is what says the residual was written and indexed.
 */
interface LinkExpectation {
  readonly from: string;
  readonly to: string;
}

/**
 * The split started by the recursive command, once the source's headings are indexed.
 */
interface RecursiveTrigger {
  readonly headingCount: number;
  readonly kind: 'recursive';
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: AutoNumberSettings) => void) => Promise<void>;
  settings: AutoNumberSettings;
}

/**
 * The status one poll reports: what is still missing. Empty everywhere means settled.
 */
interface SplitStatus {
  isContentMissing: boolean;
  isLinkMissing: boolean;
  missingPaths: string[];
}

/**
 * How the split is started: through the picker with a typed name, or by the recursive command.
 */
type SplitTrigger = ExtractTrigger | RecursiveTrigger;

/**
 * What the phases hand to each other, on `window` in the Obsidian process.
 */
interface SuiteContext {
  originalSettings?: AutoNumberSettings;

  /**
   * When setup started, as `performance.now()`, which every step is timed from.
   */
  startTime?: number;

  /**
   * Each step as it completes, with its time since setup, so a stall names the step it stopped after.
   */
  steps?: string[];
}

describe('auto-numbering what a split creates (issue #269)', () => {
  it('numbers the extracted NOTE, continuing the gapped sequence beside it', async () => {
    const rootFolder = 'split-auto-number-note';
    const sourcePath = `${rootFolder}/Flat source.md`;
    /*
     * Distinctive rather than the issue's bare `D`, and for the reason this feature makes vivid: the vault is
     * shared, the numbered note keeps the typed name as an ALIAS, and a one-letter alias is exactly the row a
     * later suite's picker would be offered and not expect. The recursive test below keeps the issue's own
     * names, being nested and short-lived.
     */
    const newNoteName = 'AutoNumNote';
    const numberedPath = `${rootFolder}/5. ${newNoteName}.md`;

    const result = await runSplitScenario({
      expectation: {
        content: { path: numberedPath, text: 'fragment' },
        /*
         * The one thing numbering AFTER the note exists could break: the residual link is written by the
         * composer from the same `TFile`, which `renameFile` mutated in place, so it has to name the numbered
         * note rather than the name the note was created under a moment earlier.
         */
        link: { from: sourcePath, to: numberedPath },
        paths: [numberedPath]
      },
      fixture: {
        // A numbered FOLDER beside them, to prove the note sequence does not count it.
        folders: [`${rootFolder}/9. AutoNumFolder`],
        // The reporter's own sequence, gap at `2.` included.
        notes: [
          { content: 'a', path: `${rootFolder}/1. AutoNumA.md` },
          { content: 'b', path: `${rootFolder}/3. AutoNumB.md` },
          { content: 'c', path: `${rootFolder}/4. AutoNumC.md` }
        ],
        rootFolder,
        // Select "fragment".
        selection: { from: 10, to: 18 },
        sourceContent: 'keep this fragment here',
        sourcePath
      },
      read: async ({ app, input: { numberedPath: path, rootFolder: root, typedName }, obsidianModule }) => {
        const numbered = app.vault.getAbstractFileByPath(path);
        const numberedContent = numbered instanceof obsidianModule.TFile ? await app.vault.read(numbered) : 'MISSING';
        return {
          // The typed name is recorded as an alias / title, so a link to THAT still resolves too: the
          // `{{index}}` made the real name differ from what was typed, as a folder-note override does.
          hasTypedNameRecorded: numberedContent.includes(typedName),
          // Nothing was created under the unnumbered name.
          isUnnumberedAbsent: app.vault.getAbstractFileByPath(`${root}/${typedName}.md`) === null,
          numberedContent
        };
      },
      readInput: { numberedPath, rootFolder, typedName: newNoteName },
      settings: {
        defaultSplitTargetMode: 'Create',
        // The folder half must be OFF here, or there would be no note left to number.
        numberedSplitFolderNameTemplate: '',
        numberedSplitNoteNameTemplate: NOTE_NAME_TEMPLATE,
        // The new note has to land among the numbered siblings, not in Obsidian's default folder.
        shouldAllowOnlyCurrentFolderByDefault: true,
        shouldAskBeforeSplitting: false,
        shouldAskForTargetFolderWhenSplitting: false,
        shouldSplitIntoFolder: false
      },
      trigger: { kind: 'extract', noteName: newNoteName }
    });

    // `1, 3, 4` continues at `5` — `1 + max`, not `count + 1`, and the gap at `2` is not backfilled.
    expect(result.numberedContent).toContain('fragment');
    expect(result.isUnnumberedAbsent).toBe(true);
    expect(result.hasTypedNameRecorded).toBe(true);
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('numbers the FOLDER instead, leaving the note inside it unnumbered', async () => {
    const rootFolder = 'split-auto-number-folder';
    // Its own name, distinct from the other two tests': each numbered note keeps the typed name as an ALIAS,
    // so a name reused across tests would be an exact match in the picker.
    const newNoteName = 'AutoNumOwnFolder';
    const numberedFolderPath = `${rootFolder}/5. ${newNoteName}`;
    const numberedNotePath = `${numberedFolderPath}/${newNoteName}.md`;

    const result = await runSplitScenario({
      expectation: {
        content: { path: numberedNotePath, text: 'fragment' },
        paths: [numberedNotePath]
      },
      fixture: {
        folders: [`${rootFolder}/1. AutoNumA`, `${rootFolder}/3. AutoNumB`, `${rootFolder}/4. AutoNumC`],
        // A numbered NOTE beside them, to prove the folder sequence does not count it.
        notes: [{ content: 'note', path: `${rootFolder}/9. AutoNumNeighbor.md` }],
        rootFolder,
        selection: { from: 10, to: 18 },
        sourceContent: 'keep this fragment here',
        sourcePath: `${rootFolder}/Folder source.md`
      },
      read: async ({ app, input: { folderPath, notePath }, obsidianModule }) => {
        const numbered = app.vault.getAbstractFileByPath(notePath);
        return {
          isFolderNumbered: app.vault.getAbstractFileByPath(folderPath) instanceof obsidianModule.TFolder,
          // The note kept the typed name — the folder around it carries the number.
          isNoteUnnumbered: numbered instanceof obsidianModule.TFile,
          numberedContent: numbered instanceof obsidianModule.TFile ? await app.vault.read(numbered) : 'MISSING'
        };
      },
      readInput: { folderPath: numberedFolderPath, notePath: numberedNotePath },
      settings: {
        defaultSplitTargetMode: 'Create',
        numberedSplitFolderNameTemplate: FOLDER_NAME_TEMPLATE,
        // BOTH are set, deliberately: the folder template must win, or the number lands twice.
        numberedSplitNoteNameTemplate: NOTE_NAME_TEMPLATE,
        shouldAllowOnlyCurrentFolderByDefault: true,
        shouldAskBeforeSplitting: false,
        shouldAskForTargetFolderWhenSplitting: false,
        shouldSplitIntoFolder: true
      },
      trigger: { kind: 'extract', noteName: newNoteName }
    });

    expect(result.isFolderNumbered).toBe(true);
    expect(result.isNoteUnnumbered).toBe(true);
    expect(result.numberedContent).toContain('fragment');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('reproduces the reporter\'s recursive tree, with children restarting at 1 per parent', async () => {
    const rootFolder = 'split-auto-number-recursive';
    const sourceContent = [
      '# D',
      '',
      'body of D',
      '',
      '## DD',
      '',
      'body of DD',
      '',
      '## DD2',
      '',
      'body of DD2',
      '',
      '# F',
      '',
      'body of F',
      '',
      '## FF',
      '',
      'body of FF',
      '',
      '## FF2',
      '',
      'body of FF2',
      ''
    ].join('\n');

    const result = await runSplitScenario({
      expectation: {
        // The issue's expected hierarchy, verbatim.
        paths: [
          `${rootFolder}/5. D/D.md`,
          `${rootFolder}/5. D/1. DD/DD.md`,
          `${rootFolder}/5. D/2. DD2/DD2.md`,
          `${rootFolder}/6. F/F.md`,
          `${rootFolder}/6. F/1. FF/FF.md`,
          `${rootFolder}/6. F/2. FF2/FF2.md`
        ]
      },
      fixture: {
        folders: [`${rootFolder}/1. A`, `${rootFolder}/1. A/1. AA`, `${rootFolder}/3. B`, `${rootFolder}/4. C`],
        notes: [],
        rootFolder,
        selection: { from: 0, to: 0 },
        sourceContent,
        sourcePath: `${rootFolder}/Recursive source.md`
      },
      read: ({ app, input: { root }, obsidianModule }) => {
        const folder = app.vault.getAbstractFileByPath(root);
        return {
          rootChildNames: folder instanceof obsidianModule.TFolder
            ? folder.children.filter((child) => child instanceof obsidianModule.TFolder).map((child) => child.name).sort()
            : []
        };
      },
      readInput: { root: rootFolder },
      settings: {
        defaultSplitTargetMode: 'Create',
        numberedSplitFolderNameTemplate: FOLDER_NAME_TEMPLATE,
        // A recursive split ALWAYS makes folders, whatever `Should split into folder` says, so the note
        // template must never get a look in — leaving it set is what proves that.
        numberedSplitNoteNameTemplate: '',
        shouldAskBeforeSplitting: false,
        shouldSplitIntoFolder: false,
        // The tree has to be rooted beside the source, among the numbered siblings.
        shouldSplitRecursivelyIntoDefaultNewNoteFolder: false
      },
      trigger: { headingCount: 6, kind: 'recursive' }
    });

    // `1, 3, 4` continues at `5` and then `6`; the gap at `2` stays a gap.
    expect(result.rootChildNames).toEqual(['1. A', '3. B', '4. C', '5. D', '6. F']);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

interface ReadArguments<ReadInput> {
  readonly app: App;
  readonly input: ReadInput;
  readonly obsidianModule: typeof import('obsidian');
}

interface RunSplitScenarioParams<ReadInput extends object, ReadResult> {
  readonly expectation: Expectation;
  readonly fixture: Fixture;

  /**
   * Reads what the test asserts on, once the split has settled. Runs inside Obsidian, so it must be
   * self-contained: everything it needs comes through `readInput`.
   */
  readonly read: (readArguments: ReadArguments<ReadInput>) => Promise<ReadResult> | ReadResult;

  readonly readInput: ReadInput;
  readonly settings: Partial<AutoNumberSettings>;
  readonly trigger: SplitTrigger;
}

/**
 * Turns a phase timeout into an error that also says which steps completed and what the fixture looked like.
 *
 * @param contextId - The suite's context.
 * @param vaultPath - The vault.
 * @param rootFolder - The fixture's root, whose tree is snapshotted.
 * @param error - What the poll rejected with.
 * @returns The error to throw.
 */
async function describeStall(contextId: ContextId<SuiteContext>, vaultPath: string, rootFolder: string, error: unknown): Promise<Error> {
  const state = await evalInObsidian({
    callback({ app, context, obsidianModule, root }) {
      const tree: string[] = [];
      const folder = app.vault.getAbstractFileByPath(root);
      if (folder instanceof obsidianModule.TFolder) {
        obsidianModule.Vault.recurseChildren(folder, (child) => {
          tree.push(child instanceof obsidianModule.TFolder ? `${child.path}/` : child.path);
        });
      }
      return {
        activeFile: app.workspace.getActiveFile()?.path ?? null,
        lockIndicatorCount: document.querySelectorAll('.obsidian-dev-utils-lock-indicator').length,
        modalTitles: [...document.querySelectorAll('.modal')].map((modalEl) => modalEl.querySelector('.modal-title')?.textContent ?? '<untitled>'),
        promptCount: document.querySelectorAll('.prompt').length,
        steps: context.steps ?? [],
        tree: tree.sort()
      };
    },
    contextId,
    input: { root: rootFolder },
    vaultPath
  });
  return new Error(`${String(error)} | state when the suite gave up: ${JSON.stringify(state)}`);
}

/**
 * Finds the plugin's settings component by walking its component tree. Runs inside Obsidian, passed through
 * `input`.
 *
 * @param app - The app.
 * @param pluginId - The plugin.
 * @returns The settings component.
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
 * Runs one scenario in phases: setup, start the split, wait for it from Node, read the result, and — in a
 * `finally` of its own — trash the fixture and restore the settings.
 *
 * @param params - The scenario.
 * @returns What `read` returned.
 */
async function runSplitScenario<ReadInput extends object, ReadResult>(params: RunSplitScenarioParams<ReadInput, ReadResult>): Promise<ReadResult> {
  const { expectation, fixture, read, readInput, settings, trigger } = params;
  const contextId = new ContextId<SuiteContext>();
  const vaultPath = getTemporaryVault().path;

  try {
    await evalInObsidian({
      async callback({ app, context, findSettingsComponent, fixture: f, lib: { waitUntil }, obsidianModule, pluginId, settings: overrides }) {
        // Two waits share this ceiling, well inside the transport's ~30 s cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 8000;
        const startTime = performance.now();
        context.startTime = startTime;
        const steps: string[] = [];
        context.steps = steps;
        function step(name: string): void {
          steps.push(`${name} +${String(Math.round(performance.now() - startTime))} ms`);
        }

        const settingsComponent = findSettingsComponent(app, pluginId);
        const current = settingsComponent.settings;
        context.originalSettings = {
          defaultSplitTargetMode: current.defaultSplitTargetMode,
          numberedSplitFolderNameTemplate: current.numberedSplitFolderNameTemplate,
          numberedSplitNoteNameTemplate: current.numberedSplitNoteNameTemplate,
          shouldAllowOnlyCurrentFolderByDefault: current.shouldAllowOnlyCurrentFolderByDefault,
          shouldAskBeforeSplitting: current.shouldAskBeforeSplitting,
          shouldAskForTargetFolderWhenSplitting: current.shouldAskForTargetFolderWhenSplitting,
          shouldSplitIntoFolder: current.shouldSplitIntoFolder,
          shouldSplitRecursivelyIntoDefaultNewNoteFolder: current.shouldSplitRecursivelyIntoDefaultNewNoteFolder
        };
        await settingsComponent.editAndSave((s) => {
          Object.assign(s, overrides);
        });
        step('settings saved');

        // Rebuild the fixture from scratch, so nothing is de-duplicated against a previous run.
        const existing = app.vault.getAbstractFileByPath(f.rootFolder);
        if (existing) {
          await app.fileManager.trashFile(existing);
        }
        await app.vault.createFolder(f.rootFolder);
        for (const folder of f.folders) {
          await app.vault.createFolder(folder);
        }
        for (const note of f.notes) {
          await app.vault.create(note.path, note.content);
        }
        const source = await app.vault.create(f.sourcePath, f.sourceContent);
        step('fixture written');

        const editor = await openAndGetEditor(source);
        step('source note active');

        // Reset through the EDITOR: an open buffer wins over the file, so an offset-based selection would
        // otherwise grab the previous run's text.
        editor.setValue(f.sourceContent);
        await waitUntil({
          message: 'the source editor did not catch up with the reset content',
          predicate: () => editor.getValue() === f.sourceContent,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        editor.setSelection(editor.offsetToPos(f.selection.from), editor.offsetToPos(f.selection.to));
        step('source content reset and selected');

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `markdown view for ${file.path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }
      },
      contextId,
      input: { findSettingsComponent: findSettingsComponentInObsidian, fixture, pluginId: PLUGIN_ID, settings },
      vaultPath
    });

    await evalInObsidian({
      async callback({ app, context, lib: { pressKey, waitUntil }, pluginId, sourcePath, trigger: t }) {
        // Two waits share this ceiling, well inside the transport's ~30 s cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 8000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const steps = context.steps ?? [];
        const startTime = context.startTime ?? performance.now();
        function step(name: string): void {
          steps.push(`${name} +${String(Math.round(performance.now() - startTime))} ms`);
        }

        if (t.kind === 'recursive') {
          // A cache-gated command silently no-ops if the headings are not indexed yet, and the timeout then
          // blames the split.
          await waitUntil({
            message: 'the metadata cache did not index the source headings',
            predicate: () => {
              const source = app.vault.getFileByPath(sourcePath);
              return source !== null && (app.metadataCache.getFileCache(source)?.headings ?? []).length === t.headingCount;
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          step('source headings indexed');
          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);
          step('recursive split started');
          return;
        }

        app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
        await waitUntil({
          message: 'the split picker did not open',
          predicate: () => document.querySelector('.prompt-input') instanceof HTMLInputElement,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        step('picker open');
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const input = document.querySelector('.prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('No split picker input.');
        }
        input.value = t.noteName;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        /*
         * `Mod+Enter` rather than waiting for the `Enter to create` row, because that row is added ONLY by
         * `onNoSuggestion()` — i.e. only when the search matches nothing at all. In the shared aggregate vault
         * it usually matches something, and the fixtures here share a prefix with the name on purpose, so
         * waiting for it would be waiting for a row that is correctly absent. `Mod+Enter` creates from what was
         * typed whatever the list holds, which is the vault-independent way to say "create".
         */
        input.focus();
        await pressKey({ key: 'Enter', modifiers: ['Mod'] });
        step('name typed, Mod+Enter pressed');
      },
      contextId,
      input: { pluginId: PLUGIN_ID, sourcePath: fixture.sourcePath, trigger },
      vaultPath
    });

    await pollInObsidian({
      contextId,
      input: { expectation },
      poll: async ({ app, expectation: expected, obsidianModule }): Promise<SplitStatus> => {
        let isContentMissing = false;
        if (expected.content) {
          const file = app.vault.getAbstractFileByPath(expected.content.path);
          const content = file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
          isContentMissing = !content.includes(expected.content.text);
        }
        return {
          isContentMissing,
          isLinkMissing: expected.link ? !Object.keys(app.metadataCache.resolvedLinks[expected.link.from] ?? {}).includes(expected.link.to) : false,
          missingPaths: expected.paths.filter((path) => !(app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile))
        };
      },
      timeoutInMilliseconds: SPLIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the split did not produce what the test expects',
      until: (status) => status.missingPaths.length === 0 && !status.isContentMissing && !status.isLinkMissing,
      vaultPath
    }).catch(async (error: unknown) => {
      throw await describeStall(contextId, vaultPath, fixture.rootFolder, error);
    });

    return await evalInObsidian({
      callback: ({ app, obsidianModule, reader, readInput: input }) => reader({ app, input, obsidianModule }),
      contextId,
      input: { reader: read, readInput },
      vaultPath
    });
  } finally {
    await evalInObsidian({
      async callback({ app, context, findSettingsComponent, pluginId, rootFolder }) {
        /*
         * The vault is SHARED by the whole aggregate run, and what these tests create is numbered notes carrying
         * the typed name as an ALIAS — which is exactly what would make a later suite's picker offer a row it
         * does not expect. Leave nothing behind.
         */
        const existing = app.vault.getAbstractFileByPath(rootFolder);
        if (existing) {
          await app.fileManager.trashFile(existing);
        }
        const { originalSettings } = context;
        if (!originalSettings) {
          return;
        }
        await findSettingsComponent(app, pluginId).editAndSave((s) => {
          Object.assign(s, originalSettings);
        });
      },
      contextId,
      input: { findSettingsComponent: findSettingsComponentInObsidian, pluginId: PLUGIN_ID, rootFolder: fixture.rootFolder },
      vaultPath
    });
    await contextId.dispose(vaultPath);
  }
}
