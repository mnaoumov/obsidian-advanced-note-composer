import type {
  App,
  Editor,
  FileManager,
  SuggestModal,
  TFile
} from 'obsidian';
import type { Factories } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import type { NoteComposerPluginInstance } from 'obsidian-typings';
import type { Constructor } from 'type-fest';

import { addAlias } from 'obsidian-dev-utils/obsidian/FileManager';
import { updateLinksInFile } from 'obsidian-dev-utils/obsidian/Link';
import { invokeWithPatchAsync } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { join } from 'obsidian-dev-utils/Path';

import type { AdvancedNoteComposerPlugin } from './AdvancedNoteComposerPlugin.ts';

import {
  INVALID_CHARACTERS_REG_EXP,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from './FilenameValidation.ts';

export type MergeFileSuggestModalConstructor = new (app: App, noteComposerPluginInstance: NoteComposerPluginInstance) => SuggestModalBase;
export type SplitFileSuggestModalConstructor = new (
  app: App,
  editor: Editor,
  noteComposerPluginInstance: NoteComposerPluginInstance,
  heading?: string
) => SuggestModalBase;

type CreateNewMarkdownFileFromLinktextFn = FileManager['createNewMarkdownFileFromLinktext'];
interface Frontmatter {
  title?: string;
}

type InsertIntoFileFn = FileManager['insertIntoFile'];

interface SuggestModalBase extends SuggestModal<unknown> {
  currentFile: TFile;

  getSuggestions(query: string): Promise<unknown[]> | unknown[];
  mergeFile?(targetFile: TFile, sourceFile: TFile, position?: 'append' | 'prepend'): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  onChooseSuggestion(item: unknown, evt: KeyboardEvent | MouseEvent): Promise<void>;
  renderSuggestion(value: unknown, el: HTMLElement): void;
  setCurrentFile(file: TFile): void;
}

export function extendSuggestModal<TConstructor extends Constructor<SuggestModalBase>>(
  plugin: AdvancedNoteComposerPlugin,
  OriginalSuggestModal: TConstructor
): TConstructor {
  return class PatchedSuggestModal extends OriginalSuggestModal {
    private fileManagerPatch: Factories<FileManager> = {
      createNewMarkdownFileFromLinktext: (next: CreateNewMarkdownFileFromLinktextFn): CreateNewMarkdownFileFromLinktextFn => {
        return (filename, path) => createNewMarkdownFileFromLinktext(next, plugin, filename, path);
      },
      insertIntoFile: (next: InsertIntoFileFn): InsertIntoFileFn => {
        return (file: TFile, text: string, insertIntoFilePosition?: 'append' | 'prepend') => insertIntoFile(next, this, file, text, insertIntoFilePosition);
      }
    };

    public override async mergeFile(targetFile: TFile, sourceFile: TFile, position?: 'append' | 'prepend'): Promise<void> {
      await invokeWithPatchAsync(this.app.fileManager, this.fileManagerPatch, async () => {
        return await super.mergeFile?.call(this, targetFile, sourceFile, position);
      });
    }

    public override async onChooseSuggestion(item: unknown, evt: KeyboardEvent | MouseEvent): Promise<void> {
      await invokeWithPatchAsync(this.app.fileManager, this.fileManagerPatch, async () => {
        await super.onChooseSuggestion(item, evt);
      });
    }
  };
}

async function createNewMarkdownFileFromLinktext(
  next: CreateNewMarkdownFileFromLinktextFn,
  plugin: AdvancedNoteComposerPlugin,
  filename: string,
  path: string
): Promise<TFile> {
  const app = plugin.app;
  const fixedFilename = fixFilename(filename, plugin);
  const file = await next.call(app.fileManager, fixedFilename, path);

  if (fixedFilename !== filename) {
    if (plugin.settings.shouldAddInvalidTitleToNoteAlias) {
      await addAlias(app, file, filename);
    }

    if (plugin.settings.shouldAddInvalidTitleToFrontmatterTitleKey) {
      await app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        frontmatter.title = filename;
      });
    }
  }

  return file;
}

function fixFilename(filename: string, plugin: AdvancedNoteComposerPlugin): string {
  const app = plugin.app;
  if (!plugin.settings.shouldReplaceInvalidTitleCharacters || isValidFilename(app, filename)) {
    return filename;
  }

  filename = filename.replaceAll(INVALID_CHARACTERS_REG_EXP, (substring) => plugin.settings.replacement.repeat(substring.length));
  filename = filename.replaceAll(TRAILING_DOTS_OR_SPACES_REG_EXP, (substring) => plugin.settings.replacement.repeat(substring.length));
  if (filename.startsWith('.')) {
    filename = plugin.settings.replacement + filename.slice(1);
  }

  filename ||= 'Untitled';
  return filename;
}

async function fixLinks(app: App, sourceFile: TFile, targetFile: TFile, content: string): Promise<string> {
  if (sourceFile.parent === targetFile.parent) {
    return content;
  }

  const tempPath = app.vault.getAvailablePath(join(targetFile.parent?.path ?? '', '__TEMP__'), 'md');
  const tempFile = await app.vault.create(tempPath, content);

  await updateLinksInFile({
    app,
    newSourcePathOrFile: tempFile,
    oldSourcePathOrFile: sourceFile
  });
  const fixedContent = await app.vault.read(tempFile);
  await app.vault.delete(tempFile);
  return fixedContent;
}

async function insertIntoFile(
  next: InsertIntoFileFn,
  suggestModal: SuggestModalBase,
  file: TFile,
  text: string,
  position?: 'append' | 'prepend'
): Promise<void> {
  const app = suggestModal.app;
  const newText = await fixLinks(app, suggestModal.currentFile, file, text);
  await next.call(app.fileManager, file, newText, position);
}

function isValidFilename(app: App, filename: string): boolean {
  try {
    app.vault.checkPath(filename);
    return true;
  } catch {
    return false;
  }
}
