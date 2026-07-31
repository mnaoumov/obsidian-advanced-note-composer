import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('split headings automatically', () => {
  it('should extract the enclosing heading into its own folder with no picker and no confirmation', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const HEADING = 'Auto Heading';
        const NEW_NOTE_PATH = `${HEADING}/${HEADING}.md`;
        const SOURCE_PATH = 'split-headings-automatically-source.md';
        const SOURCE_CONTENT = `Intro text\n\n## ${HEADING}\n\nbody of the auto heading\n`;

        // `Should ask before splitting` stays ON: the whole point is that the new setting bypasses both
        // The target picker AND the confirmation dialog for a heading-driven split.
        const originalShouldAsk = await setToggle('Should ask before splitting', true);
        const originalShouldSplitHeadingsAutomatically = await setToggle('Should split headings automatically', true);
        const originalShouldSplitIntoFolder = await setToggle('Should split into folder', true);
        try {
          // Clean up any leftover from a previous run so the folder name is not de-duplicated.
          await removeIfExists(NEW_NOTE_PATH);
          await removeIfExists(HEADING);

          const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);

          // The command is gated on the metadata cache knowing the note's headings; running it before the
          // Cache indexes the just-written note would silently no-op.
          await waitUntil({
            message: 'metadata cache did not index the source heading',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).some((heading) => heading.heading === HEADING)
          });

          // Put the cursor inside the heading's body, not on the heading line itself.
          editor.setCursor({ ch: 0, line: 4 });
          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);

          let wasPickerShown = false;
          let wasConfirmationShown = false;
          await waitUntil({
            message: 'the heading was not extracted into its own folder',
            predicate: () => {
              wasPickerShown ||= document.querySelector('.prompt') !== null;
              wasConfirmationShown ||= Array.from(document.querySelectorAll('.modal-title')).some((el) => el.textContent === 'Split file');
              return app.vault.getAbstractFileByPath(NEW_NOTE_PATH) instanceof obsidianModule.TFile;
            }
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const newFile = app.vault.getAbstractFileByPath(NEW_NOTE_PATH);
          const newFileContent = newFile instanceof obsidianModule.TFile ? await app.vault.read(newFile) : '';
          const isFolder = app.vault.getAbstractFileByPath(HEADING) instanceof obsidianModule.TFolder;

          // The link left behind in the source resolves to the newly-created note in its folder.
          await waitUntil({
            message: 'source link to the extracted note did not resolve',
            predicate: () => Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NEW_NOTE_PATH)
          });
          const linkResolves = Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NEW_NOTE_PATH);

          return {
            isFolder,
            linkResolves,
            newFileContent,
            wasConfirmationShown,
            wasPickerShown
          };
        } finally {
          await setToggle('Should ask before splitting', originalShouldAsk);
          await setToggle('Should split headings automatically', originalShouldSplitHeadingsAutomatically);
          await setToggle('Should split into folder', originalShouldSplitIntoFolder);
        }

        async function removeIfExists(path: string): Promise<void> {
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

        async function setToggle(name: string, value: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === name);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error(`"${name}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== value) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }
      },
      vaultPath: getTempVault().path
    });

    // The heading was extracted with no user interaction at all.
    expect(result.wasPickerShown).toBe(false);
    expect(result.wasConfirmationShown).toBe(false);
    // The new note is named after the heading and lives inside its own folder.
    expect(result.isFolder).toBe(true);
    expect(result.newFileContent).toContain('body of the auto heading');
    expect(result.linkResolves).toBe(true);
  });

  it('should split every heading into its own folder in one go with no confirmation', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const HEADINGS = ['Sec One', 'Sec Two', 'Sec Three'];
        const SOURCE_PATH = 'split-headings-automatically-batch-source.md';
        const SOURCE_CONTENT = `Intro text\n\n${HEADINGS.map((heading) => `## ${heading}\n\nbody of ${heading}\n`).join('\n')}`;

        // Same as above: `Should ask before splitting` stays ON, so a surviving confirmation dialog would
        // Stall the batch after the first heading.
        const originalShouldAsk = await setToggle('Should ask before splitting', true);
        const originalShouldSplitHeadingsAutomatically = await setToggle('Should split headings automatically', true);
        const originalShouldSplitIntoFolder = await setToggle('Should split into folder', true);
        try {
          for (const heading of HEADINGS) {
            await removeIfExists(`${heading}/${heading}.md`);
            await removeIfExists(heading);
          }

          const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);

          await waitUntil({
            message: 'metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).filter((heading) => heading.level === 2).length === HEADINGS.length
          });

          // The command is only enabled when the selection intersects an H2 section.
          editor.setCursor({ ch: 0, line: 2 });
          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-h2`);

          let wasPickerShown = false;
          let wasConfirmationShown = false;
          await waitUntil({
            message: 'not every heading was split into its own folder',
            predicate: () => {
              wasPickerShown ||= document.querySelector('.prompt') !== null;
              wasConfirmationShown ||= Array.from(document.querySelectorAll('.modal-title')).some((el) => el.textContent === 'Split file');
              return HEADINGS.every((heading) => app.vault.getAbstractFileByPath(`${heading}/${heading}.md`) instanceof obsidianModule.TFile);
            }
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const areAllInOwnFolders = HEADINGS.every((heading) => app.vault.getAbstractFileByPath(heading) instanceof obsidianModule.TFolder);

          return { areAllInOwnFolders, wasConfirmationShown, wasPickerShown };
        } finally {
          await setToggle('Should ask before splitting', originalShouldAsk);
          await setToggle('Should split headings automatically', originalShouldSplitHeadingsAutomatically);
          await setToggle('Should split into folder', originalShouldSplitIntoFolder);
        }

        async function removeIfExists(path: string): Promise<void> {
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

        async function setToggle(name: string, value: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === name);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error(`"${name}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== value) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }
      },
      vaultPath: getTempVault().path
    });

    // Every H2 section was split in one run, with no user interaction at any point.
    expect(result.wasPickerShown).toBe(false);
    expect(result.wasConfirmationShown).toBe(false);
    expect(result.areAllInOwnFolders).toBe(true);
  });
});
