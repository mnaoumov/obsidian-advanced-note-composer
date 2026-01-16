import { Notice } from "obsidian";
import type { CachedMetadata, Editor, EditorSelection, Pos } from "obsidian";
import { ComposerBase, type ComposerBaseOptions } from "./ComposerBase.ts";
import { createFragmentAsync } from "obsidian-dev-utils/HTMLElement";
import { renderInternalLink } from "obsidian-dev-utils/obsidian/Markdown";
import { Action, TextAfterExtractionMode } from "../PluginSettings.ts";
import type { Selection } from "./ComposerBase.ts";

interface SplitComposerOptions extends ComposerBaseOptions {
  editor: Editor;
  heading?: string;
  shouldIncludeFrontmatter?: boolean;
}

export class SplitComposer extends ComposerBase {
  private readonly editor: Editor;

  public constructor(options: SplitComposerOptions) {
    super(options, options.shouldIncludeFrontmatter ?? options.plugin.settings.shouldIncludeFrontmatterWhenSplittingByDefault);
    this.editor = options.editor;
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

      await this.insertIntoTargetFile(this.editor.getSelection() ?? '');

      const markdownLink = this.app.fileManager.generateMarkdownLink(this.targetFile, this.sourceFile.path);

      switch (this.plugin.settings.textAfterExtractionMode) {
        case TextAfterExtractionMode.EmbedNewFile:
          this.editor.replaceSelection(`!${markdownLink}`);
          break;
        case TextAfterExtractionMode.LinkToNewFile:
          this.editor.replaceSelection(markdownLink);
          break;
        case TextAfterExtractionMode.None:
          this.editor.replaceSelection('');
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

  protected override updateEditorSelections(sourceCache: CachedMetadata | null, sourceFootnoteIdsToRemove: Set<string>, sourceFootnoteIdsToRestore: Set<string>): void {
    let editorSelections = this.editor.listSelections();

    for (const sourceFootnote of sourceCache?.footnotes ?? []) {
      if (sourceFootnoteIdsToRemove.has(sourceFootnote.id)) {
        editorSelections.push({
          anchor: this.editor.offsetToPos(sourceFootnote.position.end.offset),
          head: this.editor.offsetToPos(sourceFootnote.position.start.offset)
        });
      } else if (sourceFootnoteIdsToRestore.has(sourceFootnote.id)) {
        editorSelections = this.removeSelectionRange(editorSelections, sourceFootnote.position);
      }
    }

    this.editor.setSelections(editorSelections);
  }

  private removeSelectionRange(editorSelections: EditorSelection[], rangeToRemove: Pos): EditorSelection[] {
    const rangeStart = rangeToRemove.start.offset;
    const rangeEnd = rangeToRemove.end.offset;
    const result: EditorSelection[] = [];

    for (const selection of editorSelections) {
      let selectionStart = this.editor.posToOffset(selection.anchor);
      let selectionEnd = this.editor.posToOffset(selection.head);

      if (selectionStart > selectionEnd) {
        [selectionStart, selectionEnd] = [selectionEnd, selectionStart];
      }

      if (selectionEnd < rangeStart || selectionStart > rangeEnd) {
        result.push(selection);
      } else {
        const beforeRange = selectionStart < rangeStart;
        const afterRange = selectionEnd > rangeEnd;

        if (beforeRange) {
          result.push({
            anchor: this.editor.offsetToPos(selectionStart),
            head: this.editor.offsetToPos(rangeStart)
          });
        }

        if (afterRange) {
          result.push({
            anchor: this.editor.offsetToPos(rangeEnd),
            head: this.editor.offsetToPos(selectionEnd)
          });
        }
      }
    }

    return result;
  }

  protected override async getSelections(): Promise<Selection[]> {
    const selections = this.editor.listSelections().map((editorSelection) => {
      const selection: Selection = {
        endOffset: this.editor?.posToOffset(editorSelection.anchor) ?? 0,
        startOffset: this.editor?.posToOffset(editorSelection.head) ?? 0
      };

      if (selection.startOffset > selection.endOffset) {
        [selection.startOffset, selection.endOffset] = [selection.endOffset, selection.startOffset];
      }

      return selection;
    });

    return selections.sort((a, b) => a.startOffset - b.startOffset);
  }
}
