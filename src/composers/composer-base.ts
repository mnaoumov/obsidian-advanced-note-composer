import type { HeadingInfo } from '@obsidian-typings/obsidian-public-latest';
import type {
  CachedMetadata,
  FrontMatterInfo,
  Pos
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import {
  App,
  Editor,
  getFrontMatterInfo,
  moment as moment_,
  parseLinktext,
  parseYaml,
  stringifyYaml,
  TFile
} from 'obsidian';
import { noop } from 'obsidian-dev-utils/function';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { extractDefaultExportInterop } from 'obsidian-dev-utils/object-utils';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import {
  editLinks,
  updateLink,
  updateLinksInContent
} from 'obsidian-dev-utils/obsidian/link';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  getBacklinksForFileSafe,
  getCacheSafe,
  getFrontmatterSafe
} from 'obsidian-dev-utils/obsidian/metadata-cache';
import { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';
import { replaceAll } from 'obsidian-dev-utils/string';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { InsertMode } from '../insert-mode.ts';
import { parseMarkdownHeadingDocument } from '../markdown-heading-document.ts';
import {
  Action,
  FrontmatterMergeStrategy
} from '../plugin-settings.ts';

export function getInsertModeFromEvent(evt: KeyboardEvent | MouseEvent): InsertMode {
  return evt.shiftKey ? InsertMode.Prepend : InsertMode.Append;
}

/**
 * Resolves the offset at which {@link InsertMode} inserts content into the given note content: the end
 * of the note for {@link InsertMode.Append} (bottom), or just after any frontmatter for
 * {@link InsertMode.Prepend} (top).
 *
 * @param content - The note content to resolve the offset in.
 * @param insertMode - Whether to insert at the top (prepend) or bottom (append).
 * @returns The insert offset.
 */
export function resolveInsertOffset(content: string, insertMode: InsertMode): number {
  if (insertMode === InsertMode.Prepend) {
    return getFrontMatterInfo(content).contentStart;
  }
  return content.length;
}

const moment = extractDefaultExportInterop(moment_);

export interface ComposerBaseConstructorParamsBase {
  readonly app: App;
  readonly frontmatterMergeStrategy?: FrontmatterMergeStrategy;
  readonly insertMode?: InsertMode;

  /**
   * When set, the content is inserted by replacing this unique token in the target note (placed at the
   * paste cursor) instead of being appended/prepended. Used by the move (mark → move here) flow.
   */
  readonly insertToken?: string | undefined;
  readonly isNewTargetFile: boolean;
  readonly pluginNoticeComponent: PluginNoticeComponent;

  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly shouldFixFootnotes?: boolean;
  readonly shouldMergeHeadings?: boolean;
  readonly shouldShowNotice?: boolean;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;

  /**
   * An outer transaction to run this operation's mutations against (e.g. a folder merge spanning many
   * files). When provided, {@link ComposerBase.runLockedTransaction} reuses it and does NOT lock,
   * commit, or roll back — the outer owner does. When omitted, the operation owns its own transaction.
   */
  readonly vaultTransaction?: VaultTransaction;
}

export interface ComposerBaseFixBacklinksParams {
  readonly backlinksToFix: Map<string, string[]>;
  readonly updatedFilePaths: Set<string>;
  readonly updatedLinks: Set<string>;
}

export interface ComposerBaseUpdateEditorSelectionsParams {
  // eslint-disable-next-line obsidian-dev-utils/no-unused-params-members -- Shared hook params type; the overriding subclass reads these members, the base no-op does not.
  readonly sourceCache: CachedMetadata | null;
  // eslint-disable-next-line obsidian-dev-utils/no-unused-params-members -- Shared hook params type; the overriding subclass reads these members, the base no-op does not.
  readonly sourceFootnoteIdsToRemove: Set<string>;
  // eslint-disable-next-line obsidian-dev-utils/no-unused-params-members -- Shared hook params type; the overriding subclass reads these members, the base no-op does not.
  readonly sourceFootnoteIdsToRestore: Set<string>;
}

export interface Frontmatter extends GenericObject {
  title?: string;
}

export interface Selection {
  endOffset: number;
  startOffset: number;
}

interface ComposerBaseConstructorParams extends ComposerBaseConstructorParamsBase {
  readonly shouldIncludeFrontmatter: boolean;
}

interface ComposerBaseInsertContentParams {
  readonly contentToInsert: string;
  readonly existingContent: string;
}

interface ComposerBaseMergeFrontmatterParams {
  readonly newFrontmatter: Frontmatter;
  readonly originalFrontmatter: Frontmatter;
}

interface ComposerBaseMergeRecursivelyParams {
  readonly newObj: GenericObject;
  readonly oldObj: GenericObject;
}

interface ComposerBaseUpdateTargetFootnoteIdRenameMapParams {
  readonly existingTargetIds: Set<string>;
  readonly sourceFootnoteId: string;
  readonly targetFootnoteIdRenameMap: Map<string, string>;
}

interface ExtractFrontmatterResult {
  readonly content: string;
  readonly frontmatter: Frontmatter;
}

interface FileMtimes {
  readonly sourceMtime: number;
  readonly targetMtime: number;
}

interface GetSelectionUnderHeadingParams {
  readonly app: App;
  readonly editor: Editor;
  readonly file: TFile;
  readonly lineNumber: number;
}

export abstract class ComposerBase {
  protected readonly abortController = new AbortController();
  protected readonly app: App;
  /**
   * The outer transaction injected by a spanning operation (e.g. a folder merge), or `null` when this
   * operation owns its own transaction via {@link runLockedTransaction}.
   */
  protected readonly injectedVaultTransaction: null | VaultTransaction;
  protected readonly insertMode: InsertMode;

  /**
   * When set, {@link insertContent} inserts by replacing this token in the target note (see
   * {@link ComposerBaseConstructorParamsBase.insertToken}); `null` for the append/prepend flow.
   */
  protected readonly insertToken: null | string;
  protected readonly isNewTargetFile: boolean;

  protected readonly pluginNoticeComponent: PluginNoticeComponent;
  protected readonly pluginSettingsComponent: PluginSettingsComponent;
  protected readonly resourceLockComponent: ResourceLockComponent;
  protected readonly shouldShowNotice: boolean;
  protected readonly sourceFile: TFile;
  protected readonly targetFile: TFile;

  private frontmatterMergeStrategy: FrontmatterMergeStrategy;

  private readonly shouldFixFootnotes: boolean;
  private readonly shouldIncludeFrontmatter: boolean;

  private readonly shouldMergeHeadings: boolean;

  public constructor(params: ComposerBaseConstructorParams) {
    this.app = params.app;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.injectedVaultTransaction = params.vaultTransaction ?? null;

    this.insertMode = params.insertMode ?? InsertMode.Append;
    this.insertToken = params.insertToken ?? null;
    this.sourceFile = params.sourceFile;
    this.shouldIncludeFrontmatter = params.shouldIncludeFrontmatter;
    this.shouldFixFootnotes = params.shouldFixFootnotes ?? params.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = params.shouldMergeHeadings ?? params.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.frontmatterMergeStrategy = params.frontmatterMergeStrategy ?? params.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;
    this.shouldShowNotice = params.shouldShowNotice ?? true;
    this.targetFile = params.targetFile;
    this.isNewTargetFile = params.isNewTargetFile;
  }

  /**
   * Builds the progress notice content describing the operation from the source note to the target
   * note, with clickable links to both and a loading indicator. Passed to
   * {@link PluginNoticeComponent.showNoticeAfterDelay}, which keeps the links clickable without
   * dismissing the notice.
   *
   * @param verb - The progressive verb describing the operation, e.g. `Splitting` or `Merging`.
   * @returns A {@link Promise} resolving to the notice content fragment.
   */
  protected buildProgressContent(verb: string): Promise<DocumentFragment> {
    return createFragmentAsync(async (fragmentEl) => {
      fragmentEl.appendText(`${verb} note `);
      fragmentEl.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.sourceFile.path }));
      fragmentEl.appendText(' into ');
      fragmentEl.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.targetFile.path }));
      fragmentEl.createDiv('is-loading');
    });
  }

  /**
   * Captures the current modification times of the source and target notes so a later
   * {@link checkFilesUnchanged} call can detect external edits made during the operation.
   *
   * @returns The captured modification times.
   */
  protected captureFileMtimes(): FileMtimes {
    return {
      sourceMtime: this.sourceFile.stat.mtime,
      targetMtime: this.targetFile.stat.mtime
    };
  }

  /**
   * Checks whether the source and target notes are still unchanged since {@link captureFileMtimes}.
   * If either was modified (e.g. externally, or by sync) the operation is refused and a notice is
   * shown, guarding against clobbering external edits.
   *
   * @param mtimes - The modification times captured at the start of the operation.
   * @returns `true` if both notes are unchanged, `false` if the operation should be aborted.
   */
  protected async checkFilesUnchanged(mtimes: FileMtimes): Promise<boolean> {
    if (this.sourceFile.stat.mtime === mtimes.sourceMtime && this.targetFile.stat.mtime === mtimes.targetMtime) {
      return true;
    }

    this.pluginNoticeComponent.showNotice(
      await createFragmentAsync(async (f) => {
        f.appendText('Aborted because ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.sourceFile.path }));
        f.appendText(' or ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.targetFile.path }));
        f.appendText(' was modified during the operation.');
      })
    );
    return false;
  }

  protected async checkTargetFileIgnored(action: Action): Promise<boolean> {
    if (this.isPathIgnored(this.targetFile.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText(`You cannot ${action} into `);
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.targetFile.path }));
          f.appendText(' because this path is not allowed in the plugin settings.');
        })
      );
      return false;
    }
    return true;
  }

  /* v8 ignore start -- fixBacklinks contains defensive ?? on Map.get() results. */
  protected async fixBacklinks(params: ComposerBaseFixBacklinksParams): Promise<void> {
    const { backlinksToFix, updatedFilePaths, updatedLinks } = params;
    for (const backlinkPath of backlinksToFix.keys()) {
      const linkJsons = backlinksToFix.get(backlinkPath) ?? [];
      let linkIndex = 0;
      await editLinks({
        abortSignal: this.abortController.signal,
        app: this.app,
        linkConverter: (link) => {
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
        },
        pathOrFile: backlinkPath,
        resourceLockComponent: this.resourceLockComponent
      });
    }
  }

  protected abstract getSelections(): Promise<Selection[]>;

  protected abstract getTemplate(): string;

  protected async insertIntoTargetFile(targetContentToInsert: string, vaultTransaction: VaultTransaction): Promise<void> {
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

    await this.insertIntoTargetFileImpl(templateContent, vaultTransaction);

    if (this.frontmatterMergeStrategy !== FrontmatterMergeStrategy.KeepOriginalFrontmatter) {
      const originalTitle = originalFrontmatter.title;
      let mergedFrontmatter = this.mergeFrontmatter({ newFrontmatter, originalFrontmatter });
      mergedFrontmatter = this.mergeFrontmatter({ newFrontmatter: templateFrontmatter, originalFrontmatter: mergedFrontmatter });
      if (originalTitle === undefined) {
        // The target note has no `title`; by default the merged-in source title is discarded here.
        // When the setting is on, keep the merged title (the source note's, per the merge strategy) instead.
        if (!this.pluginSettingsComponent.settings.shouldUseSourceTitleWhenTargetHasNoTitle) {
          delete mergedFrontmatter.title;
        }
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
    await this.fixBacklinks({ backlinksToFix, updatedFilePaths, updatedLinks });
    if (updatedLinks.size > 0) {
      this.pluginNoticeComponent.showNotice(`Updated ${String(updatedLinks.size)} links in ${String(updatedFilePaths.size)} files.`);
    }

    if (!this.pluginSettingsComponent.settings.shouldRunTemplaterOnDestinationFile) {
      return;
    }

    const templaterPlugin = this.app.plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) {
      if (this.shouldShowNotice) {
        this.pluginNoticeComponent.showNotice(createFragment((f) => {
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

  /* v8 ignore stop */

  protected abstract prepareBacklinkSubpaths(): Set<string>;

  protected updateEditorSelections(_params: ComposerBaseUpdateEditorSelectionsParams): void {
    noop();
  }

  /* v8 ignore start -- applyTemplate contains defensive ?? on regex groups. */
  private applyTemplate(targetContentToInsert: string): string {
    return replaceAll({
      replacer: ({ groups }) => {
        const key = groups?.['Key'] ?? '';
        const format = groups?.['Format'];
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
            return moment().format(format ?? 'YYYY-MM-DD');
          case 'time':
            return moment().format(format ?? 'HH:mm');
          default:
            throw new Error(`Invalid template key: ${key}`);
        }
      },
      searchValue: /{{(?<Key>.+?)(?::(?<Format>.+?))?}}/g,
      str: this.getTemplate()
    });
  }

  private async canIncludeFrontmatter(): Promise<boolean> {
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

  /* v8 ignore stop */

  /* v8 ignore start -- fixFootnotes contains many defensive ?? and ?. on regex groups and cache properties. */
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
        this.updateTargetFootnoteIdRenameMap({ existingTargetIds, sourceFootnoteId: sourceFootnoteRef.id, targetFootnoteIdRenameMap });
        sourceFootnoteIdsToCopy.add(sourceFootnoteRef.id);
      } else {
        sourceFootnoteIdsToKeep.add(sourceFootnoteRef.id);
      }
    }

    for (const sourceFootnote of sourceCache?.footnotes ?? []) {
      const sourceFootnoteContent = `\n${sourceContent.slice(sourceFootnote.position.start.offset, sourceFootnote.position.end.offset)}`;

      if (this.isSelected(sourceFootnote.position, selections)) {
        this.updateTargetFootnoteIdRenameMap({ existingTargetIds, sourceFootnoteId: sourceFootnote.id, targetFootnoteIdRenameMap });
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

    targetContentToInsert = replaceAll({
      replacer: ({ groups }) => {
        const footnoteId = groups?.['FootnoteId'] ?? '';
        return `[^${targetFootnoteIdRenameMap.get(footnoteId) ?? footnoteId}]`;
      },
      searchValue: FOOTNOTE_ID_REG_EXP,
      str: targetContentToInsert
    });

    this.updateEditorSelections({ sourceCache, sourceFootnoteIdsToRemove, sourceFootnoteIdsToRestore });

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

  /* v8 ignore stop */

  private async includeFrontmatter(targetContentToInsert: string): Promise<string> {
    if (!this.shouldIncludeFrontmatter) {
      return targetContentToInsert;
    }

    if (!await this.canIncludeFrontmatter()) {
      return targetContentToInsert;
    }

    const sourceCache = await getCacheSafe(this.app, this.sourceFile);
    /* v8 ignore start -- defensive ?? on sourceCache?.frontmatter. */
    return `---\n${stringifyYaml(sourceCache?.frontmatter ?? {})}---\n${targetContentToInsert}`;
    /* v8 ignore stop */
  }

  /**
   * Replicates `FileManager.insertIntoFile`'s frontmatter-aware positioning so the insert can be routed
   * through a {@link VaultTransaction} (which must own the write to reverse it). Append adds the content
   * at the end; prepend inserts it right after any frontmatter.
   *
   * @param params - The parameters.
   * @returns The resulting content.
   */
  private insertContent(params: ComposerBaseInsertContentParams): string {
    const { contentToInsert, existingContent } = params;
    if (this.insertToken !== null) {
      // Move (mark → move here) flow: drop the content at the token placed at the paste cursor.
      return existingContent.replace(this.insertToken, contentToInsert);
    }
    const offset = resolveInsertOffset(existingContent, this.insertMode);
    return `${existingContent.slice(0, offset)}${contentToInsert}${existingContent.slice(offset)}`;
  }

  private async insertIntoTargetFileImpl(targetContentToInsert: string, vaultTransaction: VaultTransaction): Promise<void> {
    if (targetContentToInsert.startsWith('---\n')) {
      targetContentToInsert = `\n${targetContentToInsert}`;
    }
    if (!this.shouldMergeHeadings || this.insertToken !== null) {
      // Route the write through the transaction (which captures the old content and registers the
      // Restore) so a merge/split can be rolled back. This replicates FileManager.insertIntoFile's
      // Frontmatter-aware positioning in insertContent rather than calling it directly, because the
      // Transaction must own the write to be able to reverse it. The move (insertToken) flow always
      // Takes this path — it is a positional insert at the token, not a heading merge.
      await vaultTransaction.process(this.targetFile, (targetFileContent) => this.insertContent({ contentToInsert: targetContentToInsert, existingContent: targetFileContent }));
      return;
    }

    // VaultTransaction.process takes a synchronous content provider, but building the heading-merged
    // Content is async (parseMarkdownHeadingDocument), so compute it first and apply it via modify,
    // Which captures the old content for rollback exactly as process does.
    const targetFileContent = await this.app.vault.read(this.targetFile);
    const targetFileDocument = await parseMarkdownHeadingDocument(this.app, targetFileContent);
    const targetContentDocumentToInsert = await parseMarkdownHeadingDocument(this.app, targetContentToInsert);
    await targetContentDocumentToInsert.wrapText(this.wrapText.bind(this));
    const mergedDocument = targetFileDocument.mergeWith(targetContentDocumentToInsert, this.insertMode);
    await vaultTransaction.modify(this.targetFile, mergedDocument.toString());
  }

  private isPathIgnored(path: string): boolean {
    return this.pluginSettingsComponent.settings.isPathIgnored(path);
  }

  private isSelected(position: Pos, selections: Selection[]): boolean {
    return selections.some((selection) => {
      return selection.startOffset <= position.start.offset && position.end.offset <= selection.endOffset;
    });
  }

  private mergeFrontmatter(params: ComposerBaseMergeFrontmatterParams): Frontmatter {
    const { newFrontmatter, originalFrontmatter } = params;
    /* v8 ignore start -- KeepOriginalFrontmatter and default cases are unreachable from insertIntoTargetFile. */
    switch (this.frontmatterMergeStrategy) {
      case FrontmatterMergeStrategy.KeepOriginalFrontmatter:
        return originalFrontmatter;
      /* v8 ignore stop */
      case FrontmatterMergeStrategy.MergeAndPreferNewValues:
        return this.mergeRecursively({ newObj: newFrontmatter, oldObj: originalFrontmatter });
      case FrontmatterMergeStrategy.MergeAndPreferOriginalValues:
        return this.mergeRecursively({ newObj: originalFrontmatter, oldObj: newFrontmatter });
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
      /* v8 ignore start -- all valid enum values are handled above. */
      default:
        throw new Error(`Invalid frontmatter merge strategy: ${this.frontmatterMergeStrategy as string}`);
        /* v8 ignore stop */
    }
  }

  private mergeRecursively(params: ComposerBaseMergeRecursivelyParams): GenericObject {
    const { newObj, oldObj } = params;
    const oldKeys = Object.keys(oldObj);
    for (const [newKey, newValue] of Object.entries(newObj)) {
      if (oldKeys.includes(newKey)) {
        const oldValue = oldObj[newKey];
        if (oldValue === undefined || oldValue === null) {
          oldObj[newKey] = newValue;
        } else if (Array.isArray(oldObj[newKey]) && Array.isArray(newValue)) {
          oldObj[newKey] = [...oldObj[newKey], ...newValue].unique();
        } else if (typeof oldObj[newKey] === 'object' && typeof newValue === 'object') {
          oldObj[newKey] = this.mergeRecursively({ newObj: newValue as GenericObject, oldObj: oldObj[newKey] as GenericObject });
        } else {
          oldObj[newKey] = newValue;
        }
      } else {
        oldObj[newKey] = newValue;
      }
    }
    return oldObj;
  }

  /* v8 ignore start -- prepareBacklinksToFix contains defensive ?? on Map.get() and cache properties. */
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

    const backlinks = await getBacklinksForFileSafe({ app: this.app, pathOrFile: this.sourceFile });
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

  /* v8 ignore stop */

  private safeParseFrontmatter(frontmatterInfo: FrontMatterInfo): Frontmatter {
    try {
      return (parseYaml(frontmatterInfo.frontmatter) as Frontmatter | null) ?? {};
    } catch {
      frontmatterInfo.contentStart = 0;
      return {};
    }
  }

  private updateTargetFootnoteIdRenameMap(params: ComposerBaseUpdateTargetFootnoteIdRenameMapParams): void {
    const { existingTargetIds, sourceFootnoteId, targetFootnoteIdRenameMap } = params;
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

  /* v8 ignore start -- wrapText branches for empty/newline trimming are defensive. */
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
  /* v8 ignore stop */
}

export function getSelectionUnderHeading(params: GetSelectionUnderHeadingParams): HeadingInfo | null {
  const { app, editor, file, lineNumber } = params;
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
