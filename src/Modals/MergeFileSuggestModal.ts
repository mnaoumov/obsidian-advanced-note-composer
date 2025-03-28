import type {
  App,
  TFile
} from 'obsidian';
import type { NoteComposerPluginInstance } from 'obsidian-typings/implementations';

import { updateLinksInFile } from 'obsidian-dev-utils/obsidian/Link';
import { invokeWithPatchAsync } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { join } from 'obsidian-dev-utils/Path';

import type { ModalBase } from './SuggestModalBase.ts';

export type MergeFileSuggestModalConstructor = new (app: App, noteComposerPluginInstance: NoteComposerPluginInstance) => MergeFileSuggestModal;

type ApplyTemplateFn = NoteComposerPluginInstance['applyTemplate'];

interface MergeFileSuggestModal extends ModalBase {
  composer: NoteComposerPluginInstance;
  mergeFile(targetFile: TFile, sourceFile: TFile): Promise<void>;
}

export function extendMergeFileSuggestModal(OriginalMergeFileSuggestModal: MergeFileSuggestModalConstructor): MergeFileSuggestModalConstructor {
  return class PatchedMergeFileSuggestModal extends OriginalMergeFileSuggestModal {
    public override async mergeFile(targetFile: TFile, sourceFile: TFile): Promise<void> {
      await invokeWithPatchAsync(this.composer, {
        applyTemplate: (next: ApplyTemplateFn): ApplyTemplateFn => {
          return async (content: string) => {
            return await applyTemplate(next, this.composer, content, sourceFile, targetFile);
          };
        }
      }, async () => {
        await super.mergeFile(targetFile, sourceFile);
      });
    }
  };
}

async function applyTemplate(
  next: ApplyTemplateFn,
  composer: NoteComposerPluginInstance,
  content: string,
  sourceFile: TFile,
  targetFile: TFile
): Promise<string> {
  let newContent = await next.call(composer, content, sourceFile.basename, targetFile.basename);
  if (sourceFile.parent === targetFile.parent) {
    return newContent;
  }

  const app = composer.app;

  const tempPath = app.vault.getAvailablePath(join(targetFile.parent?.path ?? '', '__TEMP__'), 'md');
  const tempFile = await app.vault.create(tempPath, newContent);

  await updateLinksInFile({
    app,
    newSourcePathOrFile: tempFile,
    oldSourcePathOrFile: sourceFile
  });
  newContent = await app.vault.read(tempFile);
  await app.vault.delete(tempFile);
  return newContent;
}
