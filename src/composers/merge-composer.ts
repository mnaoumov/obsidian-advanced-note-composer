import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import {
  editLinks,
  extractLinkFile,
  updateLink
} from 'obsidian-dev-utils/obsidian/link';

import type { LockTarget } from '../locked-transaction.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  ComposerBaseConstructorParamsBase,
  ComposerBaseFixBacklinksParams,
  Selection
} from './composer-base.ts';

import {
  collectAttachmentsOwnedByNote,
  relocateAttachments
} from '../attachments.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { Action } from '../plugin-settings.ts';
import { ComposerBase } from './composer-base.ts';

interface MergeComposerConstructorParams extends ComposerBaseConstructorParamsBase {
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;

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
  private readonly shouldMoveAttachments: boolean;
  private readonly shouldOpenAfterMerge: boolean;

  public constructor(params: MergeComposerConstructorParams) {
    super({
      ...params,
      shouldIncludeFrontmatter: true
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.shouldOpenAfterMerge = params.shouldOpenAfterMerge ?? params.pluginSettingsComponent.settings.shouldOpenNoteAfterMerge;
    this.shouldMoveAttachments = params.shouldMoveAttachments ?? params.pluginSettingsComponent.settings.shouldMoveAttachmentsWhenMergingFile;
  }

  public async mergeFile(): Promise<void> {
    if (!await this.checkTargetFileIgnored(Action.Merge)) {
      return;
    }

    // Collected before the transaction so every attachment can be locked alongside the two notes: an
    // External change to one of them must abort the merge just as a change to a note does.
    const attachmentsToRelocate = this.shouldMoveAttachments
      ? collectAttachmentsOwnedByNote({
        app: this.app,
        markdownAttachmentSubExtensions: this.pluginSettingsComponent.settings.markdownAttachmentSubExtensions,
        noteFile: this.sourceFile
      })
      : [];

    const mtimes = this.captureFileMtimes();
    const progressNotice = this.shouldShowNotice
      ? this.pluginNoticeComponent.showNoticeAfterDelay({
        abortController: this.abortController,
        content: () => this.buildProgressContent('Merging')
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
            // Post-merge open below is skipped. Nothing has been mutated yet, so there is nothing to undo.
            this.abortController.abort();
            return;
          }
          if (attachmentsToRelocate.length > 0) {
            // Moved while the source note still exists, so the vault's own rename updates the links to
            // Them inside it — hence the re-read below, which picks up the new locations before the
            // Content is merged. It has to happen after the mtime guard above, which the plugin's own
            // Write to the source would otherwise trip.
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
          await this.insertIntoTargetFile(sourceContent, vaultTransaction);
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

      if (this.shouldOpenAfterMerge) {
        const DELAY_BEFORE_OPEN_IN_MILLISECONDS = 200;
        await sleep(DELAY_BEFORE_OPEN_IN_MILLISECONDS);
        await this.app.workspace.getLeaf().openFile(this.targetFile, {
          active: true
        });
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return;
      }
      throw error;
    } finally {
      progressNotice?.[Symbol.dispose]();
    }
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override async fixBacklinks(params: ComposerBaseFixBacklinksParams): Promise<void> {
    const { updatedFilePaths, updatedLinks } = params;
    await super.fixBacklinks(params);

    let linkIndex = 0;
    await editLinks({
      abortSignal: this.abortController.signal,
      app: this.app,
      linkConverter: (link): MaybeReturn<string> => {
        linkIndex++;
        const linkFile = extractLinkFile({ app: this.app, link, sourcePathOrFile: this.targetFile });
        if (linkFile !== this.sourceFile) {
          return;
        }

        updatedFilePaths.add(this.targetFile.path);
        updatedLinks.add(`${this.targetFile.path}//${String(linkIndex)}`);

        return updateLink({
          app: this.app,
          link,
          newSourcePathOrFile: this.targetFile,
          newTargetPathOrFile: this.targetFile,
          oldTargetPathOrFile: this.sourceFile,
          shouldUpdateFileNameAlias: true
        });
      },
      pathOrFile: this.targetFile,
      pluginNoticeComponent: this.pluginNoticeComponent,
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
}
