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

// Desktop-only: the flow moves files, matching the plugin's other attachment suites.
// Isolation: `npx vitest run --project integration-tests:desktop src/attachments/extract-attachment-into-note.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ExtractionScenarioInput {
  readonly linkerContent: string;
  readonly parentContent: string;
  readonly pluginId: string;
}

interface ExtractionScenarioResult {
  readonly attachmentAtNewPath: boolean;
  readonly attachmentAtOldPath: boolean;
  readonly linkerContent: string;
  readonly noteContent: null | string;
  readonly parentContent: string;
}

const FOLDER = 'ExtractAttach';

async function runScenario(input: ExtractionScenarioInput, shouldExpectNote: boolean): Promise<ExtractionScenarioResult> {
  return await evalInObsidian({
    async callback({ app, input: { linkerContent, parentContent, pluginId }, lib: { waitUntil }, obsidianModule }) {
      // Six waits share it, so their ceilings stay well inside the transport's 30 s cap.
      const WAIT_TIMEOUT_IN_MILLISECONDS = 3500;
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;
      const ROOT = 'ExtractAttach';
      const OLD_ATTACHMENT_PATH = `${ROOT}/sub/pic.png`;
      const NEW_ATTACHMENT_PATH = `${ROOT}/pic.png`;
      const NOTE_PATH = `${ROOT}/March invoice.md`;
      const CURSOR_LINE = 2;

      const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
      try {
        // Attachments beside their note: the new note sits in `ExtractAttach`, so the attachment's proper
        // path becomes `ExtractAttach/pic.png`, and the move out of `sub/` is observable.
        app.vault.setConfig('attachmentFolderPath', './');

        await app.vault.createFolder(`${ROOT}/sub`);
        await app.vault.createBinary(OLD_ATTACHMENT_PATH, new ArrayBuffer(4));
        const parentFile = await app.vault.create(`${ROOT}/parent.md`, parentContent);
        await app.vault.create(`${ROOT}/linker.md`, linkerContent);
        await waitUntil({
          message: 'the metadata cache did not index the parent\'s embed',
          predicate: () => (app.metadataCache.getFileCache(parentFile)?.embeds ?? []).length === 1,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const editor = await openAndGetEditor(parentFile);
        editor.setCursor({ ch: 4, line: CURSOR_LINE });

        app.commands.executeCommandById(`${pluginId}:extract-attachment-into-own-note`);

        if (shouldExpectNote) {
          await waitUntil({
            message: 'the attachment note was not created',
            predicate: () => app.vault.getAbstractFileByPath(NOTE_PATH) !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: 'the parent\'s block id was not dropped',
            predicate: async () => !(await app.vault.read(parentFile)).includes('^inv'),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
        }
        await sleep(SETTLE_DELAY_IN_MILLISECONDS);

        const noteFile = app.vault.getAbstractFileByPath(NOTE_PATH);
        const linkerFile = app.vault.getAbstractFileByPath(`${ROOT}/linker.md`);
        return {
          attachmentAtNewPath: app.vault.getAbstractFileByPath(NEW_ATTACHMENT_PATH) !== null,
          attachmentAtOldPath: app.vault.getAbstractFileByPath(OLD_ATTACHMENT_PATH) !== null,
          linkerContent: linkerFile instanceof obsidianModule.TFile ? await app.vault.read(linkerFile) : '',
          noteContent: noteFile instanceof obsidianModule.TFile ? await app.vault.read(noteFile) : null,
          parentContent: await app.vault.read(parentFile)
        };
      } finally {
        app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
      }

      async function openAndGetEditor(file: TFile): Promise<Editor> {
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'the markdown editor did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === file,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }
    },
    input,
    vaultPath: getTemporaryVault().path
  });
}

describe('Extract attachment into its own note', () => {
  it('moves the attachment into a note of its own and points every block link at that note', async () => {
    const result = await runScenario({
      linkerContent: [
        `See [[${FOLDER}/parent#^inv|the invoice]].`,
        '',
        'And [the scan](parent.md#^inv) too.',
        '',
        `Not this one: [[${FOLDER}/parent]].`,
        ''
      ].join('\n'),
      parentContent: [
        'Attachments:',
        '',
        `- ![[${FOLDER}/sub/pic.png|March invoice]] ^inv`,
        '- something else',
        ''
      ].join('\n'),
      pluginId: PLUGIN_ID
    }, true);

    // The attachment moved into the new note's attachment folder.
    expect(result.attachmentAtOldPath).toBe(false);
    expect(result.attachmentAtNewPath).toBe(true);

    // The new note records the link text as an alias and embeds the attachment.
    expect(result.noteContent).toContain('March invoice');
    expect(result.noteContent).toContain('aliases:');
    expect(result.noteContent).toMatch(/!\[\[.*pic\.png\]\]|!\[.*\]\(.*pic\.png\)/);

    // The parent links the new note on the same line, and the block id is gone.
    expect(result.parentContent).toContain('March invoice');
    expect(result.parentContent).not.toContain('pic.png');
    expect(result.parentContent).not.toContain('^inv');
    expect(result.parentContent).toContain('- something else');

    // Both block links now point at the new note with their display text kept; the plain link is untouched.
    expect(result.linkerContent).not.toContain('#^inv');
    expect(result.linkerContent).toMatch(/\[\[[^\]|]*March invoice\|the invoice\]\]/);
    expect(result.linkerContent).toMatch(/\[the scan\]\([^)]*March%20invoice\.md\)|\[the scan\]\(<[^>]*March invoice\.md>\)/);
    expect(result.linkerContent).toContain(`[[${FOLDER}/parent]]`);
  });

  it('refuses an attachment referenced from another note as well', async () => {
    const result = await runScenario({
      linkerContent: `Directly: [[${FOLDER}/sub/pic.png]].\n`,
      parentContent: [
        'Attachments:',
        '',
        `- ![[${FOLDER}/sub/pic.png|March invoice]] ^inv`,
        ''
      ].join('\n'),
      pluginId: PLUGIN_ID
    }, false);

    expect(result.noteContent).toBeNull();
    expect(result.attachmentAtOldPath).toBe(true);
    expect(result.parentContent).toContain('^inv');
    expect(result.parentContent).toContain('pic.png');
  });
});
