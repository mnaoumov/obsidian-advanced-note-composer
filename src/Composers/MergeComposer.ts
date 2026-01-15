import { editLinks, extractLinkFile, updateLink } from "obsidian-dev-utils/obsidian/Link";
import type { Item } from "../Modals/SuggestModalBase.ts";
import { ComposerBase, type ComposerBaseOptions } from "./ComposerBase.ts";
import type { MaybeReturn } from "obsidian-dev-utils/Type";
import { join } from "obsidian-dev-utils/Path";
import { Action } from "../PluginSettings.ts";
import { Notice } from "obsidian";
import { createFragmentAsync } from "obsidian-dev-utils/HTMLElement";
import { renderInternalLink } from "obsidian-dev-utils/obsidian/Markdown";

export class MergeComposer extends ComposerBase {
  public constructor(options: ComposerBaseOptions) {
    super(options);
  }

  public override async selectItem(item: Item | null, isMod: boolean, inputValue: string): Promise<void> {
    if (isMod || item?.type === 'unresolved') {
      const fileName = item?.type === 'unresolved' ? item.linktext ?? '' : inputValue;
      const parentFolder = this.app.fileManager.getNewFileParent(this.sourceFile.path, fileName);

      const existingFile = this.app.metadataCache.getFirstLinkpathDest(join(parentFolder.path, fileName), '');
      if (existingFile && this.isPathIgnored(existingFile.path)) {
        this._targetFile = existingFile;
        return;
      }

      this.isNewTargetFile = true;
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

  protected override async fixBacklinks(backlinksToFix: Map<string, string[]>, updatedFilePaths: Set<string>, updatedLinks: Set<string>): Promise<void> {
    await super.fixBacklinks(backlinksToFix, updatedFilePaths, updatedLinks);

    let linkIndex = 0;
    await editLinks(this.app, this.targetFile, (link): MaybeReturn<string> => {
      linkIndex++;
      const linkFile = extractLinkFile(this.app, link, this.targetFile);
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
    });
  }

  protected override getTemplate(): string {
    return this.plugin.settings.mergeTemplate;
  }

  protected override prepareBacklinkSubpaths(): Set<string> {
    return new Set(['']);
  }

  public async mergeFile(doNotAskAgain: boolean): Promise<void> {
    if (!await this.checkTargetFileIgnored(Action.Merge)) {
      return;
    }

    const notice: Notice | null = this.shouldShowNotice
      ? new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('Advanced Note Composer: Merging note ');
          f.appendChild(await renderInternalLink(this.app, this.sourceFile.path));
          f.appendText(' with ');
          f.appendChild(await renderInternalLink(this.app, this.targetFile.path));
          f.createEl('br');
          f.createEl('br');
          f.createDiv('is-loading');
        }),
        0
      )
      : null;

    try {
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
        const DELAY_BEFORE_OPEN_IN_MILLISECONDS = 200;
        await sleep(DELAY_BEFORE_OPEN_IN_MILLISECONDS);
        await this.app.workspace.getLeaf().openFile(this.targetFile, {
          active: true
        });
      }
    } finally {
      notice?.hide();
    }
  }
}
