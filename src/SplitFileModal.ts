import type { NoteComposerPluginInstance } from 'obsidian-typings';

import {
  App,
  Editor,
  Keymap,
  Platform,
  TFile
} from 'obsidian';

import type { Item } from './SuggestModalBase.ts';

import { SuggestModalBase } from './SuggestModalBase.ts';

export class SplitFileSuggestModal extends SuggestModalBase {
  private readonly defaultValue: string;
  public constructor(
    app: App,
    private readonly corePluginInstance: NoteComposerPluginInstance,
    private readonly sourceFile: TFile,
    private readonly editor: Editor,
    heading?: string
  ) {
    super(app);

    this.defaultValue = '';
    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = true;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    if (!heading) {
      const selectedLines = this.editor.getSelection().split('\n');
      if (selectedLines.length > 0) {
        const extractedHeading = extractHeadingFromLine(selectedLines[0] ?? '');
        heading = extractedHeading ?? undefined;
      }
    }

    heading ??= '';
    this.defaultValue = heading;
    this.setPlaceholder(window.i18next.t('plugins.note-composer.prompt-select-file-to-merge'));
    this.setInstructions([
      { command: '↑↓', purpose: window.i18next.t('plugins.note-composer.instruction-navigate') },
      { command: '↵', purpose: window.i18next.t('plugins.note-composer.instruction-append') },
      {
        command: Platform.isMacOS ? 'cmd ↵' : 'ctrl ↵',
        purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
      },
      { command: 'shift ↵', purpose: window.i18next.t('plugins.note-composer.instruction-prepend') },
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

  public async invokeWithoutUI(): Promise<void> {
    // Todo
  }

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.defaultValue;
    this.updateSuggestions();
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    let targetFile: TFile;

    if (!Keymap.isModifier(evt, 'Mod') && item) {
      if (item.type === 'unresolved') {
        targetFile = await this.app.fileManager.createNewMarkdownFileFromLinktext(item.linktext ?? '', this.sourceFile.path);
      } else if (item.type === 'file' || item.type === 'alias') {
        if (!item.file) {
          throw new Error('File not found');
        }
        targetFile = item.file;
      } else {
        targetFile = await this.app.fileManager.createNewMarkdownFileFromLinktext(this.inputEl.value, this.sourceFile.path);
      }
    } else {
      targetFile = await this.app.fileManager.createNewMarkdownFileFromLinktext(this.inputEl.value, this.sourceFile.path);
    }

    const processedContent = await this.corePluginInstance.applyTemplate(this.editor.getSelection(), this.sourceFile.basename, targetFile.basename);

    await this.app.fileManager.insertIntoFile(targetFile, processedContent, evt.shiftKey ? 'prepend' : 'append');

    const markdownLink = this.app.fileManager.generateMarkdownLink(targetFile, this.sourceFile.path);
    const replacementText = this.corePluginInstance.options.replacementText;

    if (replacementText === 'embed') {
      this.editor.replaceSelection(`!${markdownLink}`);
    } else if (replacementText === 'none') {
      this.editor.replaceSelection('');
    } else {
      this.editor.replaceSelection(markdownLink);
    }
  }
}

export function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}
