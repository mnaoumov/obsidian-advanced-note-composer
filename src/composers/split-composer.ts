import type {
  Editor,
  EditorPosition,
  EditorSelection,
  Pos
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import { MarkdownView } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { FrontmatterSelectionExtraction } from '../frontmatter-selection.ts';
import type {
  ComposerBaseConstructorParamsBase,
  ComposerBaseUpdateEditorSelectionsParams,
  Selection
} from './composer-base.ts';

import { extractFrontmatterSelection } from '../frontmatter-selection.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { createMoveToken } from '../move-token.ts';
import { openFileAfterOperation } from '../open-after-operation.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import {
  Action,
  SmartCutAndPasteCompletionFeedback,
  SmartCutAndPasteMoveKind,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import {
  ComposerBase,
  resolveInsertOffset
} from './composer-base.ts';

/**
 * The template settings {@link resolveSmartCutAndPasteTemplate} reads.
 */
export interface SmartCutAndPasteTemplateSettings {
  readonly smartCutAndPasteTemplate: string;
  readonly smartCutAndPasteToBottomTemplate: string;
  readonly smartCutAndPasteToTopTemplate: string;
}

/**
 * The template settings {@link resolveSplitTemplateForNewTargetFile} reads.
 */
export interface SplitTemplateSettings {
  readonly mergeTemplate: string;
  readonly splitTemplate: string;
}

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
  readonly selectedText: string;
  readonly shouldIncludeFrontmatter?: boolean;

  // Whether a smart cut & paste move lands the cursor on the moved content in the target (issue #144).
  // Decided by the command handler, since only it knows which move this is: a move AT THE CURSOR always
  // Jumps, while the top/bottom moves each read their own setting. Ignored unless
  // `smartCutAndPasteMoveKind` is set.
  readonly shouldJumpToMovedContent?: boolean;

  // Which smart cut & paste move this split is (mark → move here / at cursor / to top / bottom). Its
  // PRESENCE marks the split as a smart cut & paste move at all, so `getTemplate` prefers the smart cut &
  // Paste templates (the per-direction override, then the shared one, then the split → merge chain when
  // Both are empty — issue #174). Ordinary split-to-new-file extracts leave it unset. Supplied by the
  // Command handler, since only it knows which move this is.
  readonly smartCutAndPasteMoveKind?: SmartCutAndPasteMoveKind;

  // The end of the target range the move flow replaces with the token. When greater than
  // `targetCursorOffset`, the moved content replaces that range (paste-over-selection at the cursor);
  // `null`/omitted (or equal to `targetCursorOffset`) means a plain insertion at `targetCursorOffset`.
  readonly targetCursorEndOffset?: null | number;

  // The offset in the target note where the move flow inserts the token. With an `insertToken` set,
  // `null`/omitted means derive the offset from `insertMode` (top = just after frontmatter, bottom =
  // End of note) — used by the top/bottom move commands and same-note extract; a number pins it to a
  // Specific offset (the paste cursor of `Move marked selection here`). Ignored without an `insertToken`.
  readonly targetCursorOffset?: null | number;

  // Overrides the template resolution entirely for this operation, whatever the settings say. Set by the
  // Recursive split, which passes the identity template so its structural passes write the extracted
  // Content untouched and the real template is applied to each produced note afterwards, once its own
  // Children are gone (issue #172 — see `applySplitTemplateToNotes`).
  readonly templateOverride?: string;

  // Overrides the `Text after extraction` setting for this operation (used by the move flow, where a
  // Same-note move resolves to `None` unless overridden). Falls back to the setting when omitted.
  readonly textAfterExtractionMode?: TextAfterExtractionMode;
}

interface SplitComposerIsRangeOverlappingCapturedSelectionParams {
  readonly endOffset: number;
  readonly startOffset: number;
}

/**
 * The editor positions the moved content occupies in the target note, with the template's own
 * leading/trailing whitespace already trimmed off.
 */
interface SplitComposerMovedContentRange {
  readonly endPos: EditorPosition;
  readonly startPos: EditorPosition;
}

