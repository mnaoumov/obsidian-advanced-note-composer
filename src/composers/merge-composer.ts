import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import {
  editLinks,
  extractLinkFile,
  updateLink
} from 'obsidian-dev-utils/obsidian/link';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  ComposerBaseConstructorParamsBase,
  Selection
} from './composer-base.ts';

import { Action } from '../plugin-settings.ts';
import { openProgressModal } from '../progress-modal.ts';
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
    this.lockNotes();
    const progressModalHandle = this.shouldShowNotice
      ? await openProgressModal({
        app: this.app,
        sourceFile: this.sourceFile,
        targetFile: this.targetFile,
        verb: 'Merging'
      })
      : null;

    try {
      this.consoleDebugComponent.consoleDebug(`Merging note ${this.sourceFile.path} into ${this.targetFile.path}`);
      const sourceContent = await this.app.vault.read(this.sourceFile);
      if (!await this.checkFilesUnchanged(mtimes)) {
        return;
      }
      await this.insertIntoTargetFile(sourceContent);
      await trashSafe(this.app, this.sourceFile);

      if (this.pluginSettingsComponent.settings.shouldOpenNoteAfterMerge) {
        const DELAY_BEFORE_OPEN_IN_MILLISECONDS = 200;
        await sleep(DELAY_BEFORE_OPEN_IN_MILLISECONDS);
        await this.app.workspace.getLeaf().openFile(this.targetFile, {
          active: true
        });
      }
    } finally {
      progressModalHandle?.close();
      this.unlockNotes();
    }
  }

  protected override async fixBacklinks(backlinksToFix: Map<string, string[]>, updatedFilePaths: Set<string>, updatedLinks: Set<string>): Promise<void> {
    await super.fixBacklinks(backlinksToFix, updatedFilePaths, updatedLinks);

    let linkIndex = 0;
    await editLinks({
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
      pathOrFile: this.targetFile
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
