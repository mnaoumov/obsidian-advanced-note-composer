import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

interface ReorderScenarioInput {
  readonly content: string;
  readonly linkerContent: string;
  readonly noteName: string;
  readonly pluginId: string;
  readonly shouldMoveBUp: boolean;
}

interface ReorderScenarioResult {
  readonly isCheckboxTickedOnOpen: boolean;
  readonly linker: string;
  readonly note: string;
  readonly rowsAfterToggle: string[];
}

/**
 * Drives one `Reorder headings...` run in the real app: opens the modal on a fresh note, flips the
 * `Number headings` checkbox, optionally moves `B` above `A` with the arrow button, and confirms.
 *
 * @param input - The scenario.
 * @returns What the modal showed and what landed in the vault.
 */
async function runReorderScenario(input: ReorderScenarioInput): Promise<ReorderScenarioResult> {
  return evalInObsidian({
    async callback({ app, lib: { waitUntil }, obsidianModule, scenario }) {
      // Four waits share this ceiling, so the closure declares 20 s against the transport's 30 s cap.
      const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
      const HEADING_COUNT = 4;

      const file = await app.vault.create(`${scenario.noteName}.md`, scenario.content);
      const linker = await app.vault.create(`${scenario.noteName}-linker.md`, scenario.linkerContent);
      await app.workspace.getLeaf(false).openFile(file);
      await waitUntil({
        message: 'the note did not open with its heading cache and backlink ready',
        predicate: () =>
          app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          && (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === HEADING_COUNT
          && (app.metadataCache.getFileCache(linker)?.links?.length ?? 0) === 1,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });

      app.commands.executeCommandById(`${scenario.pluginId}:reorder-headings`);
      await waitUntil({
        message: 'reorder modal did not open with its numbering checkbox',
        predicate: () => document.querySelector('.advanced-note-composer-reorder-toggle input') !== null,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });

      const checkbox = document.querySelector('.advanced-note-composer-reorder-toggle input');
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new TypeError('No numbering checkbox.');
      }
      const isCheckboxTickedOnOpen = checkbox.checked;
      checkbox.click();

      if (scenario.shouldMoveBUp) {
        const upButton = [...document.querySelectorAll('.advanced-note-composer-reorder-item')]
          .find((el) => el.querySelector('.advanced-note-composer-reorder-title')?.textContent.endsWith(' B') ?? false)
          ?.querySelector('.advanced-note-composer-reorder-up');
        if (!(upButton instanceof HTMLButtonElement)) {
          throw new TypeError('No up button on row "B".');
        }
        upButton.click();
      }

      const rowsAfterToggle = [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-title')].map((el) => el.textContent);
      const confirmButton = [...document.querySelectorAll('.modal-button-container button')].find((el) => el.textContent === 'Reorder');
      if (!(confirmButton instanceof HTMLButtonElement)) {
        throw new TypeError('No Reorder button.');
      }
      const originalContent = scenario.content;
      const originalLinker = scenario.linkerContent;
      confirmButton.click();

      await waitUntil({
        message: 'the note was not rewritten',
        predicate: async () => await app.vault.read(file) !== originalContent,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      await waitUntil({
        message: 'the linker was not rewritten',
        predicate: async () => await app.vault.read(linker) !== originalLinker,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });

      return {
        isCheckboxTickedOnOpen,
        linker: await app.vault.read(linker),
        note: await app.vault.read(file),
        rowsAfterToggle
      };
    },
    input: { scenario: input },
    vaultPath: getTemporaryVault().path
  });
}

// Issue #295, part 2: headings numbered the way folders and notes are, and kept correct by every reorder.
// These tick and clear the real modal's checkbox and read back what the real app wrote, links included:
// a heading's number is part of its text, so every link to a renumbered heading has to follow it.
describe('reorder headings numbering', () => {
  it('should number every heading, follow a move, and re-path the links to them', async () => {
    const result = await runReorderScenario({
      content: 'See [[#B]].\n\n# A\na\n\n## A1\na1\n\n## A2\na2\n\n# B\nb\n',
      linkerContent: 'Link to [[number-headings#A2]].\n',
      noteName: 'number-headings',
      pluginId: PLUGIN_ID,
      shouldMoveBUp: true
    });

    expect(result.isCheckboxTickedOnOpen).toBe(false);
    expect(result.rowsAfterToggle).toEqual(['# 1. B', '# 2. A', '## 1. A1', '## 2. A2']);
    expect(result.note).toBe('See [[#1. B]].\n\n# 1. B\nb\n\n# 2. A\na\n\n## 1. A1\na1\n\n## 2. A2\na2\n');
    expect(result.linker).toBe('Link to [[number-headings#2. A2]].\n');
  });

  it('should start ticked on a numbered note, and strip the numbers once it is cleared', async () => {
    const result = await runReorderScenario({
      content: 'See [[#2. B]].\n\n# 1. A\na\n\n## 1. A1\na1\n\n## 2. A2\na2\n\n# 2. B\nb\n',
      linkerContent: 'Link to [[strip-heading-numbers#2. A2]].\n',
      noteName: 'strip-heading-numbers',
      pluginId: PLUGIN_ID,
      shouldMoveBUp: false
    });

    expect(result.isCheckboxTickedOnOpen).toBe(true);
    expect(result.rowsAfterToggle).toEqual(['# A', '## A1', '## A2', '# B']);
    expect(result.note).toBe('See [[#B]].\n\n# A\na\n\n## A1\na1\n\n## A2\na2\n\n# B\nb\n');
    expect(result.linker).toBe('Link to [[strip-heading-numbers#A2]].\n');
  });
});
