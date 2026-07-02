import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import {
  editLinks,
  extractLinkFile,
  updateLink
} from 'obsidian-dev-utils/obsidian/link';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  ComposerBaseConstructorParamsBase,
  Selection
} from './composer-base.ts';

import { runLockedTransaction } from '../locked-transaction.ts';
import { Action } from '../plugin-settings.ts';
import { ComposerBase } from './composer-base.ts';

interface MergeComposerConstructorParams extends ComposerBaseConstructorParamsBase {
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class MergeComposer extends ComposerBase {
  private readonly consoleDebugComponent: ConsoleDebugComponent;

  public constructor(params: MergeComposerConstructorParams) {
    super({
      ...params,
      shouldIncludeFrontmatter: true
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
  }

  public async mergeFile(): Promise<void> {
    if (!await this.checkTargetFileIgnored(Action.Merge)) {
      return;
    }

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
          const sourceContent = await this.app.vault.read(this.sourceFile);
          if (!await this.checkFilesUnchanged(mtimes)) {
            // The pre-flight guard tripped (an external change): abort so nothing is committed and the
            // Post-merge open below is skipped. Nothing has been mutated yet, so there is nothing to undo.
            this.abortController.abort();
            return;
          }
          await this.insertIntoTargetFile(sourceContent, vaultTransaction);
          await vaultTransaction.trash(this.sourceFile);
        },
        injectedVaultTransaction: this.injectedVaultTransaction,
        lockTargets: [
          { mode: 'file', pathOrFile: this.sourceFile },
          { mode: 'file', pathOrFile: this.targetFile }
        ],
        resourceLockComponent: this.resourceLockComponent
      });

      if (this.abortController.signal.aborted) {
        return;
      }

      if (this.pluginSettingsComponent.settings.shouldOpenNoteAfterMerge) {
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

  protected override async fixBacklinks(backlinksToFix: Map<string, string[]>, updatedFilePaths: Set<string>, updatedLinks: Set<string>): Promise<void> {
    await super.fixBacklinks(backlinksToFix, updatedFilePaths, updatedLinks);

    let linkIndex = 0;
    await editLinks({
      abortSignal: this.abortController.signal,
      app: this.app,
      /* v8 ignore start -- runs only when editLinks finds a link in the merged target resolving to the source; test-mocks has no link index, so this needs real Obsidian; see obsidian-test-mocks CLAUDE.md (MetadataCache has no link indexer).  */
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
      /* v8 ignore stop */
      pathOrFile: this.targetFile,
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
