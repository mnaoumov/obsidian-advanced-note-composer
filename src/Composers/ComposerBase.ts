import type {
  CachedMetadata,
  FrontMatterInfo,
  Pos
} from 'obsidian';
import type { GenericObject } from 'obsidian-dev-utils/ObjectUtils';
import type { HeadingInfo } from 'obsidian-typings';

import {
  App,
  Editor,
  getFrontMatterInfo,
  moment as moment_,
  Notice,
  parseLinktext,
  parseYaml,
  stringifyYaml,
  TFile
} from 'obsidian';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/HTMLElement';
import { extractDefaultExportInterop } from 'obsidian-dev-utils/ObjectUtils';
import {
  editLinks,
  updateLink,
  updateLinksInContent
} from 'obsidian-dev-utils/obsidian/Link';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';
import {
  getBacklinksForFileSafe,
  getCacheSafe,
  getFrontmatterSafe
} from 'obsidian-dev-utils/obsidian/MetadataCache';
import { process } from 'obsidian-dev-utils/obsidian/Vault';
import {
  replaceAll
} from 'obsidian-dev-utils/String';

import type { Plugin } from '../Plugin.ts';

import { parseMarkdownHeadingDocument } from '../MarkdownHeadingDocument.ts';
import {
  Action,
  FrontmatterMergeStrategy
} from '../PluginSettings.ts';

export enum InsertMode {
  Append = 'append',
  Prepend = 'prepend'
}

export function getInsertModeFromEvent(evt: KeyboardEvent | MouseEvent): InsertMode {
  return evt.shiftKey ? InsertMode.Prepend : InsertMode.Append;
}

const moment = extractDefaultExportInterop(moment_);

export interface ComposerBaseOptions {
  editor?: Editor;
  heading?: string;
  plugin: Plugin;
  sourceFile: TFile;
}

interface ExtractFrontmatterResult {
  content: string;
  frontmatter: Frontmatter;
}

export interface Frontmatter extends GenericObject {
  title?: string;
}

export interface Selection {
  endOffset: number;
  startOffset: number;
}

export abstract class ComposerBase {
  public readonly app: App;
  public frontmatterMergeStrategy: FrontmatterMergeStrategy;

  public insertMode: InsertMode = InsertMode.Append;
  public shouldAllowOnlyCurrentFolder: boolean;
  public shouldAllowSplitIntoUnresolvedPath: boolean;
  public shouldFixFootnotes: boolean;
  public shouldIncludeFrontmatter: boolean;
  public shouldMergeHeadings: boolean;
  public shouldShowNotice = true;
  public shouldTreatTitleAsPath: boolean;
  public readonly sourceFile: TFile;
  public get targetFile(): TFile {
    if (!this._targetFile) {
      throw new Error('Target file not set');
    }
    return this._targetFile;
  }
  public set targetFile(value: TFile) {
    this._targetFile = value;
  }

  protected _targetFile?: TFile;

  public isNewTargetFile = false;
  protected readonly plugin: Plugin;

