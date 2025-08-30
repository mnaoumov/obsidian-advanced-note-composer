import type { Pos } from 'obsidian';
import type { NoteComposerPluginInstance } from 'obsidian-typings';

import {
  App,
  Editor,
  getFrontMatterInfo,
  parseLinktext,
  TFile
} from 'obsidian';
import { addAlias } from 'obsidian-dev-utils/obsidian/FileManager';
import {
  editLinks,
  updateLink,
  updateLinksInContent
} from 'obsidian-dev-utils/obsidian/Link';
import { getBacklinksForFileSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';
import { trimEnd } from 'obsidian-dev-utils/String';

import type { Plugin } from './Plugin.ts';
import type { Item } from './SuggestModalBase.ts';

import {
  INVALID_CHARACTERS_REG_EXP,
  isValidFilename,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from './FilenameValidation.ts';

interface Frontmatter {
  title?: string;
}

interface Selection {
  endOffset: number;
  startOffset: number;
}

export class AdvancedNoteComposer {
  public action: 'merge' | 'split' = 'merge';

  public readonly app: App;
  public mode: 'append' | 'prepend' = 'append';
  public shouldIncludeFrontmatter: boolean;
  public get targetFile(): TFile {
    if (!this._targetFile) {
      throw new Error('Target file not set');
    }
    return this._targetFile;
  }

  private _targetFile?: TFile;

  public constructor(
    private readonly plugin: Plugin,
    public readonly corePluginInstance: NoteComposerPluginInstance,
    public readonly sourceFile: TFile,
    public readonly editor?: Editor,
    public heading = ''
  ) {
    this.app = plugin.app;
    this.shouldIncludeFrontmatter = plugin.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
  }

  public initHeading(): void {
    if (this.heading) {
      return;
    }

    const selectedLines = this.editor?.getSelection().split('\n') ?? [];
    if (selectedLines.length > 0) {
      const extractedHeading = extractHeadingFromLine(selectedLines[0] ?? '');
      this.heading = extractedHeading ?? '';
    }
  }

  public async mergeFile(doNotAskAgain: boolean): Promise<void> {
    if (doNotAskAgain) {
      this.corePluginInstance.options.askBeforeMerging = false;
      await this.corePluginInstance.pluginInstance.saveData(this.corePluginInstance.options);
    }

    const sourceContent = await this.app.vault.read(this.sourceFile);
    const processedContent = await this.corePluginInstance.applyTemplate(sourceContent, this.sourceFile.basename, this.targetFile.basename);

    await this.insertIntoFile(processedContent);
    await this.app.fileManager.trashFile(this.sourceFile);

    if (this.plugin.settings.shouldOpenNoteAfterMerge) {
      await this.app.workspace.getLeaf().openFile(this.targetFile);
    }
  }

  public async selectItem(item: Item | null, isMod: boolean, inputValue: string): Promise<void> {
    if (this.action === 'merge') {
      await this.selectItemForMerge(item, isMod, inputValue);
    } else {
      await this.selectItemForSplit(item, isMod, inputValue);
    }
  }

  public async splitFile(): Promise<void> {
    if (!this._targetFile) {
      await this.selectItemForSplit(null, false, this.heading);
    }

    const processedContent = await this.corePluginInstance.applyTemplate(this.editor?.getSelection() ?? '', this.sourceFile.basename, this.targetFile.basename);
    await this.insertIntoFile(processedContent);

    const markdownLink = this.app.fileManager.generateMarkdownLink(this.targetFile, this.sourceFile.path);
    const replacementText = this.corePluginInstance.options.replacementText;

    if (replacementText === 'embed') {
      this.editor?.replaceSelection(`!${markdownLink}`);
    } else if (replacementText === 'none') {
      this.editor?.replaceSelection('');
    } else {
      this.editor?.replaceSelection(markdownLink);
    }
  }

  private async createNewMarkdownFileFromLinktext(fileName: string): Promise<TFile> {
    fileName = trimEnd(fileName, '.md');
    const fixedFileName = `${this.fixFileName(fileName)}.md`;
    const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(fixedFileName, this.sourceFile.path);

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

  private async fixBacklinks(backlinksToFix: Map<string, string[]>): Promise<void> {
    for (const backlinkPath of backlinksToFix.keys()) {
      const linkJsons = backlinksToFix.get(backlinkPath) ?? [];
      await editLinks(this.app, backlinkPath, (link) => {
        if (!linkJsons.includes(JSON.stringify(link))) {
          return;
        }

        return updateLink({
          app: this.app,
          link,
          newSourcePathOrFile: backlinkPath,
          newTargetPathOrFile: this.targetFile,
          oldTargetPathOrFile: this.sourceFile,
          shouldUpdateFileNameAlias: true
        });
      });
    }
  }

  private fixFileName(fileName: string): string {
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

  private async fixLinks(content: string): Promise<string> {
    return await updateLinksInContent({
      app: this.app,
      content,
      newSourcePathOrFile: this.targetFile,
      oldSourcePathOrFile: this.sourceFile
    });
  }

  private async getSelections(): Promise<Selection[]> {
    if (this.editor) {
      return this.editor.listSelections().map((editorSelection) => {
        const selection: Selection = {
          endOffset: this.editor?.posToOffset(editorSelection.anchor) ?? 0,
          startOffset: this.editor?.posToOffset(editorSelection.head) ?? 0
        };

        if (selection.startOffset > selection.endOffset) {
          [selection.startOffset, selection.endOffset] = [selection.endOffset, selection.startOffset];
        }

        return selection;
      });
    }

    const content = await this.app.vault.read(this.sourceFile);

    return [{
      endOffset: content.length,
      startOffset: 0
    }];
  }

  private async insertIntoFile(text: string): Promise<void> {
    const newText = await this.fixLinks(text);
    const backlinksToFix = await this.prepareBacklinksToFix();
    await this.app.fileManager.insertIntoFile(this.targetFile, newText, this.mode);
    await this.fixBacklinks(backlinksToFix);
    if (!this.shouldIncludeFrontmatter) {
      return;
    }
    const content = await this.app.vault.read(this.sourceFile);
    const frontmatterInfo = getFrontMatterInfo(content);
    if (frontmatterInfo.exists) {
      const fullFrontmatter = `---\n${frontmatterInfo.frontmatter}\n---`;
      await this.app.fileManager.insertIntoFile(this.targetFile, fullFrontmatter);
    }
  }

  private isSelected(position: Pos, selections: Selection[]): boolean {
    return selections.some((selection) => {
      return selection.startOffset <= position.start.offset && position.end.offset <= selection.endOffset;
    });
  }

  private async prepareBacklinksToFix(): Promise<Map<string, string[]>> {
    const selections = await this.getSelections();
    const cache = this.app.metadataCache.getFileCache(this.sourceFile) ?? {};
    const subpaths = new Set<string>();
    if (this.action === 'merge') {
      subpaths.add('');
    }

    for (const heading of cache.headings ?? []) {
      if (!this.isSelected(heading.position, selections)) {
        continue;
      }

      subpaths.add(`#${heading.heading}`);
    }

    for (const block of Object.values(cache.blocks ?? {})) {
      if (!this.isSelected(block.position, selections)) {
        continue;
      }

      subpaths.add(`#^${block.id}`);
    }

    const backlinks = await getBacklinksForFileSafe(this.app, this.sourceFile);
    const backlinksToFix = new Map<string, string[]>();

    for (const backlinkPath of backlinks.keys()) {
      const links = backlinks.get(backlinkPath) ?? [];
      for (const link of links) {
        const { subpath } = parseLinktext(link.link);
        if (!subpaths.has(subpath)) {
          continue;
        }

        let referenceJsons = backlinksToFix.get(backlinkPath);

        if (!referenceJsons) {
          referenceJsons = [];
          backlinksToFix.set(backlinkPath, referenceJsons);
        }

        referenceJsons.push(JSON.stringify(link));
      }
    }

    return backlinksToFix;
  }

  private async selectItemForMerge(item: Item | null, isMod: boolean, inputValue: string): Promise<void> {
    if (isMod || item?.type === 'unresolved') {
      const fileName = item?.type === 'unresolved' ? item.linktext ?? '' : inputValue;
      const parentFolder = this.app.fileManager.getNewFileParent(this.sourceFile.path, fileName);
      this._targetFile = await this.app.fileManager.createNewMarkdownFile(parentFolder, fileName, '');
      return;
    }

    if (item?.type === 'bookmark' && item.item?.type === 'file') {
      const bookmarkFile = this.app.vault.getFileByPath(item.item.path ?? '');
      if (bookmarkFile) {
        this._targetFile = bookmarkFile;
        return;
      }

      throw new Error('Bookmark file not found');
    }

    if (item?.file) {
      this._targetFile = item.file;
      return;
    }

    throw new Error('No valid file selected');
  }

  private async selectItemForSplit(item: Item | null, isMod: boolean, inputValue: string): Promise<void> {
    if (isMod || !item) {
      this._targetFile = await this.createNewMarkdownFileFromLinktext(inputValue);
      return;
    }

    if (item.type === 'unresolved') {
      this._targetFile = await this.createNewMarkdownFileFromLinktext(item.linktext ?? '');
      return;
    }

    if (item.type === 'file' || item.type === 'alias') {
      if (!item.file) {
        throw new Error('File not found');
      }
      this._targetFile = item.file;
      return;
    }

    this._targetFile = await this.createNewMarkdownFileFromLinktext(inputValue);
  }
}

export function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}
