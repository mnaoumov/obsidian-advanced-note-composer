import type {
  CachedMetadata,
  Editor,
  EditorSelection,
  Pos
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type {
  ComposerBaseConstructorOptions,
  Selection
} from './composer-base.ts';

import {
  Action,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { ComposerBase } from './composer-base.ts';

interface SplitComposerConstructorParams extends ComposerBaseConstructorOptions {
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly editor: Editor;
  readonly heading?: string;
  readonly isMultipleSplit: boolean;
  readonly shouldIncludeFrontmatter?: boolean;
}

export class SplitComposer extends ComposerBase {
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly editor: Editor;
  private readonly isMultipleSplit: boolean;

  public constructor(params: SplitComposerConstructorParams) {
    super(params, params.shouldIncludeFrontmatter ?? params.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault);

    this.consoleDebugComponent = params.consoleDebugComponent;
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
      this.consoleDebugComponent.consoleDebug(`Splitting note ${this.sourceFile.path} into ${this.targetFile.path}`);

      await this.insertIntoTargetFile(this.editor.getSelection());

      const markdownLink = this.app.fileManager.generateMarkdownLink(this.targetFile, this.sourceFile.path);

      switch (this.pluginSettingsComponent.settings.textAfterExtractionMode) {
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
          throw new Error(`Invalid text after extraction mode: ${this.pluginSettingsComponent.settings.textAfterExtractionMode as string}`);
      }

      if (!this.isMultipleSplit && this.pluginSettingsComponent.settings.shouldOpenTargetNoteAfterSplit) {
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
    if (!this.pluginSettingsComponent.settings.splitTemplate) {
      return this.pluginSettingsComponent.settings.mergeTemplate;
    }

    if (this.isNewTargetFile) {
      return this.pluginSettingsComponent.settings.splitTemplate;
    }

    if (this.pluginSettingsComponent.settings.splitToExistingFileTemplate === Action.Merge) {
      return this.pluginSettingsComponent.settings.mergeTemplate;
    }

    return this.pluginSettingsComponent.settings.splitTemplate;
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

    /* v8 ignore start -- defensive ?? on sourceCache?.footnotes. */
    for (const sourceFootnote of sourceCache?.footnotes ?? []) {
      /* v8 ignore stop */
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

  /* v8 ignore start -- removeSelectionRange branches are defensive for various selection/range overlap cases. */
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
  /* v8 ignore stop */
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