  public constructor(options: ComposerBaseOptions) {
    this.plugin = options.plugin;
    this.sourceFile = options.sourceFile;
    this.app = this.plugin.app;
    this.shouldIncludeFrontmatter = this.plugin.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = this.plugin.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = this.plugin.settings.shouldFixFootnotesByDefault;
    this.shouldAllowOnlyCurrentFolder = this.plugin.settings.shouldAllowOnlyCurrentFolderByDefault;
    this.shouldMergeHeadings = this.plugin.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = this.plugin.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = this.plugin.settings.defaultFrontmatterMergeStrategy;
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

  private applyTemplate(targetContentToInsert: string): string {
    return replaceAll(this.getTemplate(), /{{(?<Key>.+?)(?::(?<Format>.+?))?}}/g, (_, key, format) => {
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

  protected async checkTargetFileIgnored(action: Action): Promise<boolean> {
    if (this.isPathIgnored(this.targetFile.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText(`You cannot ${action} into `);
          f.appendChild(await renderInternalLink(this.app, this.targetFile.path));
          f.appendText(' because this path is not allowed in the plugin settings.');
        })
      );
      return false;
    }
    return true;
  }

  private extractFrontmatter(str: string): ExtractFrontmatterResult {
    if (this.frontmatterMergeStrategy === FrontmatterMergeStrategy.KeepOriginalFrontmatter) {
      return {
        content: str,
        frontmatter: {}
      };
    }

    const frontmatterInfo = getFrontMatterInfo(str);
    const frontmatter = this.safeParseFrontmatter(frontmatterInfo);

    return {
      content: str.slice(frontmatterInfo.contentStart),
      frontmatter
    };
  }

  protected async fixBacklinks(backlinksToFix: Map<string, string[]>, updatedFilePaths: Set<string>, updatedLinks: Set<string>): Promise<void> {
    for (const backlinkPath of backlinksToFix.keys()) {
      const linkJsons = backlinksToFix.get(backlinkPath) ?? [];
      let linkIndex = 0;
      await editLinks(this.app, backlinkPath, (link) => {
        linkIndex++;
        if (!linkJsons.includes(JSON.stringify(link))) {
          return;
        }

        updatedFilePaths.add(backlinkPath);
        updatedLinks.add(`${backlinkPath}//${String(linkIndex)}`);

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

    this.updateEditorSelections(sourceCache, sourceFootnoteIdsToRemove, sourceFootnoteIdsToRestore);

    return targetContentToInsert;
  }

  protected updateEditorSelections(_sourceCache: CachedMetadata | null, _sourceFootnoteIdsToRemove: Set<string>, _sourceFootnoteIdsToRestore: Set<string>): void {}

  private async fixLinks(targetContentToInsert: string): Promise<string> {
    return await updateLinksInContent({
      app: this.app,
      content: targetContentToInsert,
      newSourcePathOrFile: this.targetFile,
      oldSourcePathOrFile: this.sourceFile
    });
  }

  protected abstract getSelections(): Promise<Selection[]>;

  protected abstract getTemplate(): string;

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

  protected async insertIntoTargetFile(targetContentToInsert: string): Promise<void> {
    targetContentToInsert = await this.includeFrontmatter(targetContentToInsert);
    targetContentToInsert = await this.fixFootnotes(targetContentToInsert);
    targetContentToInsert = await this.fixLinks(targetContentToInsert);
    const backlinksToFix = await this.prepareBacklinksToFix();

    const originalFrontmatter = await getFrontmatterSafe<Frontmatter>(this.app, this.targetFile);

    if (this.isNewTargetFile) {
      this.frontmatterMergeStrategy = FrontmatterMergeStrategy.MergeAndPreferNewValues;
    }

    const { content: newContent, frontmatter: newFrontmatter } = this.extractFrontmatter(targetContentToInsert);
    targetContentToInsert = this.applyTemplate(newContent);
    const { content: templateContent, frontmatter: templateFrontmatter } = this.extractFrontmatter(targetContentToInsert);

    await this.insertIntoTargetFileImpl(templateContent);

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

    const updatedFilePaths = new Set<string>();
    const updatedLinks = new Set<string>();
    await this.fixBacklinks(backlinksToFix, updatedFilePaths, updatedLinks);
    if (updatedLinks.size > 0) {
      new Notice(`Updated ${String(updatedLinks.size)} links in ${String(updatedFilePaths.size)} files.`);
    }

    if (!this.plugin.settings.shouldRunTemplaterOnDestinationFile) {
      return;
    }

    const templaterPlugin = this.app.plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) {
      if (this.shouldShowNotice) {
        new Notice(createFragment((f) => {
          f.appendText('Advanced Note Composer: You have enabled setting ');
          appendCodeBlock(f, 'Should run templater on destination file');
          f.appendText(', but Templater plugin is not installed.');
        }));
      }
      return;
    }
    const isActiveFile = this.app.workspace.getActiveFile() === this.targetFile;
    await templaterPlugin.templater.overwrite_file_commands(this.targetFile, isActiveFile);
  }

  private async insertIntoTargetFileImpl(targetContentToInsert: string): Promise<void> {
    if (targetContentToInsert.startsWith('---\n')) {
      targetContentToInsert = `\n${targetContentToInsert}`;
    }
    if (!this.shouldMergeHeadings) {
      await this.app.fileManager.insertIntoFile(this.targetFile, targetContentToInsert, this.insertMode);
      return;
    }

    await process(this.app, this.targetFile, async (_, targetFileContent) => {
      const targetFileDocument = await parseMarkdownHeadingDocument(this.app, targetFileContent);
      const targetContentDocumentToInsert = await parseMarkdownHeadingDocument(this.app, targetContentToInsert);
      await targetContentDocumentToInsert.wrapText(this.wrapText.bind(this));
      const mergedDocument = targetFileDocument.mergeWith(targetContentDocumentToInsert, this.insertMode);
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

  protected abstract prepareBacklinkSubpaths(): Set<string>;

  private async prepareBacklinksToFix(): Promise<Map<string, string[]>> {
    const selections = await this.getSelections();
    const cache = this.app.metadataCache.getFileCache(this.sourceFile) ?? {};
    const subpaths = this.prepareBacklinkSubpaths();

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

  private safeParseFrontmatter(frontmatterInfo: FrontMatterInfo): Frontmatter {
    try {
      return parseYaml(frontmatterInfo.frontmatter) as Frontmatter | null ?? {};
    } catch {
      frontmatterInfo.contentStart = 0;
      return {};
    }
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
