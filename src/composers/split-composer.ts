import type {
  CachedMetadata,
  Editor,
  EditorSelection,
  Pos
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import { MarkdownView } from 'obsidian';

import type {
  ComposerBaseConstructorParamsBase,
  Selection
} from './composer-base.ts';

import {
  Action,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { openProgressModal } from '../progress-modal.ts';
import { ComposerBase } from './composer-base.ts';

interface SplitComposerConstructorParams extends ComposerBaseConstructorParamsBase {
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly editor: Editor;
  readonly heading?: string;
  readonly isMultipleSplit: boolean;
  readonly shouldIncludeFrontmatter?: boolean;
}

export class SplitComposer extends ComposerBase {
  private capturedSelections: Selection[] = [];
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private editor: Editor;
  private readonly isMultipleSplit: boolean;

  public constructor(params: SplitComposerConstructorParams) {
    super({
      ...params,
      shouldIncludeFrontmatter: params.shouldIncludeFrontmatter ?? params.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.editor = params.editor;
    this.isMultipleSplit = params.isMultipleSplit;
  }

  public async splitFile(): Promise<void> {
    if (!await this.checkTargetFileIgnored(Action.Split)) {
      return;
    }

    // Snapshot the source selections up front as plain offset data.
    // The operation uses this snapshot, not the live editor, so navigating the active leaf
    // (e.g. clicking a progress-notice link) cannot rebind the editor and corrupt the result.
    this.capturedSelections = getSelections(this.editor);
    const selectedText = this.editor.getSelection();

    const mtimes = this.captureFileMtimes();
    this.lockNotes();
    const progressModalHandle = this.isMultipleSplit
      ? null
      : await openProgressModal({
        app: this.app,
        sourceFile: this.sourceFile,
        targetFile: this.targetFile,
        verb: 'Splitting'
      });
    try {
      this.consoleDebugComponent.consoleDebug(`Splitting note ${this.sourceFile.path} into ${this.targetFile.path}`);

      if (!await this.checkFilesUnchanged(mtimes)) {
        return;
      }

      await this.insertIntoTargetFile(selectedText);

      // Re-open the source note and restore the captured selections just before the destructive edits.
      // They must target the source note even if the active leaf navigated during the operation.
      await this.reopenSourceFileAndRestoreSelections();

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

      // Reveal the cursor after the re-open. The re-open scrolls the editor to the top, leaving the
      // (correctly positioned) cursor off-screen — revealing its line brings the viewport back to it.
      this.revealCursor();

      if (!this.isMultipleSplit && this.pluginSettingsComponent.settings.shouldOpenTargetNoteAfterSplit) {
        const DELAY_BEFORE_OPEN_IN_MILLISECONDS = 200;
        await sleep(DELAY_BEFORE_OPEN_IN_MILLISECONDS);
        await this.app.workspace.getLeaf().openFile(this.targetFile, {
          active: true
        });
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        // The operation was cancelled by unlocking the note; nothing to report.
        return;
      }
      throw error;
    } finally {
      progressModalHandle?.close();
      this.capturedSelections = [];
      this.unlockNotes();
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise return type.
  protected override async getSelections(): Promise<Selection[]> {
    return this.capturedSelections;
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

  private async reopenSourceFileAndRestoreSelections(): Promise<void> {
    if (this.isMultipleSplit) {
      return;
    }

    await this.app.workspace.getLeaf().openFile(this.sourceFile, { active: true });
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    this.editor = view.editor;
    this.editor.setSelections(this.capturedSelections.map((selection) => ({
      anchor: this.editor.offsetToPos(selection.startOffset),
      head: this.editor.offsetToPos(selection.endOffset)
    })));
  }
  /* v8 ignore stop */

  /**
   * Scrolls the active source view to the current cursor line (preserving the cursor), so that after
   * the source note is reopened the user lands where the extraction happened instead of at the top.
   * A no-op for multiple-split (no reopen happens) or when there is no active markdown view.
   */
  private revealCursor(): void {
    if (this.isMultipleSplit) {
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }
    view.setEphemeralState({ line: this.editor.getCursor().line });
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
