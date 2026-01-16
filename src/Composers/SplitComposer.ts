import { Notice } from "obsidian";
import { ComposerBase, type ComposerBaseOptions } from "./ComposerBase.ts";
import { createFragmentAsync } from "obsidian-dev-utils/HTMLElement";
import { renderInternalLink } from "obsidian-dev-utils/obsidian/Markdown";
import { Action, TextAfterExtractionMode } from "../PluginSettings.ts";

export class SplitComposer extends ComposerBase {
  public constructor(options: ComposerBaseOptions) {
    super(options);
  }

  public async splitFile(): Promise<void> {
    if (!await this.checkTargetFileIgnored(Action.Split)) {
      return;
    }

    const notice = new Notice(
      await createFragmentAsync(async (f) => {
        f.appendText('Advanced Note Composer: Splitting note ');
        f.appendChild(await renderInternalLink(this.app, this.sourceFile.path));
        f.appendText(' into ');
        f.appendChild(await renderInternalLink(this.app, this.targetFile.path));
        f.createEl('br');
        f.createEl('br');
        f.createDiv('is-loading');
      }),
      0
    );
    try {
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
    } finally {
      notice.hide();
    }
  }

  protected override getTemplate(): string {
    if (!this.plugin.settings.splitTemplate) {
      return this.plugin.settings.mergeTemplate;
    }

    if (this.isNewTargetFile) {
      return this.plugin.settings.splitTemplate;
    }

    if (this.plugin.settings.splitToExistingFileTemplate === Action.Merge) {
      return this.plugin.settings.mergeTemplate;
    }

    return this.plugin.settings.splitTemplate;
  }

  protected override prepareBacklinkSubpaths(): Set<string> {
    return new Set();
  }
}
