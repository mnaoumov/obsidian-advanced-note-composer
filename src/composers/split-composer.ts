import type {
  CachedMetadata,
  Editor,
  EditorSelection,
  Pos
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import { MarkdownView } from 'obsidian';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type {
  ComposerBaseConstructorParamsBase,
  Selection
} from './composer-base.ts';

import { runLockedTransaction } from '../locked-transaction.ts';
import {
  Action,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { ComposerBase } from './composer-base.ts';

interface SplitComposerConstructorParams extends ComposerBaseConstructorParamsBase {
  // The source selection offsets and selected text, captured BEFORE the (minimizable) modal opened,
  // While `editor` still showed the source note. They must NOT be re-read from `editor` inside the
  // Operation: the editor is the leaf's instance, and if the user navigated that leaf to another
  // Note during the modal, the same `editor` object now reflects THAT note — re-reading it would
  // Extract the wrong note's content.
  readonly capturedSelections: Selection[];
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly editor: Editor;
  readonly heading?: string;
  readonly isMultipleSplit: boolean;
  readonly selectedText: string;
  readonly shouldIncludeFrontmatter?: boolean;

  // The offset in the target note where the move (mark → move here) flow inserts the token. Required
  // When `insertToken` is set (move mode); ignored otherwise.
  readonly targetCursorOffset?: number;
}

export class SplitComposer extends ComposerBase {
  // Not `readonly`: the same-note move flow re-maps these offsets after inserting the token.
  private capturedSelections: Selection[];
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private editor: Editor;
  private readonly isMultipleSplit: boolean;
  private readonly selectedText: string;
  private readonly targetCursorOffset: null | number;

  public constructor(params: SplitComposerConstructorParams) {
    super({
      ...params,
      shouldIncludeFrontmatter: params.shouldIncludeFrontmatter ?? params.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.editor = params.editor;
    this.isMultipleSplit = params.isMultipleSplit;
    this.capturedSelections = params.capturedSelections;
    this.selectedText = params.selectedText;
    this.targetCursorOffset = params.targetCursorOffset ?? null;
  }

  public async splitFile(): Promise<void> {
    if (!await this.checkTargetFileIgnored(Action.Split)) {
      return;
    }

    const mtimes = this.captureFileMtimes();
    const progressNotice = this.isMultipleSplit
      ? null
      : this.pluginNoticeComponent.showNoticeAfterDelay({
        abortController: this.abortController,
        content: () => this.buildProgressContent('Splitting')
      });
    try {
      await runLockedTransaction({
        abortController: this.abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          this.consoleDebugComponent.consoleDebug(`Splitting note ${this.sourceFile.path} into ${this.targetFile.path}`);

          if (!await this.checkFilesUnchanged(mtimes)) {
            // The pre-flight guard tripped (an external change): abort so nothing is committed and the
            // Post-split open below is skipped. Nothing has been mutated yet, so there is nothing to undo.
            this.abortController.abort();
            return;
          }

          // Move (mark → move here) flow: place the token at the paste cursor in the target note FIRST,
          // Inside the transaction (so rollback captures the pre-token content). The processed content
          // Later replaces the token by string match, so the insert point survives the source-selection
          // Removal even when the target IS the source note.
          if (this.insertToken !== null) {
            await this.insertTokenIntoTargetFile(vaultTransaction);
          }

          // Snapshot the source note as a rollback restore point BEFORE any edit. The destructive
          // Editor.replaceSelection below is an editor edit, not a vault op the transaction can capture,
          // So an identity process() records a restore-to-original inverse without changing the content.
          // Done before the re-open so the (no-op) write cannot disturb the restored selections.
          await vaultTransaction.process(this.sourceFile, (content) => content);

          // Re-open the source note and restore the captured selections FIRST, before any edit, so every
          // Editor operation (footnote fix-up, the destructive replace) targets the source note even if
          // The active leaf navigated to another note during the (minimizable) modal.
          await this.reopenSourceFileAndRestoreSelections();

          if (this.isSameNoteMove()) {
            // Same-note move: the target write is on the note the editor shows, and it collapses the
            // Editor selection — so a later `replaceSelection` would be a no-op (leaving the source text
            // In place, turning the move into a copy). Remove the source FIRST; the write reads the
            // Post-removal buffer, so the removal survives. Footnote definitions need no cleanup here:
            // Refs and defs both remain in the same note, so they stay resolved.
            this.replaceSourceSelection();
            await this.insertIntoTargetFile(this.selectedText, vaultTransaction);
          } else {
            // Cross-note (and split/extract): insert first so `fixFootnotes` can extend the editor
            // Selection to also cover orphaned footnote definitions, which the single `replaceSelection`
            // Then removes from the source along with the extracted text. The target write is a different
            // File, so it does not disturb the source editor selection.
            await this.insertIntoTargetFile(this.selectedText, vaultTransaction);
            this.replaceSourceSelection();
          }

          // Reveal the cursor after the re-open. The re-open scrolls the editor to the top, leaving the
          // (correctly positioned) cursor off-screen — revealing its line brings the viewport back to it.
          this.revealCursor();
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

      if (!this.isMultipleSplit && (this.insertToken !== null || this.pluginSettingsComponent.settings.shouldOpenTargetNoteAfterSplit)) {
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

  private async insertTokenIntoTargetFile(vaultTransaction: VaultTransaction): Promise<void> {
    const insertToken = ensureNonNullable(this.insertToken);
    const offset = ensureNonNullable(this.targetCursorOffset);
    await vaultTransaction.process(
      this.targetFile,
      (content) => `${content.slice(0, offset)}${insertToken}${content.slice(offset)}`
    );

    if (this.sourceFile !== this.targetFile) {
      return;
    }

    // Same-note move: the token shifted every offset at or after the cursor. Shift the captured
    // Selection offsets so the re-opened source selects the original text. The cursor is guaranteed
    // Outside the selection (the paste command is unavailable inside it), so each selection shifts
    // Wholly or not at all.
    this.capturedSelections = this.capturedSelections.map((selection) =>
      offset <= selection.startOffset
        ? { endOffset: selection.endOffset + insertToken.length, startOffset: selection.startOffset + insertToken.length }
        : selection
    );
  }

  private isSameNoteMove(): boolean {
    return this.insertToken !== null && this.sourceFile === this.targetFile;
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
   * Replaces the extracted source selection (in the reopened source editor) with the residual dictated
   * by {@link textAfterExtractionMode}: an embed, a link to the target note, or nothing.
   */
  private replaceSourceSelection(): void {
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
  }

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
