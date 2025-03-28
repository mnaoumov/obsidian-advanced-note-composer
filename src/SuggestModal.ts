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

import { updateLinksInFile } from 'obsidian-dev-utils/obsidian/Link';
import { invokeWithPatchAsync } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { join } from 'obsidian-dev-utils/Path';

export type MergeFileSuggestModalConstructor = new (app: App, noteComposerPluginInstance: NoteComposerPluginInstance) => SuggestModalBase;
export type SplitFileSuggestModalConstructor = new (
  app: App,
  editor: Editor,
  noteComposerPluginInstance: NoteComposerPluginInstance,
  heading?: string
) => SuggestModalBase;

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

export function extendSuggestModal<TConstructor extends Constructor<SuggestModalBase>>(OriginalSuggestModal: TConstructor): TConstructor {
  return class PatchedSuggestModal extends OriginalSuggestModal {
    private get fileManagerPatch(): Factories<FileManager> {
      return {
        insertIntoFile: (next: InsertIntoFileFn): InsertIntoFileFn => {
          return (file: TFile, text: string, insertIntoFilePosition?: 'append' | 'prepend') => insertIntoFile(next, this, file, text, insertIntoFilePosition);
        }
      };
    }

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
