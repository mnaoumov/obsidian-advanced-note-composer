import type { CommandHandlerRegistrationContext } from '@mnaoumov/obsidian-lib/command-handlers/command-handler';
import type { FileCommandHandlerShouldAddToFileMenuParams } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type {
  App,
  ReferenceCache,
  TFile
} from 'obsidian';

import { FileCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
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
import { noopAsync } from '@mnaoumov/typescript-lib/function';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from '../ui/confirm-dialog-modal.ts';
import type { AttachmentNoteAnalysis } from './inline-attachment-note.ts';

import { runLockedTransaction } from '../composers/locked-transaction.ts';
import { isFileOrFolderCommandBlocked } from '../settings/command-visibility/command-block.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import { ConfirmDialogModal } from '../ui/confirm-dialog-modal.ts';
import { openConfirmDialogModal } from '../ui/open-minimizable-modal.ts';
import {
  buildOperationNoticeContent,
  disposeOperationProgressNotice,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../ui/operation-notices.ts';
import { relocateAttachments } from './attachments.ts';
import {
  countReferences,
  findBlockIdOnLine,
  replaceReference
} from './extract-attachment-into-note.ts';
import {
  analyzeAttachmentNote,
  appendBlockId,
  findAttachmentNoteReference,
  findBlockEndLine,
  findParentCandidates,
  findReferencesToNote,
  generateBlockId,
  isLinkToRewrite,
  pickMainReference
} from './inline-attachment-note.ts';
import { selectParentNote } from './select-parent-note-modal.ts';

interface BuildDropsConfirmContentParams {
  readonly analysis: AttachmentNoteAnalysis;
  readonly fragment: DocumentFragment;
  readonly noteFile: TFile;
}
interface InlineAttachmentNoteCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface InlineAttachmentNoteCommandHandlerInlineInTransactionParams {
  readonly abortSignal: AbortSignal;
  readonly plan: InlinePlan;
  readonly vaultTransaction: VaultTransaction;
}

interface InlinePlan {
  readonly analysis: AttachmentNoteAnalysis;
  readonly existingBlockId: null | string;
  readonly existingBlockIds: ReadonlySet<string>;
  readonly mainReference: ReferenceCache;
  readonly noteFile: TFile;
  readonly parentFile: TFile;
}

// Filled in by the transaction body, which cannot return a value through `runLockedTransaction`.
interface InlineResult {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Written by the transaction body.
  isDone: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Written by the transaction body.
  rewrittenLinkCount: number;
}

/**
 * `Inline attachment note into its parent`: the reverse of `Extract attachment into its own note`, moving an
 * attachment from the attachment-note model back to the block model.
 *
 * Run on an attachment note (its body holds one reference, to an attachment), it moves the attachment into the
 * parent's attachment folder, puts it on the parent's line in place of the parent's link to the note, carrying
 * the note's first alias as link text, points every other link to the note at that line's block (adding a
 * block id only when something links it) with its display text kept, and trashes the note.
 *
 * The parent is the one note whose body links the attachment note; with several, the user picks one, and with
 * none the command is not offered. An attachment referenced from anywhere but the note is refused, and when
 * the note holds more aliases, other properties or other text, the dialog lists what would be dropped before
 * anything changes. The whole operation is one reversible transaction.
 */
export class InlineAttachmentNoteCommandHandler extends FileCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private registrationShouldAddCommandToSubmenu: boolean | null = null;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: InlineAttachmentNoteCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-file-input',
      id: 'inline-attachment-note-into-parent',
      name: 'Inline attachment note into its parent'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  public override async onRegistered(context: CommandHandlerRegistrationContext): Promise<void> {
    await super.onRegistered(context);
    this.registrationShouldAddCommandToSubmenu = context.shouldAddCommandToSubmenu ?? null;
  }

  protected override canExecuteFile(file: TFile): boolean {
    if (!isMarkdownFile(file) || isFileOrFolderCommandBlocked({ abstractFile: file, commandCategory: CommandCategory.Merge, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    return !!cache
      && findAttachmentNoteReference({ app: this.app, attachmentExtensions: this.pluginSettingsComponent.settings.attachmentExtensions, cache, noteFile: file }) !== null
      && findParentCandidates(this.app, file).length > 0;
  }

  protected override async executeFile(file: TFile): Promise<void> {
    const plan = await this.buildPlan(file);
    if (!plan) {
      return;
    }
    await this.inline(plan);
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    // `obsidian-lib` answers `false` both when nothing set it and when a menu surface that wraps every item in a
    // plugin-titled entry forced it off, so the registration's own answer is kept to let the setting fill only the
    // unset case.
    return this.registrationShouldAddCommandToSubmenu ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean {
    super.shouldAddToFileMenu(params);
    return true;
  }

  private async buildPlan(noteFile: TFile): Promise<InlinePlan | null> {
    const cache = await getCacheSafe(this.app, noteFile);
    const analysis = cache
      ? analyzeAttachmentNote({
        app: this.app,
        attachmentExtensions: this.pluginSettingsComponent.settings.attachmentExtensions,
        cache,
        content: await this.app.vault.read(noteFile),
        noteFile
      })
      : null;
    if (!analysis) {
      this.pluginNoticeComponent.showNotice(`${noteFile.path} is not an attachment note: its body must hold exactly one link or embed, to an attachment.`);
      return null;
    }

    if (countReferences(this.app, analysis.attachment) !== 1) {
      this.pluginNoticeComponent.showNotice(
        `${analysis.attachment.path} is referenced from more than one place. Only an attachment referenced once, from its attachment note, can be inlined.`
      );
      return null;
    }

    const parentFile = await this.selectParent(noteFile);
    if (!parentFile) {
      return null;
    }

    const parentCache = await getCacheSafe(this.app, parentFile);
    const mainReference = parentCache ? pickMainReference(findReferencesToNote({ app: this.app, cache: parentCache, noteFile, sourceFile: parentFile })) : null;
    if (!parentCache || !mainReference) {
      this.pluginNoticeComponent.showNotice(`${parentFile.path} no longer links ${noteFile.path}.`);
      return null;
    }

    if (!await this.confirmDrops(noteFile, analysis)) {
      return null;
    }

    return {
      analysis,
      existingBlockId: findBlockIdOnLine(parentCache, mainReference.position.start.line),
      existingBlockIds: new Set(Object.keys(parentCache.blocks ?? {})),
      mainReference,
      noteFile,
      parentFile
    };
  }

  private async confirmDrops(noteFile: TFile, analysis: AttachmentNoteAnalysis): Promise<boolean> {
    const { droppedAliases, droppedProperties, droppedText } = analysis;
    if (droppedAliases.length === 0 && droppedProperties.length === 0 && droppedText === '') {
      return true;
    }

    const result = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openConfirmDialogModal(
        new ConfirmDialogModal({
          app: this.app,
          buildContent: (fragment): Promise<void> => {
            buildDropsConfirmContent({ analysis, fragment, noteFile });
            return noopAsync();
          },
          canReselectTarget: false,
          confirmButtonText: 'Inline',
          promiseResolve,
          title: 'Inline attachment note'
        })
      );
    });
    return result.isConfirmed;
  }

  private async inline(plan: InlinePlan): Promise<void> {
    const { analysis, noteFile, parentFile } = plan;
    const notePath = noteFile.path;
    const abortController = new AbortController();
    const result: InlineResult = { isDone: false, rewrittenLinkCount: 0 };
    const progressNotice = showOperationProgressNotice({
      abortController,
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          preposition: 'into',
          sourcePathOrAbstractFile: notePath,
          targetPathOrAbstractFile: parentFile,
          verb: 'Inlining attachment note'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          result.rewrittenLinkCount = await this.inlineInTransaction({ abortSignal: abortController.signal, plan, vaultTransaction });
          result.isDone = true;
        },
        lockTargets: [
          { mode: 'file', pathOrFile: noteFile },
          { mode: 'file', pathOrFile: parentFile }
        ],
        operationName: 'Inline attachment note into its parent',
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

    if (!result.isDone) {
      return;
    }

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        preposition: 'into',
        shouldLinkSource: false,
        sourcePathOrAbstractFile: notePath,
        suffix: result.rewrittenLinkCount > 0 ? ` and updated ${String(result.rewrittenLinkCount)} link(s)` : '',
        targetPathOrAbstractFile: parentFile,
        verb: `Inlined ${analysis.attachment.name} from`
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  private async inlineInTransaction(params: InlineAttachmentNoteCommandHandlerInlineInTransactionParams): Promise<number> {
    const { abortSignal, plan, vaultTransaction } = params;
    const {
      analysis,
      mainReference,
      noteFile,
      parentFile
    } = plan;
    const notePath = noteFile.path;
    const parentPath = parentFile.path;

    // Captured BEFORE anything moves or is rewritten, so the parent's own reference is still in it.
    const backlinks = await getBacklinksForFileSafe({ app: this.app, pathOrFile: noteFile });
    let linkToRewriteCount = 0;
    for (const sourcePath of backlinks.keys()) {
      for (const reference of backlinks.get(sourcePath) ?? []) {
        if (isLinkToRewrite({ mainReference, notePath, parentPath, reference, sourcePath })) {
          linkToRewriteCount++;
        }
      }
    }
    const snapshot = buildBacklinksSnapshot({ backlinks, payloadProvider: () => undefined });
    const blockId = linkToRewriteCount === 0 ? null : plan.existingBlockId ?? generateBlockId(plan.existingBlockIds);

    // The vault's own rename, so the note's reference follows the attachment to its new path.
    await relocateAttachments({
      app: this.app,
      relocations: [{ attachment: analysis.attachment, newNoteFile: parentFile, oldNoteFile: noteFile }],
      vaultTransaction
    });

    let rewrittenLinkCount = 0;
    if (blockId !== null) {
      await editBacklinksSnapshot({
        abortSignal,
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        referenceConverter: ({ reference, sourcePath }) => {
          if (!isLinkToRewrite({ mainReference, notePath, parentPath, reference, sourcePath })) {
            return null;
          }
          const parsed = parseLink(reference.original);
          const isEmbed = parsed?.isEmbed ?? false;
          const alias = parsed?.alias ?? (isEmbed ? undefined : reference.displayText ?? noteFile.basename);
          rewrittenLinkCount++;
          return generateMarkdownLink({
            ...(alias !== undefined && { alias }),
            app: this.app,
            isEmbed,
            originalLink: reference.original,
            sourcePathOrFile: sourcePath,
            subpath: `#^${blockId}`,
            targetPathOrFile: parentFile
          });
        },
        resourceLockComponent: this.resourceLockComponent,
        snapshot
      });
    }

    // Re-read after the rewrites, so the offsets are current; only the parent's own reference still points at the note.
    const parentCache = await getCacheSafe(this.app, parentFile);
    const reference = parentCache
      ? findReferencesToNote({ app: this.app, cache: parentCache, noteFile, sourceFile: parentFile })
        .find((candidate) => candidate.position.start.line === mainReference.position.start.line)
      : undefined;
    if (!parentCache || !reference) {
      throw new Error(`Could not find the link to ${notePath} in ${parentPath} after rewriting the other links.`);
    }

    const newLink = generateMarkdownLink({
      ...(analysis.linkText !== null && { alias: analysis.linkText }),
      app: this.app,
      isEmbed: analysis.isEmbed,
      sourcePathOrFile: parentFile,
      targetPathOrFile: analysis.attachment
    });
    const blockEndLine = findBlockEndLine(parentCache, reference.position.start.line);
    const shouldAppendBlockId = blockId !== null && blockId !== plan.existingBlockId;
    await vaultTransaction.process(parentFile, (content) => {
      const replaced = replaceReference({ content, newLink, reference });
      return shouldAppendBlockId ? appendBlockId({ blockId, content: replaced, line: blockEndLine }) : replaced;
    });

    await vaultTransaction.trash(noteFile);
    return rewrittenLinkCount;
  }

  private async selectParent(noteFile: TFile): Promise<null | TFile> {
    const candidates = findParentCandidates(this.app, noteFile);
    if (candidates.length === 0) {
      this.pluginNoticeComponent.showNotice(`No note links ${noteFile.path}, so it has no parent to be inlined into.`);
      return null;
    }
    // The parent is clear when one note links it at all, or one links it from a list item (an attachment list).
    const listCandidates = candidates.filter((candidate) => candidate.isFromList);
    const [clearCandidate] = candidates.length === 1 ? candidates : (listCandidates.length === 1 ? listCandidates : []);
    return clearCandidate?.file ?? await selectParentNote({ app: this.app, candidates: candidates.map((candidate) => candidate.file) });
  }
}

/**
 * Lists in the confirmation dialog what inlining the note would drop.
 *
 * @param params - The analysis, the note and the fragment to fill.
 */
export function buildDropsConfirmContent(params: BuildDropsConfirmContentParams): void {
  const { analysis, fragment, noteFile } = params;
  fragment.appendText('Inlining ');
  appendCodeBlock(fragment, noteFile.path);
  fragment.appendText(' trashes it, and with it:');
  const list = fragment.createEl('ul');
  if (analysis.droppedAliases.length > 0) {
    const item = list.createEl('li', { text: 'Aliases: ' });
    appendCodeBlock(item, analysis.droppedAliases.join(', '));
  }
  if (analysis.droppedProperties.length > 0) {
    const item = list.createEl('li', { text: 'Properties: ' });
    appendCodeBlock(item, analysis.droppedProperties.join(', '));
  }
  if (analysis.droppedText === '') {
    return;
  }
  const item = list.createEl('li', { text: 'Text: ' });
  appendCodeBlock(item, analysis.droppedText);
}