export class SplitComposer extends ComposerBase {
  // Not `readonly`: the same-note move flow re-maps these offsets after inserting the token.
  private capturedSelections: Selection[];
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private editor: Editor;
  private readonly isMultipleSplit: boolean;
  private readonly selectedText: string;
  private readonly shouldJumpToMovedContent: boolean;
  private readonly smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind | undefined;
  private readonly targetCursorEndOffset: null | number;
  private readonly targetCursorOffset: null | number;
  private readonly templateOverride: string | undefined;
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
    this.smartCutAndPasteMoveKind = params.smartCutAndPasteMoveKind;
    this.capturedSelections = params.capturedSelections;
    this.selectedText = params.selectedText;
    this.shouldJumpToMovedContent = params.shouldJumpToMovedContent ?? true;
    this.targetCursorOffset = params.targetCursorOffset ?? null;
    this.targetCursorEndOffset = params.targetCursorEndOffset ?? null;
    this.templateOverride = params.templateOverride;
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
      : showOperationProgressNotice({
        abortController: this.abortController,
        content: () => this.buildProgressContent('Splitting'),
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent
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

          // A selection taken entirely from the source note's own frontmatter is merged into the TARGET's
          // Frontmatter instead of being pasted as raw YAML into its body (issue #183). Resolved before the
          // Token is placed, so the same-note case is refused before anything is written.
          const frontmatterExtraction = await this.resolveFrontmatterExtraction();
          if (frontmatterExtraction && this.sourceFile === this.targetFile) {
            // Moving properties from a note into that same note has nowhere to go: they are already there,
            // And the only insert points a same-note extract offers are in the body.
            this.pluginNoticeComponent.showNotice('Cannot extract a note\'s properties into that same note.');
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

          if (frontmatterExtraction) {
            // Frontmatter-only extract: hand the selected properties over as a frontmatter block so the
            // Target's own merge strategy applies to them, then rewrite the source's YAML region with what
            // Is left. `textAfterExtractionMode` is not consulted — a link or an embed is not valid YAML.
            await this.insertIntoTargetFile({
              contentToInsert: `---\n${frontmatterExtraction.extractedYaml}\n---\n`,
              isFrontmatterOnlyExtract: true,
              vaultTransaction
            });
            this.replaceSourceFrontmatter(frontmatterExtraction);
          } else if (this.isSameNoteMove()) {
            // Same-note move: the target write is on the note the editor shows, and it collapses the
            // Editor selection — so a later `replaceSelection` would be a no-op (leaving the source text
            // In place, turning the move into a copy). Remove the source FIRST; the write reads the
            // Post-removal buffer, so the removal survives. Footnote definitions need no cleanup here:
            // Refs and defs both remain in the same note, so they stay resolved.
            this.replaceSourceSelection();
            await this.insertIntoTargetFile({ contentToInsert: this.selectedText, vaultTransaction });
          } else {
            // Cross-note (and split/extract): insert first so `fixFootnotes` can extend the editor
            // Selection to also cover orphaned footnote definitions, which the single `replaceSelection`
            // Then removes from the source along with the extracted text. The target write is a different
            // File, so it does not disturb the source editor selection.
            await this.insertIntoTargetFile({ contentToInsert: this.selectedText, vaultTransaction });
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

      // A batch split records nothing: `prepareForSplitFile` resolves each produced note's location from
      // The settings with no picker involved, so there is no target the user CHOSE to remember, and
      // Recording every note of a recursive run would bury the list under one operation's output (issue
      // #206). The recursive split records the root folder the user picked, once, itself. A smart cut &
      // Paste move is a single operation with a real destination, so it does record.
      if (!this.isMultipleSplit) {
        this.recordTargetFileAsRecent();
      }

      // A batch split reports once for the whole run (the command handler does it), and a smart cut &
      // Paste move is reported by `applyMovedContentFeedback` through its own
      // `smartCutAndPasteCompletionFeedback` setting — reporting either here would say it twice.
      if (!this.isMultipleSplit && !this.smartCutAndPasteMoveKind) {
        showOperationCompletionNotice({
          // A same-note extract has one side, so naming both would read `Split note A into A`.
          content: this.isSameNoteMove()
            ? await buildOperationNoticeContent({
              app: this.app,
              sourcePathOrAbstractFile: this.sourceFile.path,
              verb: 'Moved the extracted content within note'
            })
            : await this.buildCompletionContent('Split', true),
          pluginNoticeComponent: this.pluginNoticeComponent,
          pluginSettingsComponent: this.pluginSettingsComponent
        });
      }

      if (!this.isMultipleSplit && (this.insertToken !== null || this.pluginSettingsComponent.settings.shouldOpenTargetNoteAfterSplit)) {
        await openFileAfterOperation({ app: this.app, file: this.targetFile });

        // For a smart cut & paste move (mark → move here / at cursor / to top / bottom), land the cursor
        // On the moved content in the freshly opened target note, instead of leaving it wherever the
        // Opened note happened to place it (issue #144).
        // Whether to jump is decided by the command handler (a move at the cursor always does; the
        // Top/bottom moves each read their own setting), because moving a selection out of the way is a
        // Different intent from moving it to work on it. When off, the cursor stays where the selection
        // Was cut from — `revealCursor` above already brought it into view.
        if (this.smartCutAndPasteMoveKind && this.shouldJumpToMovedContent) {
          await this.revealMovedContentInTarget();
        }
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
    // An explicit override wins over every setting: the caller is taking templating over entirely (the
    // Recursive split defers it — see `applySplitTemplateToNotes`), so it is not padded either.
    if (this.templateOverride !== undefined) {
      return this.templateOverride;
    }

    // Padding is applied to whatever the chain resolves, NOT only to the smart cut & paste branch: the
    // Reported top-move merge happens with the SHIPPED DEFAULTS, where both smart templates are empty and
    // The chain falls all the way through to `mergeTemplate`. See `padEdgeMoveTemplate`.
    return padEdgeMoveTemplate(this.resolveConfiguredTemplate(), this.smartCutAndPasteMoveKind);
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

  /**
   * Reports the finished move on the located range, the way
   * the `smartCutAndPasteCompletionFeedback` setting asks for (issue #176). Every mode scrolls
   * the moved content into view — the cursor follows the move regardless; what differs is whether the
   * moved text is left selected, and whether a notice says the move is done.
   *
   * @param editor - The target note's editor.
   * @param range - Where the moved content sits in that editor.
   */
  private async applyMovedContentFeedback(editor: Editor, range: SplitComposerMovedContentRange): Promise<void> {
    const feedback = this.pluginSettingsComponent.settings.smartCutAndPasteCompletionFeedback;
    const shouldSelect = feedback !== SmartCutAndPasteCompletionFeedback.Notice;

    if (shouldSelect) {
      // NOTE: do NOT follow this with `setEphemeralState({ line })` — that repositions the caret and
      // Collapses the selection.
      editor.setSelection(range.startPos, range.endPos);
    } else {
      // Collapsed caret: the cursor still travels to the moved text, but nothing is highlighted, so it
      // Cannot be mistaken for the still-pending marked selection.
      editor.setCursor(range.startPos);
    }
    editor.scrollIntoView({ from: range.startPos, to: range.endPos }, true);

    if (feedback === SmartCutAndPasteCompletionFeedback.SelectMovedContent) {
      return;
    }

    this.pluginNoticeComponent.showNotice(
      await createFragmentAsync(async (f) => {
        f.appendText('Moved the marked selection into ');
        f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.targetFile.path }));
        f.appendText('.');
      })
    );
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
        const isBeforeRange = selectionStart < rangeStart;
        const isAfterRange = selectionEnd > rangeEnd;

        if (isBeforeRange) {
          result.push({
            anchor: this.editor.offsetToPos(selectionStart),
            head: this.editor.offsetToPos(rangeStart)
          });
        }

        if (isAfterRange) {
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
   * Rewrites the source note's frontmatter YAML with what the extraction left behind, through the same
   * editor-write path {@link replaceSourceSelection} uses (so the reopened editor's buffer, and therefore
   * the transaction's rollback, behave exactly as they do for an ordinary extract).
   *
   * The whole YAML region is replaced rather than the selection itself: deleting only the selected values
   * would leave a dangling `aliases:` behind, and the remainder already accounts for that.
   *
   * @param frontmatterExtraction - The resolved frontmatter extraction.
   */
  private replaceSourceFrontmatter(frontmatterExtraction: FrontmatterSelectionExtraction): void {
    this.editor.setSelection(
      this.editor.offsetToPos(frontmatterExtraction.frontmatterStartOffset),
      this.editor.offsetToPos(frontmatterExtraction.frontmatterEndOffset)
    );
    this.editor.replaceSelection(frontmatterExtraction.remainingYaml);
  }

  /**
   * Replaces the extracted source selection (in the reopened source editor) with the residual dictated
   * by {@link textAfterExtractionMode}: an embed, a link to the target note, or nothing.
   */
  private replaceSourceSelection(): void {
    const markdownLink = this.app.fileManager.generateMarkdownLink(this.targetFile, this.sourceFile.path);

    switch (this.textAfterExtractionMode) {
      case TextAfterExtractionMode.EmbedNewFile: {
        this.editor.replaceSelection(`!${markdownLink}`);
        break;
      }
      case TextAfterExtractionMode.LinkToNewFile: {
        this.editor.replaceSelection(markdownLink);
        break;
      }
      case TextAfterExtractionMode.None: {
        this.editor.replaceSelection('');
        break;
      }
      default: {
        throw new Error(`Invalid text after extraction mode: ${this.textAfterExtractionMode as string}`);
      }
    }
  }

  /**
   * Resolves the {@link SplitComposerMovedContentRange} the moved content occupies in `editor`, or
   * `null` when it cannot be located there (yet).
   *
   * @param editor - The target note's editor.
   * @param movedContent - The exact string that replaced the insert token.
   * @returns The range, or `null`.
   */
  /**
   * Resolves the configured template, before any padding — the documented fallback chain, unchanged.
   *
   * Split out of {@link SplitComposer.getTemplate} only so the chain stays one readable cascade of early
   * returns while the edge-move padding wraps its result in one place.
   *
   * @returns The template the settings resolve to.
   */
  private resolveConfiguredTemplate(): string {
    // A smart cut & paste move prefers its own template — the override for its direction, then the shared
    // One. When both are empty, fall through to the ordinary split → merge resolution below (the documented
    // Fallback chain).
    if (this.smartCutAndPasteMoveKind) {
      const smartCutAndPasteTemplate = resolveSmartCutAndPasteTemplate(this.pluginSettingsComponent.settings, this.smartCutAndPasteMoveKind);
      if (smartCutAndPasteTemplate) {
        return smartCutAndPasteTemplate;
      }
    }

    if (this.isNewTargetFile) {
      return resolveSplitTemplateForNewTargetFile(this.pluginSettingsComponent.settings);
    }

    if (!this.pluginSettingsComponent.settings.splitTemplate) {
      return this.pluginSettingsComponent.settings.mergeTemplate;
    }

    if (this.pluginSettingsComponent.settings.splitToExistingFileTemplate === Action.Merge) {
      return this.pluginSettingsComponent.settings.mergeTemplate;
    }

    return this.pluginSettingsComponent.settings.splitTemplate;
  }

  /**
   * Resolves the frontmatter-only extract this operation is, or `null` when it is an ordinary one.
   *
   * A smart cut & paste move never qualifies: it inserts at a token the user placed in the target note's
   * BODY, and honoring the paste cursor and merging into the frontmatter are mutually exclusive — so those
   * moves keep extracting the raw text.
   *
   * @returns The extraction, or `null`.
   */
  private async resolveFrontmatterExtraction(): Promise<FrontmatterSelectionExtraction | null> {
    if (!this.pluginSettingsComponent.settings.shouldExtractFrontmatterSelectionAsProperties) {
      return null;
    }

    if (this.smartCutAndPasteMoveKind) {
      return null;
    }

    return extractFrontmatterSelection({
      content: await this.app.vault.read(this.sourceFile),
      selections: this.capturedSelections
    });
  }

  private resolveMovedContentRange(editor: Editor, movedContent: string): null | SplitComposerMovedContentRange {
    const editorValue = editor.getValue();
    const startOffset = this.resolveMovedTextStartOffset(editorValue, movedContent);
    if (startOffset === null) {
      return null;
    }

    // Clamp to the document, mirroring `computeHighlightRangesForFile`: the editor is read live, so it
    // Can be a revision behind the content the offsets were computed against.
    const endOffset = Math.min(startOffset + movedContent.trim().length, editorValue.length);
    return {
      endPos: editor.offsetToPos(endOffset),
      startPos: editor.offsetToPos(startOffset)
    };
  }

  /**
   * Resolves where the moved TEXT starts in `editorValue` — the template's own leading whitespace
   * already skipped, so the cursor lands on the text rather than on the blank lines wrapping it.
   *
   * @param editorValue - The target editor's current content.
   * @param movedContent - The exact string that replaced the insert token.
   * @returns The offset, or `null` when the moved content cannot be located.
   */
  private resolveMovedTextStartOffset(editorValue: string, movedContent: string): null | number {
    const leadingWhitespaceLength = movedContent.length - movedContent.trimStart().length;

    // The offset the unique insert token occupied pins the moved region exactly, so it is the only
    // Candidate that cannot pick the wrong copy (issue #175). Trusted only when the editor really does
    // Hold the moved content there — a later write (the frontmatter merge) can shift the body under it.
    if (this.movedContentOffset !== null && editorValue.startsWith(movedContent, this.movedContentOffset)) {
      return this.movedContentOffset + leadingWhitespaceLength;
    }

    // Fallbacks for a shifted body. Both take the FIRST occurrence, so on a note that already contains
    // The same text they can land on the earlier copy — a last resort, never the primary path.
    const index = editorValue.indexOf(movedContent);
    if (index !== -1) {
      return index + leadingWhitespaceLength;
    }

    const trimmedContent = movedContent.trim();
    if (trimmedContent === '') {
      // Whitespace-only move: `indexOf('')` would answer 0 and send the cursor to the top of the note.
      return null;
    }

    const trimmedIndex = editorValue.indexOf(trimmedContent);
    return trimmedIndex === -1 ? null : trimmedIndex;
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

  /**
   * Lands the cursor on the just-moved content in the (freshly re-opened) target note so the cursor
   * follows the move (issue #144), with any template-added leading/trailing whitespace trimmed off, and
   * reports the move the way {@link PluginSettings.smartCutAndPasteCompletionFeedback} asks for
   * (issue #176).
   *
   * The re-opened editor needs a moment to load its content and apply its own default cursor, so this
   * polls for the moved content rather than guessing a fixed delay. A no-op when the target view never
   * shows up or the content cannot be located — logged rather than passed over in silence, since that
   * is exactly the failure a user reports as "the cursor did not jump" (issue #175).
   */
  private async revealMovedContentInTarget(): Promise<void> {
    const POLL_INTERVAL_IN_MILLISECONDS = 50;
    const POLL_TIMEOUT_IN_MILLISECONDS = 2000;
    const movedContent = ensureNonNullable(this.movedContent);

    for (let elapsed = 0; elapsed <= POLL_TIMEOUT_IN_MILLISECONDS; elapsed += POLL_INTERVAL_IN_MILLISECONDS) {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      // The active view must be the TARGET note: the open above is asynchronous, and applying an offset
      // To whatever note happens to be showing would select arbitrary text in the wrong file. A view
      // Still loading (no file yet) simply fails the check and is retried on the next poll.
      if (view?.file?.path === this.targetFile.path) {
        const range = this.resolveMovedContentRange(view.editor, movedContent);
        if (range) {
          await this.applyMovedContentFeedback(view.editor, range);
          return;
        }
      }

      await sleep(POLL_INTERVAL_IN_MILLISECONDS);
    }

    this.consoleDebugComponent.consoleDebug(
      `Could not locate the moved content in ${this.targetFile.path} to jump to it: ${JSON.stringify(movedContent)} at offset ${String(this.movedContentOffset)}`
    );
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

/**
 * Pads an edge move's template so the moved block lands on lines of its own (issue #179).
 *
 * `resolveInsertOffset` returns a bare offset — `contentStart` for a top move, `content.length` for a
 * bottom one — with no awareness of what sits on the other side of it. A template is ONE string, so it can
 * only pad one side per direction, and whichever side it does not pad is the side the moved block glues
 * itself onto:
 *
 * - With the shipped defaults (`smartCutAndPasteTemplate: ''` → `mergeTemplate: '\n\n{{content}}'`, a
 *   LEADING separator only) the **top** move lands the block right after the frontmatter, abutting the
 *   note's existing first line. So this is not merely a misconfiguration.
 * - With the reporter's own template (`'{{content}}\n'`) it is the mirror image: the **bottom** move
 *   produces `last lineCONTENT`.
 *
 * A missing trailing line break is therefore not the whole story, and padding only that half would leave
 * the reporter's configuration broken in the direction they filed about. Both ends are ensured.
 *
 * **Scoped to the two EDGE moves on purpose.** An at-cursor paste is inserted at a token the user placed
 * mid-line, and forcing a line break onto either end of it would break exactly the case that move exists
 * for. The ordinary merge and split flows are left alone for the same reason — their output is not what
 * was reported, and silently reformatting it would be a far wider change than the defect.
 *
 * Idempotent: a template that already ends (or starts) with a line break is returned with that end
 * untouched, so the shipped default keeps producing exactly the blank line it produces today.
 *
 * @param template - The resolved template.
 * @param kind - Which move this is, or `undefined` when the flow is not a smart cut & paste move.
 * @returns The template, padded when this is an edge move.
 */
export function padEdgeMoveTemplate(template: string, kind: SmartCutAndPasteMoveKind | undefined): string {
  if (kind !== SmartCutAndPasteMoveKind.ToBottom && kind !== SmartCutAndPasteMoveKind.ToTop) {
    return template;
  }

  let padded = template;
  if (!padded.startsWith('\n')) {
    padded = `\n${padded}`;
  }
  if (!padded.endsWith('\n')) {
    padded += '\n';
  }

  return padded;
}

/**
 * Resolves the template a smart cut & paste move applies: the override configured for its direction,
 * falling back to the shared `Smart cut & paste template` setting (issue #174). An empty result means
 * nothing is configured for this move, and {@link SplitComposer.getTemplate} falls through to the ordinary
 * split → merge chain. Exported so the resolution can be asserted directly.
 *
 * @param settings - The three template settings the chain reads (structural, so the deep-readonly settings
 * object a `PluginSettingsComponent` exposes is accepted as-is).
 * @param kind - Which move this is.
 * @returns The template to apply, or an empty string when none is configured.
 */
export function resolveSmartCutAndPasteTemplate(settings: SmartCutAndPasteTemplateSettings, kind: SmartCutAndPasteMoveKind): string {
  // A `Record` keyed by the enum rather than a `switch`, so a new member becomes a compile error instead of
  // An unreachable `default` branch the 100 % coverage gate could never reach. `AtCursor` has no override BY
  // CONSTRUCTION — the shared template IS its template — so it maps to the empty string and `||` falls
  // Straight through, keeping this a single expression with no special-case branch.
  const overrides: Record<SmartCutAndPasteMoveKind, string> = {
    [SmartCutAndPasteMoveKind.AtCursor]: '',
    [SmartCutAndPasteMoveKind.ToBottom]: settings.smartCutAndPasteToBottomTemplate,
    [SmartCutAndPasteMoveKind.ToTop]: settings.smartCutAndPasteToTopTemplate
  };

  return overrides[kind] || settings.smartCutAndPasteTemplate;
}

/**
 * Resolves the template a split into a BRAND-NEW target file uses: the `Split template` setting, falling
 * back to `Merge template` when it is empty. This is the `isNewTargetFile` branch of
 * {@link SplitComposer.getTemplate}, which calls it — exported so the recursive split's deferred
 * templating (`applySplitTemplateToNotes`) applies exactly what the composer would have applied inline,
 * instead of a second copy of the fallback chain that could drift from it.
 *
 * @param settings - The two template settings the chain reads (structural, so the deep-readonly settings
 * object a `PluginSettingsComponent` exposes is accepted as-is).
 * @returns The template to apply.
 */
export function resolveSplitTemplateForNewTargetFile(settings: SplitTemplateSettings): string {
  if (!settings.splitTemplate) {
    return settings.mergeTemplate;
  }

  return settings.splitTemplate;
}
