import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  TFile
} from 'obsidian';

import { EditorCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/editor-command-handler';
import {
  buildBacklinksSnapshot,
  editBacklinksSnapshot,
  generateMarkdownLink
} from '@mnaoumov/obsidian-lib/link';
import {
  getBacklinksForFileSafe,
  getCacheSafe
} from '@mnaoumov/obsidian-lib/metadata-cache';
import { parseLink } from '@mnaoumov/obsidian-lib/parse-link';
import { getAvailablePath } from '@mnaoumov/obsidian-lib/vault';
import { join } from '@mnaoumov/typescript-lib/path';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { fixFileName } from '../composers/filename-validation.ts';
import { runLockedTransaction } from '../composers/locked-transaction.ts';
import { isEditorCommandBlocked } from '../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import {
  buildOperationNoticeContent,
  disposeOperationProgressNotice,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../ui/operation-notices.ts';
import { relocateAttachments } from './attachments.ts';
import {
  buildAttachmentNoteContent,
  countReferences,
  findAttachmentReferenceAtCursor,
  findBlockIdOnLine,
  isLinkToBlock,
  removeBlockId,
  replaceReference,
  resolveAttachmentName
} from './extract-attachment-into-note.ts';

interface ExtractAttachmentIntoNoteEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface ExtractAttachmentIntoNoteEditorCommandHandlerExtractInTransactionParams {
  readonly abortSignal: AbortSignal;
  readonly noteFile: TFile;
  readonly plan: ExtractionPlan;
  readonly vaultTransaction: VaultTransaction;
}

interface ExtractionPlan {
  readonly aliases: readonly string[];
  readonly attachment: TFile;
  readonly blockId: null | string;
  readonly ch: number;
  readonly line: number;
  readonly notePath: string;
  readonly parentFile: TFile;
}

// Filled in by the transaction body, which cannot return a value through `runLockedTransaction`.
interface ExtractionResult {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Written by the transaction body.
  noteFile: null | TFile;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Written by the transaction body.
  rewrittenLinkCount: number;
}

/**
 * `Extract attachment into its own note`: moves the attachment under the cursor out of its parent note into
 * a note of its own (the block model to the attachment-note model).
 *
 * The new note sits beside the parent, is named after the attachment's link text (else its file name),
 * records that link text in `aliases`, and embeds the attachment, which moves into the new note's attachment
 * folder through `getAttachmentFilePath` — the resolution `Custom Attachment Location` answers when it is
 * installed. The parent's reference becomes a link to the new note, every `[[parent#^block]]` link to the
 * line's block becomes a link to the new note with its display text kept, and the block id is then dropped,
 * since nothing points at it any more.
 *
 * It refuses an attachment referenced from anywhere but that one reference: a second reference would be
 * left pointing at a file the new note now owns. The whole operation is one reversible transaction.
 */
export class ExtractAttachmentIntoNoteEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: ExtractAttachmentIntoNoteEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-file-output',
      id: 'extract-attachment-into-own-note',
      name: 'Extract attachment into its own note'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    return !isEditorCommandBlocked({ commandCategory: CommandCategory.SplitAndExtract, context, pluginSettingsComponent: this.pluginSettingsComponent }) && this.findReference(editor, context) !== null;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const parentFile = context.file;
    if (!parentFile) {
      return;
    }

    // Flushes the editor buffer and re-indexes the note, so the offsets below match what is on disk.
    const cache = await getCacheSafe(this.app, parentFile);
    const found = cache ? this.findReferenceInCache(editor, parentFile, cache) : null;
    if (!cache || !found) {
      this.pluginNoticeComponent.showNotice('No attachment under the cursor.');
      return;
    }

    const { attachment, reference } = found;
    if (countReferences(this.app, attachment) !== 1) {
      this.pluginNoticeComponent.showNotice(
        `${attachment.path} is referenced from more than one place. Only an attachment referenced once, from its parent note, can be extracted.`
      );
      return;
    }

    const attachmentName = resolveAttachmentName(reference, attachment);
    const settings = this.pluginSettingsComponent.settings;
    const noteName = fixFileName({
      fileName: attachmentName.name,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: true,
      shouldTreatTitleAsPath: false
    });
    const plan: ExtractionPlan = {
      aliases: attachmentName.isFromLinkText ? [attachmentName.name] : [],
      attachment,
      blockId: findBlockIdOnLine(cache, reference.position.start.line),
      ch: reference.position.start.col,
      line: reference.position.start.line,
      notePath: getAvailablePath(this.app, join(parentFile.parent?.path ?? '', `${noteName}.md`)),
      parentFile
    };

    await this.extract(plan);
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return checkShouldAddCommandToEditorMenu({
      commandId: this.id,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(_view: MarkdownView, mode: string, _source: string): boolean {
    return checkShouldAddCommandToViewportMenu({
      commandId: this.id,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  private async extract(plan: ExtractionPlan): Promise<void> {
    const abortController = new AbortController();
    const result: ExtractionResult = { noteFile: null, rewrittenLinkCount: 0 };
    const progressNotice = showOperationProgressNotice({
      abortController,
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          sourcePathOrAbstractFile: plan.attachment,
          verb: 'Extracting attachment'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          const noteFile = await vaultTransaction.create(plan.notePath, '');
          result.noteFile = noteFile;
          result.rewrittenLinkCount = await this.extractInTransaction({ abortSignal: abortController.signal, noteFile, plan, vaultTransaction });
        },
        lockTargets: [{ mode: 'file', pathOrFile: plan.parentFile }],
        operationName: 'Extract attachment into its own note',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      throw error;
    } finally {
      disposeOperationProgressNotice(progressNotice);
    }

    const noteFile = result.noteFile;
    if (!noteFile) {
      return;
    }
    const rewrittenLinkCount = result.rewrittenLinkCount;

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        preposition: 'into',
        sourcePathOrAbstractFile: plan.attachment,
        suffix: rewrittenLinkCount > 0 ? ` and updated ${String(rewrittenLinkCount)} link(s)` : '',
        targetPathOrAbstractFile: noteFile,
        verb: 'Extracted attachment'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  private async extractInTransaction(params: ExtractAttachmentIntoNoteEditorCommandHandlerExtractInTransactionParams): Promise<number> {
    const {
      abortSignal,
      noteFile,
      plan,
      vaultTransaction
    } = params;
    const { attachment, parentFile } = plan;

    // Captured BEFORE anything moves: the parent's reference is about to stop pointing at the attachment,
    // and the links to its block are the ones to carry over to the new note.
    const backlinks = await getBacklinksForFileSafe({ app: this.app, pathOrFile: parentFile });
    const snapshot = buildBacklinksSnapshot({ backlinks, payloadProvider: () => undefined });

    // The vault's own rename, so the parent's reference follows the attachment to its new path.
    await relocateAttachments({
      app: this.app,
      relocations: [{ attachment, newNoteFile: noteFile, oldNoteFile: parentFile }],
      vaultTransaction
    });

    const embed = generateMarkdownLink({ app: this.app, isEmbed: true, sourcePathOrFile: noteFile, targetPathOrFile: attachment });
    await vaultTransaction.modify(noteFile, buildAttachmentNoteContent(plan.aliases, embed));

    // Re-read after the rename rewrote the reference, so the offsets are current.
    const cache = await getCacheSafe(this.app, parentFile);
    const settings = this.pluginSettingsComponent.settings;
    const found = cache
      ? findAttachmentReferenceAtCursor({
        app: this.app,
        attachmentExtensions: settings.attachmentExtensions,
        cache,
        ch: plan.ch,
        line: plan.line,
        noteFile: parentFile
      })
      : null;
    if (found?.attachment !== attachment) {
      throw new Error(`Could not find the reference to ${attachment.path} in ${parentFile.path} after moving it.`);
    }
    const noteLink = generateMarkdownLink({ app: this.app, sourcePathOrFile: parentFile, targetPathOrFile: noteFile });
    await vaultTransaction.process(parentFile, (content) => replaceReference({ content, newLink: noteLink, reference: found.reference }));

    const blockId = plan.blockId;
    if (blockId === null) {
      return 0;
    }

    let rewrittenLinkCount = 0;
    await editBacklinksSnapshot({
      abortSignal,
      app: this.app,
      pluginNoticeComponent: this.pluginNoticeComponent,
      referenceConverter: ({ reference, sourcePath }) => {
        if (!isLinkToBlock(reference, blockId)) {
          return null;
        }
        const parsed = parseLink(reference.original);
        rewrittenLinkCount++;
        return generateMarkdownLink({
          ...parsed?.alias !== undefined && { alias: parsed.alias },
          app: this.app,
          isEmbed: parsed?.isEmbed ?? false,
          originalLink: reference.original,
          sourcePathOrFile: sourcePath,
          targetPathOrFile: noteFile
        });
      },
      resourceLockComponent: this.resourceLockComponent,
      snapshot
    });

    await vaultTransaction.process(parentFile, (content) => removeBlockId({ blockId, content, line: plan.line }));
    return rewrittenLinkCount;
  }

  private findReference(editor: Editor, context: MarkdownFileInfo): null | ReturnType<typeof findAttachmentReferenceAtCursor> {
    const file = context.file;
    if (!file) {
      return null;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    return cache ? this.findReferenceInCache(editor, file, cache) : null;
  }

  private findReferenceInCache(
    editor: Editor,
    file: TFile,
    cache: NonNullable<ReturnType<App['metadataCache']['getFileCache']>>
  ): ReturnType<typeof findAttachmentReferenceAtCursor> {
    const cursor = editor.getCursor();
    return findAttachmentReferenceAtCursor({
      app: this.app,
      attachmentExtensions: this.pluginSettingsComponent.settings.attachmentExtensions,
      cache,
      ch: cursor.ch,
      line: cursor.line,
      noteFile: file
    });
  }
}
