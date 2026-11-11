import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the multi-item `files-menu` is the file explorer's, and core Obsidian on a phone has no
// multi-item selection to open it from.
// Isolation: `npx vitest run --project integration-tests:desktop src/bulk-rename/bulk-rename.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface BulkRenameProbeArguments {
  /**
   * A path the batch's LAST rename produces, waited for before the vault is read.
   */
  readonly expectedPath: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly paths: readonly string[];

  /**
   * The folder under `bulk/` holding this scenario's fixtures, which is all the result reports on.
   */
  readonly scenario: string;
  readonly shouldConfirm: boolean;
}

interface BulkRenameProbeResult {
  readonly filePaths: readonly string[];
  readonly isRenameButtonDisabled: boolean;
  readonly linkerContent: string;
  readonly previewText: string;
}

interface ComponentTreeNode {
  readonly _children?: ComponentTreeNode[];
  readonly editAndSave?: unknown;
  readonly settings?: SubmenuSettings;
}

interface SettingsCarrier {
  readonly editAndSave: (editor: (settings: SubmenuSettings) => void) => Promise<void>;
  readonly settings: SubmenuSettings;
}

interface SubmenuSettings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAddCommandsToSubmenu: boolean;
}

async function runBulkRename(files: Readonly<Record<string, string>>, input: BulkRenameProbeArguments): Promise<BulkRenameProbeResult> {
  return await evalInObsidian({
    async callback({ app, expectedPath, fields, files: fixtureFiles, lib: { clickElement, waitUntil }, obsidianModule, paths, pluginId, scenario, shouldConfirm }): Promise<BulkRenameProbeResult> {
      // Four waits share the transport's ~30 s per-closure cap.
      const WAIT_TIMEOUT_IN_MILLISECONDS = 6000;

      for (const [path, content] of Object.entries(fixtureFiles)) {
        const folderPath = path.slice(0, path.lastIndexOf('/'));
        if (!app.vault.getFolderByPath(folderPath)) {
          await app.vault.createFolder(folderPath);
        }
        await app.vault.create(path, content);
      }

      const settingsComponent = findSettingsComponent();
      const isOriginalSubmenu = settingsComponent.settings.shouldAddCommandsToSubmenu;
      try {
        await settingsComponent.editAndSave((settings) => {
          settings.shouldAddCommandsToSubmenu = false;
        });

        const abstractFiles = paths.map((path) => {
          const abstractFile = app.vault.getAbstractFileByPath(path);
          if (!abstractFile) {
            throw new Error(`Missing fixture ${path}.`);
          }
          return abstractFile;
        });

        const menu = new obsidianModule.Menu();
        app.workspace.trigger('files-menu', menu, abstractFiles, 'file-explorer-context-menu');
        const menuItem = menu.items.find((item) => item.dom.textContent.includes('Bulk rename...'));
        if (!menuItem) {
          throw new Error('Bulk rename menu item was not found.');
        }
        menuItem.dom.click();
        menu.hide();

        await waitUntil({
          message: 'the bulk rename dialog did not open',
          predicate: () => document.querySelector('.advanced-note-composer-bulk-rename-modal') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        for (const [field, value] of Object.entries(fields)) {
          const fieldInput = document.querySelector(`.advanced-note-composer-bulk-rename-modal input[data-bulk-rename-field="${CSS.escape(field)}"]`);
          if (!(fieldInput instanceof HTMLInputElement)) {
            throw new TypeError(`No ${field} field.`);
          }
          // Programmatic value plus an `input` event: what a typed value reaches the component's `onChange`
          // through. Trusted keystrokes would only type the same characters slower.
          fieldInput.value = value;
          fieldInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const renameButton = [...document.querySelectorAll('.advanced-note-composer-bulk-rename-modal .modal-button-container button')]
          .find((button) => button.textContent === 'Rename');
        if (!(renameButton instanceof HTMLButtonElement)) {
          throw new TypeError('No Rename button.');
        }
        const previewEl = document.querySelector('.advanced-note-composer-bulk-rename-preview');
        const previewText = previewEl?.textContent ?? '';
        const isRenameButtonDisabled = renameButton.disabled;

        if (shouldConfirm) {
          await clickElement({ element: renameButton });
          await waitUntil({
            message: 'the batch was not renamed',
            predicate: () => app.vault.getAbstractFileByPath(expectedPath) !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: 'the dialog did not close',
            predicate: () => document.querySelector('.advanced-note-composer-bulk-rename-modal') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
        } else {
          document.querySelector<HTMLElement>('.advanced-note-composer-bulk-rename-modal .mod-cancel')?.click();
        }

        const linker = app.vault.getFileByPath('bulk-rename-linker.md');
        return {
          filePaths: app.vault.getFiles().map((file) => file.path).filter((path) => path.startsWith(`bulk/${scenario}/`)).sort(),
          isRenameButtonDisabled,
          linkerContent: linker ? await app.vault.read(linker) : '',
          previewText
        };
      } finally {
        await settingsComponent.editAndSave((settings) => {
          settings.shouldAddCommandsToSubmenu = isOriginalSubmenu;
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
          if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldAddCommandsToSubmenu === 'boolean') {
            return node as SettingsCarrier;
          }
          if (node._children) {
            queue.push(...node._children);
          }
        }
        throw new Error('Settings component was not found.');
      }
    },
    input: { ...input, files, pluginId: PLUGIN_ID },
    vaultPath: getTemporaryVault().path
  });
}

describe('Bulk rename... on the explorer multi-item menu', () => {
  it('numbers the selection, renames a folder with a selected note inside it, lets its folder note follow, and keeps links', async () => {
    const result = await runBulkRename({
      'bulk-rename-linker.md': '[[bulk/numbering/alpha]] and [[bulk/numbering/Beta/inner]]',
      'bulk/numbering/alpha.md': 'alpha',
      'bulk/numbering/Beta/Beta.md': 'folder note',
      'bulk/numbering/Beta/inner.md': 'inner'
    }, {
      expectedPath: 'bulk/numbering/01. Beta/01. Beta.md',
      fields: { prefix: '{{index:00}}. ' },
      paths: ['bulk/numbering/alpha.md', 'bulk/numbering/Beta', 'bulk/numbering/Beta/inner.md'],
      scenario: 'numbering',
      shouldConfirm: true
    });

    expect(result.isRenameButtonDisabled).toBe(false);
    expect(result.previewText).toContain('01. Beta');
    expect(result.filePaths).toEqual([
      'bulk/numbering/01. Beta/01. Beta.md',
      'bulk/numbering/01. Beta/03. inner.md',
      'bulk/numbering/02. alpha.md'
    ]);
    expect(result.linkerContent).toContain('02. alpha');
    expect(result.linkerContent).toContain('03. inner');
  });

  it('renames by letter case alone', async () => {
    const result = await runBulkRename({ 'bulk/case/note.md': 'note' }, {
      expectedPath: 'bulk/case/Note.md',
      fields: { findText: 'note', replaceText: 'Note' },
      paths: ['bulk/case/note.md'],
      scenario: 'case',
      shouldConfirm: true
    });
    expect(result.filePaths).toEqual(['bulk/case/Note.md']);
  });

  it('refuses a batch whose new name something outside it already holds', async () => {
    const result = await runBulkRename({ 'bulk/clash/a.md': 'a', 'bulk/clash/b.md': 'b' }, {
      expectedPath: '',
      fields: { findText: 'a', replaceText: 'b' },
      paths: ['bulk/clash/a.md'],
      scenario: 'clash',
      shouldConfirm: false
    });
    expect(result.isRenameButtonDisabled).toBe(true);
    expect(result.previewText).toContain('already exists');
    expect(result.filePaths).toEqual(['bulk/clash/a.md', 'bulk/clash/b.md']);
  });
});
