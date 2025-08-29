import type { NoteComposerPluginInstance } from 'obsidian-typings';

import {
  App,
  Keymap,
  Platform,
  TFile
} from 'obsidian';

import type { Item } from './SuggestModalBase.ts';

import { DynamicModal } from './DynamicModal.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';

export class MergeFileSuggestModal extends SuggestModalBase {
  public constructor(app: App, private readonly corePluginInstance: NoteComposerPluginInstance, private readonly sourceFile: TFile) {
    super(app);

    this.emptyStateText = window.i18next.t('plugins.note-composer.label-no-files');
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;
    this.setPlaceholder(window.i18next.t('plugins.note-composer.prompt-select-file-to-merge'));
    this.setInstructions([
      { command: '↑↓', purpose: window.i18next.t('plugins.note-composer.instruction-navigate') },
      { command: '↵', purpose: window.i18next.t('plugins.note-composer.instruction-merge') },
      {
        command: Platform.isMacOS ? 'cmd ↵' : 'ctrl ↵',
        purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
      },
      { command: 'shift ↵', purpose: window.i18next.t('plugins.note-composer.instruction-merge-at-top') },
      { command: 'esc', purpose: window.i18next.t('plugins.note-composer.instruction-dismiss') }
    ]);
    this.scope.register(['Shift'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    let targetFile: TFile;

    if (Keymap.isModifier(evt, 'Mod') || item?.type === 'unresolved') {
      const fileName = item?.type === 'unresolved' ? item.linktext ?? '' : this.inputEl.value;
      const parentFolder = this.app.fileManager.getNewFileParent(this.sourceFile.path, fileName);

      targetFile = await this.app.fileManager.createNewMarkdownFile(parentFolder, fileName, '');
    } else if (item?.type === 'bookmark' && item.item?.type === 'file') {
      const bookmarkFile = this.app.vault.getFileByPath(item.item.path ?? '');
      if (bookmarkFile) {
        targetFile = bookmarkFile;
      } else {
        throw new Error('Bookmark file not found');
      }
    } else if (item?.file) {
      targetFile = item.file;
    } else {
      throw new Error('No valid file selected');
    }

    if (targetFile !== this.sourceFile) {
      let doNotAskAgain = false;

      const that = this;
      if (this.corePluginInstance.options.askBeforeMerging) {
        const modal = new DynamicModal(this.app)
          .setTitle(window.i18next.t('plugins.note-composer.label-merge-file'))
          .setContent(createFragment((f) => {
            f.createEl('p', {
              text: window.i18next.t('plugins.note-composer.label-confirm-file-merge', {
                destination: targetFile.basename,
                file: this.sourceFile.basename
              })
            });
          }));

        if (Platform.isMobile) {
          modal.addButton('mod-warning', window.i18next.t('plugins.note-composer.button-delete-do-not-ask-again'), async () => {
            await performMerge();
          });
        } else {
          modal.addCheckbox(window.i18next.t('plugins.note-composer.dialogue-label-do-not-ask-again'), (evt2) => {
            if (!(evt2.target instanceof HTMLInputElement)) {
              return;
            }
            doNotAskAgain = evt2.target.checked;
          });
        }

        modal.addButton('mod-warning', window.i18next.t('plugins.note-composer.button-merge'), async () => {
          await performMerge();
        })
          .addCancelButton()
          .open();
      } else {
        await performMerge();
      }

      async function performMerge(): Promise<void> {
        if (doNotAskAgain) {
          that.corePluginInstance.options.askBeforeMerging = false;
          await that.corePluginInstance.pluginInstance.saveData(that.corePluginInstance.options);
        }
        await that.mergeFile(targetFile, that.sourceFile, evt.shiftKey ? 'prepend' : 'append');
      }
    }
  }

  private async mergeFile(targetFile: TFile, sourceFile: TFile, mode: 'append' | 'prepend' = 'append'): Promise<void> {
    const sourceContent = await this.app.vault.read(sourceFile);
    const processedContent = await this.corePluginInstance.applyTemplate(sourceContent, sourceFile.basename, targetFile.basename);

    await this.app.fileManager.runAsyncLinkUpdate(async (links) => {
      await this.app.fileManager.insertIntoFile(targetFile, processedContent, mode);
      await this.app.fileManager.trashFile(sourceFile);

      for (const link of links) {
        if (link.resolvedFile === sourceFile) {
          link.resolvedFile = targetFile;
          link.resolvedPaths = [];
        }
      }
    });

    await this.app.workspace.getLeaf().openFile(targetFile);
  }
}
