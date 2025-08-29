import type { NoteComposerPluginInstance } from 'obsidian-typings';
import {
  INVALID_CHARACTERS_REG_EXP,
  isValidFilename,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from './FilenameValidation.ts';

import {
  Editor,
  Keymap,
  Platform,
  TFile
} from 'obsidian';

import type { Item } from './SuggestModalBase.ts';

import { SuggestModalBase } from './SuggestModalBase.ts';
import type { Plugin } from './Plugin.ts';
import { trimEnd } from 'obsidian-dev-utils/String';
import { addAlias } from 'obsidian-dev-utils/obsidian/FileManager';

interface Frontmatter {
  title?: string;
}

export class SplitFileSuggestModal extends SuggestModalBase {
  private readonly defaultValue: string;
  public constructor(
    private readonly plugin: Plugin,
    private readonly corePluginInstance: NoteComposerPluginInstance,
    private readonly sourceFile: TFile,
    private readonly editor: Editor,
    heading?: string
  ) {
    super(plugin.app);

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
        targetFile = await this.createNewMarkdownFileFromLinktext(item.linktext ?? '', this.sourceFile.path);
      } else if (item.type === 'file' || item.type === 'alias') {
        if (!item.file) {
          throw new Error('File not found');
        }
        targetFile = item.file;
      } else {
        targetFile = await this.createNewMarkdownFileFromLinktext(this.inputEl.value, this.sourceFile.path);
      }
    } else {
      targetFile = await this.createNewMarkdownFileFromLinktext(this.inputEl.value, this.sourceFile.path);
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

  private async createNewMarkdownFileFromLinktext(fileName: string, path: string): Promise<TFile> {
    fileName = trimEnd(fileName, '.md');
    const fixedFilename = `${this.fixFilename(fileName)}.md`;
    const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(fixedFilename, path)

    if (file.basename !== fileName) {
      if (this.plugin.settings.shouldAddInvalidTitleToNoteAlias) {
        await addAlias(this.app, file, fileName);
      }

      if (this.plugin.settings.shouldAddInvalidTitleToFrontmatterTitleKey) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
          frontmatter.title = fileName;
        });
      }
    }
    return file;
  }

  private fixFilename(fileName: string): string {
    if (!this.plugin.settings.shouldReplaceInvalidTitleCharacters || isValidFilename(this.app, fileName)) {
      return fileName;
    }

    fileName = fileName.replaceAll(INVALID_CHARACTERS_REG_EXP, (substring) => this.plugin.settings.replacement.repeat(substring.length));
    fileName = fileName.replaceAll(TRAILING_DOTS_OR_SPACES_REG_EXP, (substring) => this.plugin.settings.replacement.repeat(substring.length));
    if (fileName.startsWith('.')) {
      fileName = this.plugin.settings.replacement + fileName.slice(1);
    }

    fileName ||= 'Untitled';
    return fileName;
  }
}

export function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}
