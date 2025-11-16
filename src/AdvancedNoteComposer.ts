import type {
  EditorSelection,
  Pos
} from 'obsidian';
import type { GenericObject } from 'obsidian-dev-utils/ObjectUtils';
import type { HeadingInfo } from 'obsidian-typings';

import moment from 'moment';
import {
  App,
  Editor,
  getFrontMatterInfo,
  Notice,
  parseLinktext,
  parseYaml,
  stringifyYaml,
  TFile
} from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { addAlias } from 'obsidian-dev-utils/obsidian/FileManager';
import {
  editLinks,
  updateLink,
  updateLinksInContent
} from 'obsidian-dev-utils/obsidian/Link';
import {
  getBacklinksForFileSafe,
  getCacheSafe,
  getFrontmatterSafe
} from 'obsidian-dev-utils/obsidian/MetadataCache';
import { process } from 'obsidian-dev-utils/obsidian/Vault';
import { join } from 'obsidian-dev-utils/Path';
import {
  replaceAll,
  trimEnd
} from 'obsidian-dev-utils/String';

import type { Plugin } from './Plugin.ts';
import type { Item } from './SuggestModalBase.ts';

import {
  INVALID_CHARACTERS_REG_EXP,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from './FilenameValidation.ts';
import { parseMarkdownHeadingDocument } from './MarkdownHeadingDocument.ts';
import {
  FrontmatterMergeStrategy,
  TextAfterExtractionMode
} from './PluginSettings.ts';

export type InsertMode = 'append' | 'prepend';

type Action = 'merge' | 'split';

interface Frontmatter extends GenericObject {
  title?: string;
}

interface Selection {
  endOffset: number;
  startOffset: number;
}

export class AdvancedNoteComposer {
  public action: Action = 'merge';

  public readonly app: App;
  public frontmatterMergeStrategy: FrontmatterMergeStrategy;
  public mode: InsertMode = 'append';
  public shouldAllowOnlyCurrentFolder: boolean;
  public shouldAllowSplitIntoUnresolvedPath: boolean;
  public shouldFixFootnotes: boolean;
  public shouldIncludeFrontmatter: boolean;
  public shouldMergeHeadings: boolean;
  public shouldTreatTitleAsPath: boolean;

  public get targetFile(): TFile {
    if (!this._targetFile) {
      throw new Error('Target file not set');
    }
    return this._targetFile;
  }

  private _targetFile?: TFile;

  public constructor(
    private readonly plugin: Plugin,
    public readonly sourceFile: TFile,
    public readonly editor?: Editor,
    public heading = ''
  ) {
    this.app = plugin.app;
    this.shouldIncludeFrontmatter = plugin.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = plugin.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = plugin.settings.shouldFixFootnotesByDefault;
    this.shouldAllowOnlyCurrentFolder = plugin.settings.shouldAllowOnlyCurrentFolderByDefault;
    this.shouldMergeHeadings = plugin.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = plugin.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = plugin.settings.defaultFrontmatterMergeStrategy;
    this.initHeading();
  }

  public async canIncludeFrontmatter(): Promise<boolean> {
    const sourceCache = await getCacheSafe(this.app, this.sourceFile);

    if (!sourceCache?.frontmatterPosition) {
      return false;
    }

    const selections = await this.getSelections();

    if (!selections[0]) {
      return false;
    }

    if (selections[0].startOffset < sourceCache.frontmatterPosition.end.offset) {
      return false;
    }

    return true;
  }

  public isPathIgnored(path: string): boolean {
    return this.plugin.settings.isPathIgnored(path);
  }

  public async mergeFile(doNotAskAgain: boolean): Promise<void> {
    if (!this.checkTargetFileIgnored('merge')) {
      return;
    }

    if (doNotAskAgain) {
      await this.plugin.settingsManager.editAndSave((settings) => {
        settings.shouldAskBeforeMerging = false;
      });
    }

    this.plugin.consoleDebug(`Merging note ${this.sourceFile.path} into ${this.targetFile.path}`);
    const sourceContent = await this.app.vault.read(this.sourceFile);
    await this.insertIntoTargetFile(sourceContent);
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

    if (!this.checkTargetFileIgnored('split')) {
      return;
    }

    this.plugin.consoleDebug(`Splitting note ${this.sourceFile.path} into ${this.targetFile.path}`);

    await this.insertIntoTargetFile(this.editor?.getSelection() ?? '');

    const markdownLink = this.app.fileManager.generateMarkdownLink(this.targetFile, this.sourceFile.path);

    switch (this.plugin.settings.textAfterExtractionMode) {
      case TextAfterExtractionMode.EmbedNewFile:
        this.editor?.replaceSelection(`!${markdownLink}`);
        break;
      case TextAfterExtractionMode.LinkToNewFile:
        this.editor?.replaceSelection(markdownLink);
        break;
      case TextAfterExtractionMode.None:
        this.editor?.replaceSelection('');
        break;
      default:
        throw new Error(`Invalid text after extraction mode: ${this.plugin.settings.textAfterExtractionMode as string}`);
    }
  }

  private applyTemplate(targetContentToInsert: string): string {
    let template = this.plugin.settings.template;
    if (!template) {
      return targetContentToInsert;
    }

    if (!template.includes('{{content}}')) {
      template += '\n\n{{content}}';
    }

    return replaceAll(template, /{{(?<Key>.+?)(?::(?<Format>.+?))?}}/g, (_, key, format) => {
      switch (key.toLowerCase()) {
        case 'fromPath'.toLowerCase():
          return this.sourceFile.path;
        case 'fromTitle'.toLowerCase():
          return this.sourceFile.basename;
        case 'newPath'.toLowerCase():
          return this.targetFile.path;
        case 'newTitle'.toLowerCase():
          return this.targetFile.basename;
        case 'content':
          return targetContentToInsert;
        case 'date':
          return moment().format(format || 'YYYY-MM-DD');
        case 'time':
          return moment().format(format || 'HH:mm');
        default:
          throw new Error(`Invalid template key: ${key}`);
      }
    });
  }

  private checkTargetFileIgnored(action: Action): boolean {
    if (this.isPathIgnored(this.targetFile.path)) {
      new Notice(createFragment((f) => {
        f.appendText(`You cannot ${action} into `);
        appendCodeBlock(f, this.targetFile.path);
        f.appendText(' because this path is not allowed in the plugin settings.');
      }));
      return false;
    }
    return true;
  }

  private async createNewMarkdownFileFromLinktext(fileName: string): Promise<TFile> {
    fileName = trimEnd(fileName, '.md');
    const fixedFileName = `${this.fixFileName(fileName)}.md`;
    const prefix = this.shouldAllowOnlyCurrentFolder ? `/${this.sourceFile.parent?.getParentPrefix() ?? ''}` : '';
    const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(prefix + fixedFileName, this.sourceFile.path);

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
    const fixedFilePaths = new Set<string>();
    const fixedLinks = new Set<string>();
    for (const backlinkPath of backlinksToFix.keys()) {
      const linkJsons = backlinksToFix.get(backlinkPath) ?? [];
      let linkIndex = 0;
      await editLinks(this.app, backlinkPath, (link) => {
        linkIndex++;
        if (!linkJsons.includes(JSON.stringify(link))) {
          return;
        }

        fixedFilePaths.add(backlinkPath);
        fixedLinks.add(`${backlinkPath}//${String(linkIndex)}`);

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

    if (fixedLinks.size > 0) {
      new Notice(`Fixed ${fixedLinks.size} links in ${fixedFilePaths.size} files.`);
    }
  }

  private fixFileName(fileName: string): string {
    if (!fileName) {
      return 'Untitled';
    }

    if (!this.shouldTreatTitleAsPath) {
      fileName = fileName.replaceAll('/', '\\');
    }

    if (!this.plugin.settings.shouldReplaceInvalidTitleCharacters) {
      return fileName;
    }

    const parts = fileName.split('/');
    const fixedParts = parts.filter((part) => !!part).map((part) => {
      let fixedPart = part;
      fixedPart = fixedPart.replaceAll(INVALID_CHARACTERS_REG_EXP, (substring) => this.plugin.settings.replacement.repeat(substring.length));
      fixedPart = fixedPart.replaceAll(TRAILING_DOTS_OR_SPACES_REG_EXP, (substring) => this.plugin.settings.replacement.repeat(substring.length));
      if (fixedPart.startsWith('.') || fixedPart.startsWith(' ')) {
        fixedPart = this.plugin.settings.replacement + fixedPart.slice(1);
      }
      return fixedPart;
    });
    return fixedParts.join('/');
  }

  private async fixFootnotes(targetContentToInsert: string): Promise<string> {
    if (!this.shouldFixFootnotes) {
      return targetContentToInsert;
    }

    const sourceCache = await getCacheSafe(this.app, this.sourceFile);
    const sourceContent = await this.app.vault.cachedRead(this.sourceFile);
    const targetContent = await this.app.vault.cachedRead(this.targetFile);

    const FOOTNOTE_ID_REG_EXP = /\[\^(?<FootnoteId>[^\s\]]+?)\]/g;
    const existingTargetIds = new Set<string>(Array.from(targetContent.matchAll(FOOTNOTE_ID_REG_EXP)).map((match) => match.groups?.['FootnoteId'] ?? ''));

    const selections = await this.getSelections();

    const sourceFootnoteIdsToCopy = new Set<string>();
    const sourceFootnoteIdsToKeep = new Set<string>();
    const sourceFootnoteIdsToRestore = new Set<string>();
    const sourceFootnoteIdsToRemove = new Set<string>();
    const targetFootnoteIdRenameMap = new Map<string, string>();

    for (const sourceFootnoteRef of sourceCache?.footnoteRefs ?? []) {
      if (this.isSelected(sourceFootnoteRef.position, selections)) {
        this.updateTargetFootnoteIdRenameMap(sourceFootnoteRef.id, targetFootnoteIdRenameMap, existingTargetIds);
        sourceFootnoteIdsToCopy.add(sourceFootnoteRef.id);
      } else {
        sourceFootnoteIdsToKeep.add(sourceFootnoteRef.id);
      }
    }

    for (const sourceFootnote of sourceCache?.footnotes ?? []) {
      const sourceFootnoteContent = `\n${sourceContent.slice(sourceFootnote.position.start.offset, sourceFootnote.position.end.offset)}`;

      if (this.isSelected(sourceFootnote.position, selections)) {
        this.updateTargetFootnoteIdRenameMap(sourceFootnote.id, targetFootnoteIdRenameMap, existingTargetIds);
        if (sourceFootnoteIdsToKeep.has(sourceFootnote.id)) {
          sourceFootnoteIdsToRestore.add(sourceFootnote.id);
        }
      } else if (sourceFootnoteIdsToCopy.has(sourceFootnote.id)) {
        targetContentToInsert += sourceFootnoteContent;
      }

      if (sourceFootnoteIdsToCopy.has(sourceFootnote.id) && !sourceFootnoteIdsToKeep.has(sourceFootnote.id)) {
        sourceFootnoteIdsToRemove.add(sourceFootnote.id);
      }
    }

    targetContentToInsert = replaceAll(targetContentToInsert, FOOTNOTE_ID_REG_EXP, (_, footnoteId) => {
      return `[^${targetFootnoteIdRenameMap.get(footnoteId) ?? footnoteId}]`;
    });

    if (this.editor) {
      let editorSelections = this.editor.listSelections();

      for (const sourceFootnote of sourceCache?.footnotes ?? []) {
        if (sourceFootnoteIdsToRemove.has(sourceFootnote.id)) {
          editorSelections.push({
            anchor: this.editor.offsetToPos(sourceFootnote.position.end.offset),
            head: this.editor.offsetToPos(sourceFootnote.position.start.offset)
          });
        } else if (sourceFootnoteIdsToRestore.has(sourceFootnote.id)) {
          editorSelections = this.removeSelectionRange(editorSelections, sourceFootnote.position);
        }
      }

      this.editor.setSelections(editorSelections);
    }

    return targetContentToInsert;
  }

  private async fixLinks(targetContentToInsert: string): Promise<string> {
    return await updateLinksInContent({
      app: this.app,
      content: targetContentToInsert,
      newSourcePathOrFile: this.targetFile,
      oldSourcePathOrFile: this.sourceFile
    });
  }

  private async getSelections(): Promise<Selection[]> {
    if (this.editor) {
      const selections = this.editor.listSelections().map((editorSelection) => {
        const selection: Selection = {
          endOffset: this.editor?.posToOffset(editorSelection.anchor) ?? 0,
          startOffset: this.editor?.posToOffset(editorSelection.head) ?? 0
        };

        if (selection.startOffset > selection.endOffset) {
          [selection.startOffset, selection.endOffset] = [selection.endOffset, selection.startOffset];
        }

        return selection;
      });

      return selections.sort((a, b) => a.startOffset - b.startOffset);
    }

    const content = await this.app.vault.read(this.sourceFile);

    return [{
      endOffset: content.length,
      startOffset: 0
    }];
  }

  private async includeFrontmatter(targetContentToInsert: string): Promise<string> {
    if (!this.shouldIncludeFrontmatter) {
      return targetContentToInsert;
    }

    if (!await this.canIncludeFrontmatter()) {
      return targetContentToInsert;
    }

    const sourceCache = await getCacheSafe(this.app, this.sourceFile);
    return `---\n${stringifyYaml(sourceCache?.frontmatter ?? {})}---\n${targetContentToInsert}`;
  }

  private initHeading(): void {
    if (!this.heading) {
      const selectedLines = this.editor?.getSelection().split('\n') ?? [];
      if (selectedLines.length > 0) {
        const extractedHeading = extractHeadingFromLine(selectedLines[0] ?? '');
        this.heading = extractedHeading ?? '';
      }
    }

    if (this.heading) {
      this.shouldTreatTitleAsPath = false;
    }
  }

  private async insertIntoTargetFile(targetContentToInsert: string): Promise<void> {
    targetContentToInsert = await this.includeFrontmatter(targetContentToInsert);
    targetContentToInsert = await this.fixFootnotes(targetContentToInsert);
    targetContentToInsert = await this.fixLinks(targetContentToInsert);
    const backlinksToFix = await this.prepareBacklinksToFix();

    const originalFrontmatter = await getFrontmatterSafe<Frontmatter>(this.app, this.targetFile);
    let frontmatterInfo = getFrontMatterInfo(targetContentToInsert);
    const newFrontmatter = parseYaml(frontmatterInfo.frontmatter) as Frontmatter | null ?? {};

    targetContentToInsert = targetContentToInsert.slice(frontmatterInfo.contentStart);
    targetContentToInsert = this.applyTemplate(targetContentToInsert);
    frontmatterInfo = getFrontMatterInfo(targetContentToInsert);
    const templateFrontmatter = parseYaml(frontmatterInfo.frontmatter) as Frontmatter | null ?? {};
    targetContentToInsert = targetContentToInsert.slice(frontmatterInfo.contentStart);
    await this.insertIntoTargetFileImpl(targetContentToInsert);

    if (this.frontmatterMergeStrategy !== FrontmatterMergeStrategy.KeepOriginalFrontmatter) {
      const originalTitle = originalFrontmatter.title;
      let mergedFrontmatter = this.mergeFrontmatter(originalFrontmatter, newFrontmatter);
      mergedFrontmatter = this.mergeFrontmatter(mergedFrontmatter, templateFrontmatter);
      if (originalTitle === undefined) {
        delete mergedFrontmatter.title;
      } else {
        mergedFrontmatter.title = originalTitle;
      }
      await this.app.fileManager.processFrontMatter(this.targetFile, (frontmatter: Frontmatter) => {
        for (const key of Object.keys(frontmatter)) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- We need to empty the object.
          delete frontmatter[key];
        }
        Object.assign(frontmatter, mergedFrontmatter);
      });
    }

    await this.fixBacklinks(backlinksToFix);
  }

  private async insertIntoTargetFileImpl(targetContentToInsert: string): Promise<void> {
    if (!this.shouldMergeHeadings) {
      await this.app.fileManager.insertIntoFile(this.targetFile, targetContentToInsert, this.mode);
      return;
    }

    await process(this.app, this.targetFile, async (_, targetFileContent) => {
      const targetFileDocument = await parseMarkdownHeadingDocument(this.app, targetFileContent);
      const targetContentDocumentToInsert = await parseMarkdownHeadingDocument(this.app, targetContentToInsert);
      await targetContentDocumentToInsert.wrapText(this.wrapText.bind(this));
      const mergedDocument = targetFileDocument.mergeWith(targetContentDocumentToInsert, this.mode);
      return mergedDocument.toString();
    });
  }

  private isSelected(position: Pos, selections: Selection[]): boolean {
    return selections.some((selection) => {
      return selection.startOffset <= position.start.offset && position.end.offset <= selection.endOffset;
    });
  }

  private mergeFrontmatter(originalFrontmatter: Frontmatter, newFrontmatter: Frontmatter): Frontmatter {
    switch (this.frontmatterMergeStrategy) {
      case FrontmatterMergeStrategy.KeepOriginalFrontmatter:
        return originalFrontmatter;
      case FrontmatterMergeStrategy.MergeAndPreferNewValues:
        return this.mergeRecursively(originalFrontmatter as GenericObject, newFrontmatter as GenericObject) as Frontmatter;
      case FrontmatterMergeStrategy.MergeAndPreferOriginalValues:
        return this.mergeRecursively(newFrontmatter as GenericObject, originalFrontmatter as GenericObject) as Frontmatter;
      case FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter: {
        let suffix = 0;
        let mergeKey: string;
        let fromKey: string;
        let mergeDateKey: string;
        const oldKeys = Object.keys(originalFrontmatter);
        const newKeys = Object.keys(newFrontmatter);
        do {
          const suffixStr = suffix > 0 ? String(suffix) : '';
          mergeKey = `__merged${suffixStr}`;
          fromKey = `__from${suffixStr}`;
          mergeDateKey = `__mergeDate${suffixStr}`;
          suffix++;
        } while (oldKeys.includes(mergeKey) || newKeys.includes(fromKey) || newKeys.includes(mergeDateKey));

        return {
          ...originalFrontmatter,
          [mergeKey]: {
            [fromKey]: this.sourceFile.path,
            [mergeDateKey]: moment().format(),
            ...newFrontmatter
          }
        };
      }
      case FrontmatterMergeStrategy.ReplaceWithNewFrontmatter:
        return newFrontmatter;
      default:
        throw new Error(`Invalid frontmatter merge strategy: ${this.frontmatterMergeStrategy as string}`);
    }
  }

  private mergeRecursively(oldObj: GenericObject, newObj: GenericObject): GenericObject {
    const oldKeys = Object.keys(oldObj);
    for (const [newKey, newValue] of Object.entries(newObj)) {
      if (oldKeys.includes(newKey)) {
        const oldValue = oldObj[newKey];
        if (oldValue === undefined || oldValue === null) {
          oldObj[newKey] = newValue;
        } else if (Array.isArray(oldObj[newKey]) && Array.isArray(newValue)) {
          oldObj[newKey] = [...oldObj[newKey], ...newValue].unique();
        } else if (typeof oldObj[newKey] === 'object' && typeof newValue === 'object') {
          oldObj[newKey] = this.mergeRecursively(oldObj[newKey] as GenericObject, newValue as GenericObject);
        } else {
          oldObj[newKey] = newValue;
        }
      } else {
        oldObj[newKey] = newValue;
      }
    }
    return oldObj;
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

  private removeSelectionRange(editorSelections: EditorSelection[], rangeToRemove: Pos): EditorSelection[] {
    if (!this.editor) {
      return editorSelections;
    }

    const rangeStart = rangeToRemove.start.offset;
    const rangeEnd = rangeToRemove.end.offset;
    const result: EditorSelection[] = [];

    for (const selection of editorSelections) {
      let selectionStart = this.editor.posToOffset(selection.anchor);
      let selectionEnd = this.editor.posToOffset(selection.head);

      if (selectionStart > selectionEnd) {
        [selectionStart, selectionEnd] = [selectionEnd, selectionStart];
      }

      if (selectionEnd < rangeStart || selectionStart > rangeEnd) {
        result.push(selection);
      } else {
        const beforeRange = selectionStart < rangeStart;
        const afterRange = selectionEnd > rangeEnd;

        if (beforeRange) {
          result.push({
            anchor: this.editor.offsetToPos(selectionStart),
            head: this.editor.offsetToPos(rangeStart)
          });
        }

        if (afterRange) {
          result.push({
            anchor: this.editor.offsetToPos(rangeEnd),
            head: this.editor.offsetToPos(selectionEnd)
          });
        }
      }
    }

    return result;
  }

  private async selectItemForMerge(item: Item | null, isMod: boolean, inputValue: string): Promise<void> {
    if (isMod || item?.type === 'unresolved') {
      const fileName = item?.type === 'unresolved' ? item.linktext ?? '' : inputValue;
      const parentFolder = this.app.fileManager.getNewFileParent(this.sourceFile.path, fileName);

      const existingFile = this.app.metadataCache.getFirstLinkpathDest(join(parentFolder.path, fileName), '');
      if (existingFile && this.isPathIgnored(existingFile.path)) {
        this._targetFile = existingFile;
        return;
      }

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
      const existingFile = this.app.metadataCache.getFirstLinkpathDest(inputValue, '');
      if (existingFile && this.isPathIgnored(existingFile.path)) {
        this._targetFile = existingFile;
        return;
      }

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

  private updateTargetFootnoteIdRenameMap(sourceFootnoteId: string, targetFootnoteIdRenameMap: Map<string, string>, existingTargetIds: Set<string>): void {
    if (targetFootnoteIdRenameMap.has(sourceFootnoteId)) {
      return;
    }

    if (!existingTargetIds.has(sourceFootnoteId)) {
      existingTargetIds.add(sourceFootnoteId);
      return;
    }

    let suffixNum = 1;
    let newTargetFootnoteId = sourceFootnoteId;
    while (existingTargetIds.has(newTargetFootnoteId)) {
      newTargetFootnoteId = `${sourceFootnoteId}-${String(suffixNum)}`;
      suffixNum++;
    }

    targetFootnoteIdRenameMap.set(sourceFootnoteId, newTargetFootnoteId);
    existingTargetIds.add(newTargetFootnoteId);
  }

  private wrapText(text: string): string {
    text = text.trim();
    if (!text) {
      return '';
    }
    let wrappedText = this.applyTemplate(text);
    const frontmatterInfo = getFrontMatterInfo(wrappedText);
    wrappedText = wrappedText.slice(frontmatterInfo.contentStart);

    if (!wrappedText) {
      return '';
    }

    if (!wrappedText.endsWith('\n')) {
      wrappedText += '\n';
    }

    if (!wrappedText.startsWith('\n')) {
      wrappedText = `\n${wrappedText}`;
    }

    return wrappedText;
  }
}

export function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}

export function getSelectionUnderHeading(app: App, file: TFile, editor: Editor, lineNumber: number): HeadingInfo | null {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) {
    return null;
  }

  let headingAtLineNumber = null;
  let headingLevelAtLineNumber = 0;
  let nextHeading = null;
  for (const heading of cache.headings ?? []) {
    if (headingAtLineNumber && heading.level <= headingLevelAtLineNumber) {
      nextHeading = heading;
      break;
    }

    if (!headingAtLineNumber && heading.position.start.line === lineNumber) {
      headingLevelAtLineNumber = heading.level;
      headingAtLineNumber = heading;
    }
  }

  if (!headingAtLineNumber) {
    return null;
  }

  let headingEndLineNumber: number;
  if (nextHeading) {
    headingEndLineNumber = nextHeading.position.start.line - 1;
    while (!editor.getLine(headingEndLineNumber).trim() && headingEndLineNumber > lineNumber) {
      headingEndLineNumber--;
    }
  } else {
    headingEndLineNumber = editor.lineCount() - 1;
  }

  return {
    end: {
      ch: editor.getLine(headingEndLineNumber).length,
      line: headingEndLineNumber
    },
    heading: headingAtLineNumber.heading.trim(),
    start: {
      ch: 0,
      line: lineNumber
    }
  };
}
