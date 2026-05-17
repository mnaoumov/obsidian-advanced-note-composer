import type {
  CachedMetadata,
  Editor,
  EditorSelection,
  Pos
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type {
  ComposerBaseConstructorParams,
  Selection
} from './composer-base.ts';

import {
  Action,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { ComposerBase } from './composer-base.ts';

interface SplitComposerConstructorParams extends ComposerBaseConstructorParams {
  readonly editor: Editor;
  readonly heading?: string;
  readonly isMultipleSplit: boolean;
  readonly shouldIncludeFrontmatter?: boolean;
}

export class SplitComposer extends ComposerBase {
  private readonly editor: Editor;
  private readonly isMultipleSplit: boolean;

  public constructor(params: SplitComposerConstructorParams) {
    super(params, params.shouldIncludeFrontmatter ?? params.plugin.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault);
    this.editor = params.editor;
    this.isMultipleSplit = params.isMultipleSplit;
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

      await this.insertIntoTargetFile(this.editor.getSelection());

      const markdownLink = this.app.fileManager.generateMarkdownLink(this.targetFile, this.sourceFile.path);

      switch (this.plugin.pluginSettingsComponent.settings.textAfterExtractionMode) {
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
          throw new Error(`Invalid text after extraction mode: ${this.plugin.pluginSettingsComponent.settings.textAfterExtractionMode as string}`);
      }

      if (!this.isMultipleSplit && this.plugin.pluginSettingsComponent.settings.shouldOpenTargetNoteAfterSplit) {
        const DELAY_BEFORE_OPEN_IN_MILLISECONDS = 200;
        await sleep(DELAY_BEFORE_OPEN_IN_MILLISECONDS);
        await this.app.workspace.getLeaf().openFile(this.targetFile, {
          active: true
        });
      }
    } finally {
      notice.hide();
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise return type.
  protected override async getSelections(): Promise<Selection[]> {
    return getSelections(this.editor);
  }

  protected override getTemplate(): string {
    if (!this.plugin.pluginSettingsComponent.settings.splitTemplate) {
      return this.plugin.pluginSettingsComponent.settings.mergeTemplate;
    }

    if (this.isNewTargetFile) {
      return this.plugin.pluginSettingsComponent.settings.splitTemplate;
    }

    if (this.plugin.pluginSettingsComponent.settings.splitToExistingFileTemplate === Action.Merge) {
      return this.plugin.pluginSettingsComponent.settings.mergeTemplate;
    }

    return this.plugin.pluginSettingsComponent.settings.splitTemplate;
  }

  protected override prepareBacklinkSubpaths(): Set<string> {
    return new Set();
  }

  protected override updateEditorSelections(
    sourceCache: CachedMetadata | null,
    sourceFootnoteIdsToRemove: Set<string>,
    sourceFootnoteIdsToRestore: Set<string>
  ): void {
    super.updateEditorSelections(sourceCache, sourceFootnoteIdsToRemove, sourceFootnoteIdsToRestore);

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
}

export function getSelections(editor: Editor): Selection[] {
  const selections = editor.listSelections().map((editorSelection) => {
    const selection: Selection = {
      endOffset: editor.posToOffset(editorSelection.anchor),
      startOffset: editor.posToOffset(editorSelection.head)
    };

    if (selection.startOffset > selection.endOffset) {
      [selection.startOffset, selection.endOffset] = [selection.endOffset, selection.startOffset];
    }

    return selection;
  });

  return selections.sort((a, b) => a.startOffset - b.startOffset);
}
