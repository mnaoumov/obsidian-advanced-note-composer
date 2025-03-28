import type {
  App,
  Editor,
  FileManager,
  SuggestModal,
  TFile
} from 'obsidian';
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
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  onChooseSuggestion(item: unknown, evt: KeyboardEvent | MouseEvent): Promise<void>;
  renderSuggestion(value: unknown, el: HTMLElement): void;
  setCurrentFile(file: TFile): void;
}

export function extendSuggestModal<TConstructor extends Constructor<SuggestModalBase>>(OriginalSuggestModal: TConstructor): TConstructor {
  return class PatchedSuggestModal extends OriginalSuggestModal {
    public override async onChooseSuggestion(item: unknown, evt: KeyboardEvent | MouseEvent): Promise<void> {
      await handleChooseSuggestion(this, item, evt);
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

async function handleChooseSuggestion(suggestModal: SuggestModalBase, item: unknown, evt: KeyboardEvent | MouseEvent): Promise<void> {
  const app = suggestModal.app;
  await invokeWithPatchAsync(app.fileManager, {
    insertIntoFile: (next: InsertIntoFileFn): InsertIntoFileFn => {
      return (file: TFile, text: string, position?: 'append' | 'prepend') => insertIntoFile(next, suggestModal, file, text, position);
    }
  }, async () => {
    const proto = Object.getPrototypeOf(suggestModal) as SuggestModalBase;
    const baseProto = Object.getPrototypeOf(proto) as SuggestModalBase;
    await baseProto.onChooseSuggestion.call(suggestModal, item, evt);
  });
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
