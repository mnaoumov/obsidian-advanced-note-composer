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

const TARGET_CONTENT = '# Alpha heading\nalpha line\n\n## Bravo heading\nbravo line\n\n## Charlie heading\ncharlie line\n';

interface ScenarioInput {
  readonly headingQuery: string;
  readonly isMarked: boolean;
  readonly isTargetSameAsSource: boolean;
  readonly moved: string;
  readonly name: string;
  readonly shouldUseShift: boolean;
  readonly sourceContent: string;
}

interface ScenarioResult {
  readonly activePath: null | string;
  readonly sourceNote: string;
  readonly sourcePath: string;
  readonly targetNote: string;
}

function linesOf(note: string): string[] {
  return note.split('\n');
}

/**
 * Runs one move in its own closure, so each declares only its own few waits against the transport's cap.
 *
 * @param scenarioInput - The scenario.
 * @returns What the notes hold afterwards, and which note is active.
 */
async function runScenario(scenarioInput: ScenarioInput): Promise<ScenarioResult> {
  return await evalInObsidian({
    async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId, scenario, targetContent }) {
      // Eight waits (the read loop counted as one) share this budget, well under the transport's ~30 s cap.
      const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
      const SETTLE_IN_MILLISECONDS = 400;

      const sourcePath = `move-under-heading-${scenario.name}-source.md`;
      const targetPath = scenario.isTargetSameAsSource ? sourcePath : `move-under-heading-${scenario.name}-target.md`;
      const sourceFile = await resetFile(sourcePath, scenario.sourceContent);
      const targetFile = scenario.isTargetSameAsSource ? sourceFile : await resetFile(targetPath, targetContent);

      const editor = await openAndGetEditor(sourceFile);
      const movedOffset = editor.getValue().indexOf(scenario.moved);
      editor.setSelection(editor.offsetToPos(movedOffset), editor.offsetToPos(movedOffset + scenario.moved.length));

      if (scenario.isMarked) {
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-under-heading`);
      } else {
        app.commands.executeCommandById(`${pluginId}:move-selection-under-heading`);
      }

      await chooseInPicker(targetPath, false);
      await chooseInPicker(scenario.headingQuery, scenario.shouldUseShift);

      // The target is not open, so its content is read off the vault, which `waitUntil`'s synchronous predicate
      // cannot do; a same-note move is read off the editor that holds it.
      const deadline = Date.now() + WAIT_TIMEOUT_IN_MILLISECONDS;
      let targetNote = await readTarget();
      while (!isMoveDone(targetNote) && Date.now() < deadline) {
        await sleep(SETTLE_IN_MILLISECONDS);
        targetNote = await readTarget();
      }
      await sleep(SETTLE_IN_MILLISECONDS);
      targetNote = await readTarget();

      const sourceNote = sourceEditorValue() ?? await app.vault.read(sourceFile);
      return { activePath: app.workspace.getActiveFile()?.path ?? null, sourceNote, sourcePath, targetNote };

      function isMoveDone(note: string): boolean {
        return !note.includes('advanced-note-composer-move-') && note.split('\n').includes(scenario.moved);
      }

      async function readTarget(): Promise<string> {
        return scenario.isTargetSameAsSource ? sourceEditorValue() ?? '' : await app.vault.read(targetFile);
      }

      async function chooseInPicker(query: string, shouldUseShift: boolean): Promise<void> {
        await waitUntil({ predicate: () => document.querySelector('.prompt-input') instanceof HTMLInputElement, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
        const input = document.querySelector('.prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('No picker input.');
        }
        input.value = query;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await waitUntil({
          predicate: () => document.querySelector('.suggestion-item.is-selected')?.textContent.includes(query) === true,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        input.focus();
        await pressKey(shouldUseShift ? { key: 'Enter', modifiers: ['Shift'] } : { key: 'Enter' });
        await waitUntil({ predicate: () => !input.isConnected, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
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
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === file, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }

      function sourceEditorValue(): null | string {
        for (const leaf of app.workspace.getLeavesOfType('markdown')) {
          const view = leaf.view;
          if (view instanceof obsidianModule.MarkdownView && view.file?.path === sourcePath) {
            return view.editor.getValue();
          }
        }
        return null;
      }
    },
    input: { pluginId: PLUGIN_ID, scenario: scenarioInput, targetContent: TARGET_CONTENT },
    vaultPath: getTemporaryVault().path
  });
}

describe('Move selection under heading', () => {
  it('should append the selection to the end of the chosen heading body in another note, without opening it', async () => {
    const result = await runScenario({
      headingQuery: 'Bravo heading',
      isMarked: false,
      isTargetSameAsSource: false,
      moved: 'MOVEME',
      name: 'append',
      shouldUseShift: false,
      sourceContent: 'keep MOVEME keep'
    });

    const lines = linesOf(result.targetNote);
    const movedLine = lines.indexOf('MOVEME');
    expect(movedLine).toBeGreaterThan(lines.indexOf('bravo line'));
    expect(movedLine).toBeLessThan(lines.indexOf('## Charlie heading'));
    expect(result.targetNote.match(/MOVEME/g)?.length).toBe(1);
    expect(result.sourceNote).not.toContain('MOVEME');
    expect(result.sourceNote).toContain('#Bravo heading');
    expect(result.activePath).toBe(result.sourcePath);
  });

  it('should put the selection right under the heading with Shift+Enter', async () => {
    const result = await runScenario({
      headingQuery: 'Alpha heading',
      isMarked: false,
      isTargetSameAsSource: false,
      moved: 'Top line moved',
      name: 'prepend',
      shouldUseShift: true,
      sourceContent: 'keep Top line moved keep'
    });

    const lines = linesOf(result.targetNote);
    const movedLine = lines.indexOf('Top line moved');
    expect(movedLine).toBeGreaterThan(lines.indexOf('# Alpha heading'));
    expect(movedLine).toBeLessThan(lines.indexOf('alpha line'));
  });

  it('should move within the same note, leaving no self-link', async () => {
    const result = await runScenario({
      headingQuery: 'Bravo heading',
      isMarked: false,
      isTargetSameAsSource: true,
      moved: 'Same line moved',
      name: 'same',
      shouldUseShift: false,
      sourceContent: '# Alpha heading\nalpha line Same line moved\n\n## Bravo heading\nbravo line\n\n## Charlie heading\ncharlie line\n'
    });

    const lines = linesOf(result.targetNote);
    expect(lines).toContain('alpha line ');
    const movedLine = lines.indexOf('Same line moved');
    expect(movedLine).toBeGreaterThan(lines.indexOf('bravo line'));
    expect(movedLine).toBeLessThan(lines.indexOf('## Charlie heading'));
    expect(result.targetNote).not.toContain('[[');
  });

  it('should move a marked smart cut & paste selection under the chosen heading', async () => {
    const result = await runScenario({
      headingQuery: 'Charlie heading',
      isMarked: true,
      isTargetSameAsSource: false,
      moved: 'Marked line moved',
      name: 'marked',
      shouldUseShift: false,
      sourceContent: 'keep Marked line moved keep'
    });

    const lines = linesOf(result.targetNote);
    expect(lines.indexOf('Marked line moved')).toBeGreaterThan(lines.indexOf('charlie line'));
    expect(result.sourceNote).not.toContain('Marked line moved');
  });
});
