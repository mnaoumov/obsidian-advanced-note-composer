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

const PLUGIN_ID = 'advanced-note-composer';

/*
 * The reporter of issue #203 wrote one Templater command per LINE, so their transform produced a two-line
 * name (`Test: a` became `Test - a` + `Test: a`). This template reproduces that exact shape through the
 * plugin's OWN token pass instead, so the reproduction needs no Templater install in the test vault while
 * failing for precisely the same reason: a name that spans two lines.
 */
const MULTI_LINE_NAME_TRANSFORM_TEMPLATE = '{{rawString}}\n{{rawString}}';

// Minimal shape of the plugin's settings component reached at runtime, used to set `Name transform template`
// (a CodeMirror code highlighter, so driving it from the DOM is not practical) — the same walker
// `split-headings-recursively.desktop.integration.test.ts` uses.
interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: NameTransformSettings;
}

interface NameTransformSettings {
  mergeExcludePaths: string[];
  nameTransformTemplate: string;
  shouldAskBeforeSplitting: boolean;
  shouldSplitHeadingsAutomatically: boolean;
  shouldSplitIntoFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: NameTransformSettings) => void): Promise<void>;
  settings: NameTransformSettings;
}

describe('name transform producing a multi-line name (issue #203)', () => {
  it('refuses the extraction with a message that says what is wrong, instead of an unhandled error', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, nameTransformTemplate, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const NOTICE_POLL_INTERVAL_IN_MILLISECONDS = 50;
        const NOTICE_POLL_ATTEMPTS = 100;
        const SOURCE_PATH = 'name-transform-multiline-source.md';
        const HEADING_TEXT = 'NtMultiline: a';
        const SOURCE_CONTENT = `# ${HEADING_TEXT}\n\nbody of the heading\n`;

        const settingsComponent = findSettingsComponent();
        const originalNameTransformTemplate = settingsComponent.settings.nameTransformTemplate;
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeSplitting;
        const isOriginalShouldSplitIntoFolder = settingsComponent.settings.shouldSplitIntoFolder;
        const isOriginalShouldSplitHeadingsAutomatically = settingsComponent.settings.shouldSplitHeadingsAutomatically;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.nameTransformTemplate = nameTransformTemplate;
            /*
             * The reporter's own configuration: with `Should split headings automatically` on, the extraction
             * skips BOTH the target picker and the confirmation dialog, so the transformed name is used
             * without anyone ever seeing it — which is why the failure had nowhere to be reported.
             */
            settings.shouldSplitHeadingsAutomatically = true;
            settings.shouldAskBeforeSplitting = false;
            settings.shouldSplitIntoFolder = false;
          });

          const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);
          editor.setCursor({ ch: 0, line: 0 });

          await waitUntil({
            message: 'metadata cache did not index the source heading',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 1
          });

          /*
           * Every desktop integration test shares ONE Obsidian instance, and a notice raised by an
           * earlier test can still be on screen here. The collection below sweeps the whole document, so
           * without this the "no unhandled-error notice appeared" assertion fails on someone else's
           * leftover — which is exactly how this test failed inside a release preflight while passing in
           * isolation. Ignore the notices that already exist; element identity is stable, and the text is
           * not a safe key because two tests can raise the same message.
           */
          const preExistingNoticeEls = new Set<Element>(activeDocument.querySelectorAll('.notice'));

          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);

          /*
           * Notices auto-hide, so they are collected on every poll rather than snapshotted once at the end,
           * and the wait gives up quietly — a throwing wait would discard everything already observed.
           */
          const noticeTexts = new Set<string>();
          for (let attempt = 0; attempt < NOTICE_POLL_ATTEMPTS; attempt++) {
            for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
              if (preExistingNoticeEls.has(noticeEl)) {
                continue;
              }
              const text = noticeEl.textContent;
              if (text) {
                noticeTexts.add(text);
              }
            }
            if ([...noticeTexts].some((text) => text.includes('multi-line'))) {
              break;
            }
            await sleep(NOTICE_POLL_INTERVAL_IN_MILLISECONDS);
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Anything the extraction managed to create would be named after the heading, so this is the
          // Whole "nothing was created" question — the source note itself is named differently.
          const createdPaths = app.vault.getMarkdownFiles()
            .map((file) => file.path)
            .filter((path) => path.includes('NtMultiline'));

          return {
            createdPaths,
            isSourceStillInPlace: app.vault.getAbstractFileByPath(SOURCE_PATH) instanceof obsidianModule.TFile,
            noticeTexts: [...noticeTexts],
            sourceContent: editor.getValue()
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.nameTransformTemplate = originalNameTransformTemplate;
            settings.shouldAskBeforeSplitting = isOriginalShouldAsk;
            settings.shouldSplitIntoFolder = isOriginalShouldSplitIntoFolder;
            settings.shouldSplitHeadingsAutomatically = isOriginalShouldSplitHeadingsAutomatically;
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
          return typeof node.editAndSave === 'function' && Array.isArray(node.settings?.mergeExcludePaths);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: 'markdown editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      input: { nameTransformTemplate: MULTI_LINE_NAME_TRANSFORM_TEMPLATE, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The refusal names the actual problem...
    expect(result.noticeTexts.some((text) => text.includes('multi-line'))).toBe(true);
    // ...instead of the generic handler's message, which is all issue #203's reporter ever saw.
    expect(result.noticeTexts.some((text) => text.includes('An unhandled error occurred'))).toBe(false);

    // Nothing was created: the impossible name is refused BEFORE the note is made.
    expect(result.createdPaths).toStrictEqual([]);

    // And the source note is left exactly as it was — the extraction did not half-run.
    expect(result.isSourceStillInPlace).toBe(true);
    expect(result.sourceContent).toContain('# NtMultiline: a');
    expect(result.sourceContent).toContain('body of the heading');
  });
});
