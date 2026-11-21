import dedent from 'dedent';
import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the flow moves files, matching the plugin's other attachment suites.
// Isolation: `npx vitest run --project integration-tests:desktop src/attachments/inline-attachment-note.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface InlineScenarioInput {
  readonly linkerContent: string;
  readonly noteContent: string;
  readonly parentContent: string;
  readonly pluginId: string;
  readonly root: string;
  readonly shouldExpectInline: boolean;
}

interface InlineScenarioResult {
  readonly attachmentAtNewPath: boolean;
  readonly attachmentAtOldPath: boolean;
  readonly linkerContent: string;
  readonly noteExists: boolean;
  readonly parentContent: string;
}

const FOLDER = 'InlineAttach';
const REFUSED_FOLDER = 'InlineAttachRefused';

async function runScenario(input: InlineScenarioInput): Promise<InlineScenarioResult> {
  return await evalInObsidian({
    async callback({ app, lib: { waitUntil }, obsidianModule, scenario: { linkerContent, noteContent, parentContent, pluginId, root, shouldExpectInline } }) {
      // Four waits share it, so their ceilings stay well inside the transport's 30 s cap.
      const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;
      const OLD_ATTACHMENT_PATH = `${root}/Notes/pic.png`;
      const NEW_ATTACHMENT_PATH = `${root}/pic.png`;
      const NOTE_PATH = `${root}/Notes/Invoice.md`;

      const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
      try {
        // Attachments beside their note: the parent sits in the root folder, so the attachment's proper path
        // becomes `<root>/pic.png`, and the move out of `Notes/` is observable.
        app.vault.setConfig('attachmentFolderPath', './');

        await app.vault.createFolder(`${root}/Notes`);
        await app.vault.createBinary(OLD_ATTACHMENT_PATH, new ArrayBuffer(4));
        const noteFile = await app.vault.create(NOTE_PATH, noteContent);
        const parentFile = await app.vault.create(`${root}/parent.md`, parentContent);
        const linkerFile = await app.vault.create(`${root}/linker.md`, linkerContent);
        await waitUntil({
          message: 'the metadata cache did not index the links to the attachment note',
          predicate: () => app.metadataCache.resolvedLinks[parentFile.path]?.[NOTE_PATH] === 1 && app.metadataCache.resolvedLinks[linkerFile.path]?.[NOTE_PATH] === 2,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        await app.workspace.getLeaf(false).openFile(noteFile);
        await waitUntil({
          message: 'the attachment note did not open',
          predicate: () => app.workspace.getActiveFile() === noteFile,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        app.commands.executeCommandById(`${pluginId}:inline-attachment-note-into-parent`);

        if (shouldExpectInline) {
          try {
            await waitUntil({
              message: 'the attachment note was not trashed',
              predicate: () => app.vault.getAbstractFileByPath(NOTE_PATH) === null,
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
          } catch (error) {
            const notices = Array.from(activeDocument.querySelectorAll('.notice'), (el) => el.textContent).join(' | ');
            const command = app.commands.findCommand(`${pluginId}:inline-attachment-note-into-parent`);
            throw new Error(`${String(error)}; offered: ${String(command?.checkCallback?.(true))}; notices: ${notices}; parent: ${await app.vault.read(parentFile)}`, { cause: error });
          }
        }
        await sleep(SETTLE_DELAY_IN_MILLISECONDS);

        return {
          attachmentAtNewPath: app.vault.getAbstractFileByPath(NEW_ATTACHMENT_PATH) !== null,
          attachmentAtOldPath: app.vault.getAbstractFileByPath(OLD_ATTACHMENT_PATH) !== null,
          linkerContent: await app.vault.read(linkerFile),
          noteExists: app.vault.getAbstractFileByPath(NOTE_PATH) instanceof obsidianModule.TFile,
          parentContent: await app.vault.read(parentFile)
        };
      } finally {
        app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
      }
    },
    input: { scenario: input },
    vaultPath: getTemporaryVault().path
  });
}

describe('Inline attachment note into its parent', () => {
  it('puts the attachment on the parent\'s line and points every other link at that line\'s block', async () => {
    const result = await runScenario({
      linkerContent: `${dedent`
        See [[${FOLDER}/Notes/Invoice|the invoice]].

        And [[${FOLDER}/Notes/Invoice]] too.
      `}\n`,
      noteContent: `${dedent`
        ---
        aliases:
          - March invoice
        ---

        ![[${FOLDER}/Notes/pic.png]]
      `}\n`,
      parentContent: `${dedent`
        Attachments:

        - [[${FOLDER}/Notes/Invoice]]
        - something else
      `}\n`,
      pluginId: PLUGIN_ID,
      root: FOLDER,
      shouldExpectInline: true
    });

    // The note is gone and the attachment moved into the parent's attachment folder.
    expect(result.noteExists).toBe(false);
    expect(result.attachmentAtOldPath).toBe(false);
    expect(result.attachmentAtNewPath).toBe(true);

    // The parent embeds the attachment on the same line, with the alias as link text and a block id.
    const blockId = /pic\.png\|March invoice\]\] \^(?<id>[a-z0-9]{6})$/m.exec(result.parentContent)?.groups?.['id'];
    expect(result.parentContent).toMatch(/^- !\[\[/m);
    expect(blockId).toBeDefined();
    expect(result.parentContent).toContain('- something else');
    expect(result.parentContent).not.toContain('Invoice]]');

    // Both links now point at the block, each keeping its display text.
    expect(result.linkerContent).toContain(`parent#^${blockId ?? ''}|the invoice]]`);
    // A link with no link text keeps the text Obsidian showed for it, the path as written.
    expect(result.linkerContent).toContain(`parent#^${blockId ?? ''}|${FOLDER}/Notes/Invoice]]`);
    expect(result.linkerContent).not.toContain(`[[${FOLDER}/Notes/Invoice`);
  });

  it('refuses an attachment referenced from another note as well', async () => {
    const result = await runScenario({
      linkerContent: `${dedent`
        See [[${REFUSED_FOLDER}/Notes/Invoice]] and [[${REFUSED_FOLDER}/Notes/Invoice|again]].

        Directly: [[${REFUSED_FOLDER}/Notes/pic.png]].
      `}\n`,
      noteContent: `![[${REFUSED_FOLDER}/Notes/pic.png]]\n`,
      parentContent: `- [[${REFUSED_FOLDER}/Notes/Invoice]]\n`,
      pluginId: PLUGIN_ID,
      // The vault is reset per file, not per test, so this case gets a folder of its own.
      root: REFUSED_FOLDER,
      shouldExpectInline: false
    });

    expect(result.noteExists).toBe(true);
    expect(result.attachmentAtOldPath).toBe(true);
    expect(result.parentContent).toBe(`- [[${REFUSED_FOLDER}/Notes/Invoice]]\n`);
  });
});
