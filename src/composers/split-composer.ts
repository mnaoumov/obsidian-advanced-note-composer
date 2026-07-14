import type {
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
  ComposerBaseUpdateEditorSelectionsParams,
  Selection
} from './composer-base.ts';

import { runLockedTransaction } from '../locked-transaction.ts';
import { createMoveToken } from '../move-token.ts';
import {
  Action,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import {
  ComposerBase,
  resolveInsertOffset
} from './composer-base.ts';

interface SplitComposerConstructorParams extends ComposerBaseConstructorParamsBase {
  // The source selection offsets and selected text, captured BEFORE any modal opened, while `editor`
  // Still showed the source note. They must NOT be re-read from `editor` inside the operation: the
  // Editor is the leaf's instance, and if the user navigated that leaf to another note during the
  // Setup flow (e.g. while the minimizable confirmation modal was minimized), the same `editor`
  // Object now reflects THAT note — re-reading it would extract the wrong note's content.
  readonly capturedSelections: Selection[];
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly editor: Editor;
  readonly heading?: string;
  readonly isMultipleSplit: boolean;

  // When `true`, this split is a smart cut & paste move (mark → move here / at cursor / to top /
  // Bottom), so `getTemplate` prefers the `Smart cut & paste template` setting (falling back to the
  // Split → merge chain when it is empty). Ordinary split-to-new-file extracts leave this `false`.
  readonly isSmartCutAndPasteMove?: boolean;
  readonly selectedText: string;
  readonly shouldIncludeFrontmatter?: boolean;

  // The end of the target range the move flow replaces with the token. When greater than
  // `targetCursorOffset`, the moved content replaces that range (paste-over-selection at the cursor);
  // `null`/omitted (or equal to `targetCursorOffset`) means a plain insertion at `targetCursorOffset`.
  readonly targetCursorEndOffset?: null | number;

  // The offset in the target note where the move flow inserts the token. With an `insertToken` set,
  // `null`/omitted means derive the offset from `insertMode` (top = just after frontmatter, bottom =
  // End of note) — used by the top/bottom move commands and same-note extract; a number pins it to a
  // Specific offset (the paste cursor of `Move marked selection here`). Ignored without an `insertToken`.
  readonly targetCursorOffset?: null | number;

  // Overrides the `Text after extraction` setting for this operation (used by the move flow, where a
  // Same-note move resolves to `None` unless overridden). Falls back to the setting when omitted.
  readonly textAfterExtractionMode?: TextAfterExtractionMode;
}

interface SplitComposerIsRangeOverlappingCapturedSelectionParams {
  readonly endOffset: number;
  readonly startOffset: number;
}

export class SplitComposer extends ComposerBase {
  // Not `readonly`: the same-note move flow re-maps these offsets after inserting the token.
  private capturedSelections: Selection[];
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private editor: Editor;
  private readonly isMultipleSplit: boolean;
  private readonly isSmartCutAndPasteMove: boolean;
  private readonly selectedText: string;
  private readonly targetCursorEndOffset: null | number;
  private readonly targetCursorOffset: null | number;
  private readonly textAfterExtractionMode: TextAfterExtractionMode;

  public constructor(params: SplitComposerConstructorParams) {
    // A same-note split IS a move: the append/prepend path would write the note before removing the
    // Source selection, collapsing the editor selection so the removal becomes a no-op (turning the
    // Move into a copy). So synthesize a token (unless one was passed) to route it through the proven
    // Same-note-move ordering. Footnote-fixing and frontmatter-inclusion are meaningless within one
    // Note — footnote-fixing would even rename the moved ref and leave it dangling — so force them off.
    const isSameFile = params.sourceFile === params.targetFile;
    const settings = params.pluginSettingsComponent.settings;
    super({
      ...params,
      insertToken: params.insertToken ?? (isSameFile ? createMoveToken() : undefined),
      shouldFixFootnotes: isSameFile ? false : (params.shouldFixFootnotes ?? settings.shouldFixFootnotesByDefault),
      shouldIncludeFrontmatter: isSameFile ? false : (params.shouldIncludeFrontmatter ?? settings.shouldIncludeFrontmatterWhenSplittingByDefault)
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.editor = params.editor;
    this.isMultipleSplit = params.isMultipleSplit;
    this.isSmartCutAndPasteMove = params.isSmartCutAndPasteMove ?? false;
    this.capturedSelections = params.capturedSelections;
    this.selectedText = params.selectedText;
    this.targetCursorOffset = params.targetCursorOffset ?? null;
    this.targetCursorEndOffset = params.targetCursorEndOffset ?? null;
    // A same-note residual (self-link/embed) is meaningless, so default it to `None` unless the user
    // Opted in — mirroring the `Move marked selection here` handler.
    this.textAfterExtractionMode = params.textAfterExtractionMode
      ?? (isSameFile && !settings.shouldApplyTextAfterExtractionToSameFile
        ? TextAfterExtractionMode.None
        : settings.textAfterExtractionMode);
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

          // Move flow: place the token at the insert point in the target note FIRST, inside the
          // Transaction (so rollback captures the pre-token content). The processed content later
          // Replaces the token by string match, so the insert point survives the source-selection
          // Removal even when the target IS the source note.
          if (this.insertToken !== null) {
            const wasTokenInserted = await this.insertTokenIntoTargetFile(vaultTransaction);
            if (!wasTokenInserted) {
              // The insert point falls inside the text being moved (a same-note move of a selection that
              // Spans the frontmatter boundary, sent to the top). The token would be removed with the
              // Source, losing the content — so abort with a notice instead of corrupting the note.
              this.pluginNoticeComponent.showNotice('Cannot move a selection to the top of a note when the selection spans the note\'s frontmatter.');
              this.abortController.abort();
              return;
            }
          }

          // Snapshot the source note as a rollback restore point BEFORE any edit. The destructive
          // Editor.replaceSelection below is an editor edit, not a vault op the transaction can capture,
          // So an identity process() records a restore-to-original inverse without changing the content.
          // Done before the re-open so the (no-op) write cannot disturb the restored selections.
          await vaultTransaction.process(this.sourceFile, (content) => content);

          // Re-open the source note and restore the captured selections FIRST, before any edit, so every
          // Editor operation (footnote fix-up, the destructive replace) targets the source note even if
          // The active leaf navigated to another note during the setup flow (e.g. while the minimizable
          // Confirmation modal was minimized).
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
        operationName: 'Split note',
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
    // A smart cut & paste move prefers its own template; when it is empty, fall through to the ordinary
    // Split → merge resolution below (the documented fallback chain).
    if (this.isSmartCutAndPasteMove && this.pluginSettingsComponent.settings.smartCutAndPasteTemplate) {
      return this.pluginSettingsComponent.settings.smartCutAndPasteTemplate;
    }

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

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override updateEditorSelections(params: ComposerBaseUpdateEditorSelectionsParams): void {
    const { sourceCache, sourceFootnoteIdsToRemove, sourceFootnoteIdsToRestore } = params;
    super.updateEditorSelections(params);

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

  private async insertTokenIntoTargetFile(vaultTransaction: VaultTransaction): Promise<boolean> {
    const insertToken = ensureNonNullable(this.insertToken);
    // A pinned `targetCursorOffset` (the paste cursor) is used as-is; otherwise the offset is derived
    // From `insertMode` against the pre-token content (bottom = end of note, top = after frontmatter).
    const startOffset = this.targetCursorOffset
      ?? resolveInsertOffset(await this.app.vault.read(this.targetFile), this.insertMode);
    // The token replaces `[startOffset, endOffset]`; with no selection to replace the range is empty
    // (`endOffset === startOffset`), so it is a plain insertion at the caret.
    const endOffset = this.targetCursorEndOffset ?? startOffset;

    if (this.sourceFile === this.targetFile && this.isRangeOverlappingCapturedSelection({ endOffset, startOffset })) {
      // The insert range overlaps the text being moved, which will be removed — the token (and thus the
      // Moved content) would be lost. The caller aborts with a notice.
      return false;
    }

    await vaultTransaction.process(
      this.targetFile,
      (content) => `${content.slice(0, startOffset)}${insertToken}${content.slice(endOffset)}`
    );

    if (this.sourceFile !== this.targetFile) {
      return true;
    }

    // Same-note move: replacing `[startOffset, endOffset]` with the token shifted every offset at or
    // After the range by `delta`. Shift the captured selection offsets so the re-opened source selects
    // The original text. The range is guaranteed not to overlap the selection (checked above), so each
    // Selection shifts wholly or not at all.
    const delta = insertToken.length - (endOffset - startOffset);
    this.capturedSelections = this.capturedSelections.map((selection) =>
      endOffset <= selection.startOffset
        ? { endOffset: selection.endOffset + delta, startOffset: selection.startOffset + delta }
        : selection
    );
    return true;
  }

  private isRangeOverlappingCapturedSelection(params: SplitComposerIsRangeOverlappingCapturedSelectionParams): boolean {
    const { endOffset, startOffset } = params;
    return this.capturedSelections.some((selection) => startOffset < selection.endOffset && selection.startOffset < endOffset);
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

    switch (this.textAfterExtractionMode) {
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
        throw new Error(`Invalid text after extraction mode: ${this.textAfterExtractionMode as string}`);
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
