import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type { MaybeReturn } from '@mnaoumov/typescript-lib/type';

import {
  editReferences,
  extractReferenceFile,
  updateLink
} from '@mnaoumov/obsidian-lib/link';

import type {
  ComposerBaseConstructorParamsBase,
  ComposerBaseFixBacklinksParams,
  Selection
} from '../composers/composer-base.ts';
import type { LockTarget } from '../composers/locked-transaction.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import {
  collectAttachmentsOwnedByNote,
  relocateAttachments
} from '../attachments/attachments.ts';
import { ComposerBase } from '../composers/composer-base.ts';
import { runLockedTransaction } from '../composers/locked-transaction.ts';
import { openFileAfterOperation } from '../composers/open-after-operation.ts';
import { movePermanentLinksKeys } from '../integrations/permanent-links.ts';
import { Action } from '../settings/plugin-settings.ts';
import { createMoveToken } from '../smart-cut/move/move-token.ts';
import {
  disposeOperationProgressNotice,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../ui/operation-notices.ts';
import { findResidualSourceLink } from './residual-source-link.ts';

interface MergeComposerConstructorParams extends ComposerBaseConstructorParamsBase {
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * Whether the source note goes in place of the one link or embed to it the target holds (the residual an
   * extract leaves), instead of being appended or prepended. Applies only when {@link findResidualSourceLink}
   * finds such a reference; otherwise the merge appends or prepends as usual. Defaults to `false`, so only the
   * single-file merge, which asks the user, ever merges at a link.
   */
  readonly shouldMergeAtSourceLink?: boolean;

  /**
   * Whether the source note's own attachments follow it into the target note's attachment folder (issue
   * #161). Defaults to the `shouldMoveAttachmentsWhenMergingFile` setting. The batch merges pass
   * `false`: the folder-into-file merge relocates the whole folder's attachments itself, and the
   * folder-into-folder merge moves every non-note file structurally, so either would move them twice.
   */
  readonly shouldMoveAttachments?: boolean;

  /**
   * Whether to open the merged target note in the active leaf once the merge completes. Defaults to the
   * `shouldOpenNoteAfterMerge` setting for a single-file merge. A folder merge passes `false` so it does
   * NOT open each merged note in turn — opening dozens of target notes one after another is the "visual
   * cycling" of issue #106 (the active tab flickers through every merged file).
   */
  readonly shouldOpenAfterMerge?: boolean;
}

export class MergeComposer extends ComposerBase {
  protected override readonly shouldKeepSourceTitleForNewTargetFile: boolean = true;

  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly shouldMergeAtSourceLink: boolean;
  private readonly shouldMoveAttachments: boolean;
  private readonly shouldOpenAfterMerge: boolean;

  public constructor(params: MergeComposerConstructorParams) {
    super({
      ...params,
      shouldIncludeFrontmatter: true
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.shouldMergeAtSourceLink = params.shouldMergeAtSourceLink ?? false;
    this.shouldOpenAfterMerge = params.shouldOpenAfterMerge ?? params.pluginSettingsComponent.settings.shouldOpenNoteAfterMerge;
    this.shouldMoveAttachments = params.shouldMoveAttachments ?? params.pluginSettingsComponent.settings.shouldMoveAttachmentsWhenMergingFile;
  }

  public async mergeFile(): Promise<void> {
    if (!await this.checkTargetFileIgnored(Action.Merge)) {
      return;
    }

    // Collected before the transaction so every attachment can be locked alongside the two notes: an
    // external change to one of them must abort the merge just as a change to a note does.
    const attachmentsToRelocate = this.shouldMoveAttachments
      ? collectAttachmentsOwnedByNote({
        app: this.app,
        attachmentExtensions: this.pluginSettingsComponent.settings.attachmentExtensions,
        noteFile: this.sourceFile
      })
      : [];

    const mtimes = this.captureFileMtimes();
    const progressNotice = this.shouldShowNotice
      ? showOperationProgressNotice({
        abortController: this.abortController,
        app: this.app,
        content: () => this.buildProgressContent('Merging'),
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent
      })
      : null;

    try {
      await runLockedTransaction({
        abortController: this.abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          this.consoleDebugComponent.consoleDebug(`Merging note ${this.sourceFile.path} into ${this.targetFile.path}`);
          let sourceContent = await this.app.vault.read(this.sourceFile);
          if (!await this.checkFilesUnchanged(mtimes)) {
            // The pre-flight guard tripped (an external change): abort so nothing is committed and the
            // post-merge open below is skipped. Nothing has been mutated yet, so there is nothing to undo.
            this.abortController.abort();
            return;
          }
          const keyTransfer = movePermanentLinksKeys({
            app: this.app,
            fromFile: this.sourceFile,
            toFile: this.targetFile,
            vaultTransaction
          });
          const preservedFrontmatter = keyTransfer ? await keyTransfer : {};
          if (keyTransfer) {
            sourceContent = await this.app.vault.read(this.sourceFile);
          }
          if (attachmentsToRelocate.length > 0) {
            // Moved while the source note still exists, so the vault's own rename updates the links to
            // them inside it — hence the re-read below, which picks up the new locations before the
            // content is merged. It has to happen after the mtime guard above, which the plugin's own
            // write to the source would otherwise trip.
            await relocateAttachments({
              app: this.app,
              relocations: attachmentsToRelocate.map((attachment) => ({
                attachment: attachment.file,
                newNoteFile: this.targetFile,
                oldNoteFile: attachment.ownerNoteFile
              })),
              vaultTransaction
            });
            sourceContent = await this.app.vault.read(this.sourceFile);
          }
          if (this.shouldMergeAtSourceLink) {
            await this.replaceResidualSourceLinkWithToken(vaultTransaction);
          }
          await this.insertIntoTargetFile({ contentToInsert: sourceContent, preservedFrontmatter, vaultTransaction });
          await vaultTransaction.trash(this.sourceFile);
        },
        injectedVaultTransaction: this.injectedVaultTransaction,
        lockTargets: [
          { mode: 'file', pathOrFile: this.sourceFile },
          { mode: 'file', pathOrFile: this.targetFile },
          ...attachmentsToRelocate.map((attachment): LockTarget => ({ mode: 'file', pathOrFile: attachment.file }))
        ],
        operationName: 'Merge notes',
        resourceLockComponent: this.resourceLockComponent
      });

      if (this.abortController.signal.aborted) {
        return;
      }

      this.recordTargetFileAsRecent();

      if (this.shouldShowNotice) {
        // The source note is gone by now, so it is named as plain text — an unresolved link to it would
        // create it back when clicked.
        showOperationCompletionNotice({
          content: await this.buildCompletionContent('Merged', false),
          pluginNoticeComponent: this.pluginNoticeComponent,
          pluginSettingsComponent: this.pluginSettingsComponent
        });
      }

      if (this.shouldOpenAfterMerge) {
        await openFileAfterOperation({ app: this.app, file: this.targetFile });
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return;
      }
      throw error;
    } finally {
      disposeOperationProgressNotice(progressNotice);
    }
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Override must keep the base param type.
  protected override async fixBacklinks(params: ComposerBaseFixBacklinksParams): Promise<void> {
    const { updatedFilePaths, updatedLinks } = params;
    await super.fixBacklinks(params);

    let linkIndex = 0;
    await editReferences({
      abortSignal: this.abortController.signal,
      app: this.app,
      pathOrFile: this.targetFile,
      pluginNoticeComponent: this.pluginNoticeComponent,
      referenceConverter: (reference): MaybeReturn<string> => {
        linkIndex++;
        const linkFile = extractReferenceFile({ app: this.app, reference, sourcePathOrFile: this.targetFile });
        if (linkFile !== this.sourceFile) {
          return;
        }

        updatedFilePaths.add(this.targetFile.path);
        updatedLinks.add(`${this.targetFile.path}//${String(linkIndex)}`);

        return updateLink({
          app: this.app,
          newSourcePathOrFile: this.targetFile,
          newTargetPathOrFile: this.targetFile,
          oldTargetPathOrFile: this.sourceFile,
          reference,
          shouldUpdateFileNameAlias: true
        });
      },
      resourceLockComponent: this.resourceLockComponent
    });
  }

  protected override async getSelections(): Promise<Selection[]> {
    const content = await this.app.vault.read(this.sourceFile);

    return [{
      endOffset: content.length,
      startOffset: 0
    }];
  }

  protected override getTemplate(): string {
    return this.pluginSettingsComponent.settings.mergeTemplate;
  }

  protected override prepareBacklinkSubpaths(): Set<string> {
    return new Set(['']);
  }

  /**
   * Swaps the target's residual link to the source for an insert token, so the note is written where that link
   * was (merge at the link). Read inside the transaction, after the mtime guard, so the offsets describe the
   * content the write replaces; the swap itself goes through the transaction, so a rollback restores the link.
   *
   * @param vaultTransaction - The merge's transaction.
   */
  private async replaceResidualSourceLinkWithToken(vaultTransaction: VaultTransaction): Promise<void> {
    const targetContent = await this.app.vault.read(this.targetFile);
    const residualLink = await findResidualSourceLink({
      app: this.app,
      sourceFile: this.sourceFile,
      targetContent,
      targetFile: this.targetFile
    });
    if (!residualLink) {
      return;
    }

    const insertToken = createMoveToken();
    await vaultTransaction.modify(
      this.targetFile,
      `${targetContent.slice(0, residualLink.startOffset)}${insertToken}${targetContent.slice(residualLink.endOffset)}`
    );
    this.insertToken = insertToken;
    this.shouldTrimLineBreaksAtInsertToken = true;
  }
}
