import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { MarkdownView } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { SplitTemplateNote } from '../apply-split-template.ts';
import type { RecursiveSplitPreviewRow } from '../heading-split-recursion.ts';
import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import {
  applySplitTemplateToNotes,
  CONTENT_ONLY_TEMPLATE
} from '../apply-split-template.ts';
import { isEditorCommandBlocked } from '../command-block.ts';
import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import {
  resolveSplitTemplateForNewTargetFile,
  SplitComposer
} from '../composers/split-composer.ts';
import {
  buildRecursiveSplitPreviewRows,
  findNextHeadingToSplit,
  MAX_HEADING_LEVEL
} from '../heading-split-recursion.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { openModal } from '../open-minimizable-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';

interface BuildRecursiveSplitConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly previewRows: readonly RecursiveSplitPreviewRow[];
  readonly sourceFile: TFile;
}

/**
 * A note produced by one pass of the recursive split, plus the level of the heading it came from — which
 * is what bounds the next pass (see {@link findNextHeadingToSplit}).
 */
interface RecursiveSplitChild {
  readonly file: TFile;
  readonly level: number;
}

interface SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface SplitNoteByHeadingsRecursivelyEditorCommandHandlerSplitBranchParams {
  readonly editor: Editor;
  readonly file: TFile;

  /**
   * Whether this pass is splitting the note the command was invoked on, rather than a note the split itself
   * produced. Only the root pass may be redirected into Obsidian's default new-note folder (issue #173) —
   * every deeper pass must stay beside its source for the folder tree to nest.
   *
   * Passed explicitly rather than derived from `minLevel === 1`, which happens to be equivalent today but
   * makes the coupling invisible at the call site.
   */
  readonly isRootPass: boolean;

  /**
   * The shallowest heading level this pass may extract. `1` for the note the command was invoked on;
   * the parent heading's level plus one for every note the split itself produced.
   */
  readonly minLevel: number;
}

const PREVIEW_INDENT_WIDTH = 4;
const PREVIEW_INDENT = ' '.repeat(PREVIEW_INDENT_WIDTH);

export class SplitNoteByHeadingsRecursivelyEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-tree',
      id: 'split-note-by-headings-recursively',
      name: 'Split note by headings recursively...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    super.canExecuteEditor(editor, context);
    if (isEditorCommandBlocked(this.pluginSettingsComponent, context)) {
      return false;
    }
    const file = context.file;
    if (!file) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return false;
    }
    // Unlike the level-scoped commands, this one is not tied to the cursor: it restructures the whole
    // Note, so any heading anywhere in it is enough.
    return (cache.headings ?? []).length > 0;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot split file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const cache = await getCacheSafe(this.app, file);
    if (!cache) {
      return;
    }
    const headings = cache.headings ?? [];
    if (headings.length === 0) {
      return;
    }

    if (this.pluginSettingsComponent.settings.shouldAskBeforeSplitting) {
      const previewRows = buildRecursiveSplitPreviewRows(editor.getValue(), headings);
      const confirmResult = await this.confirmRecursiveSplit(file, previewRows);
      if (!confirmResult.isConfirmed) {
        return;
      }
      await this.pluginSettingsComponent.editAndSave((settings) => {
        settings.shouldAskBeforeSplitting = confirmResult.shouldAskAgain;
      });
    }

    /*
     * No `abortController`: the recursion has no cancellation path, so the notice offers no Cancel button
     * rather than one that would do nothing.
     */
    const progressNotice = showOperationProgressNotice({
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          sourcePathOrAbstractFile: file,
          verb: 'Splitting note recursively'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    let createdNotes: readonly SplitTemplateNote[];
    try {
      createdNotes = await this.splitBranch({ editor, file, isRootPass: true, minLevel: 1 });
    } finally {
      progressNotice?.[Symbol.dispose]();
      /*
       * The recursion walks the leaf down through every note it creates, so it ends up parked on the
       * deepest one. Bring the user back to the note they invoked the command on, whether the run
       * finished or failed part-way.
       */
      await this.app.workspace.getLeaf(false).openFile(file, { active: true });
    }

    /*
     * Only now, with the tree built and no produced note left open in the leaf, wrap each of them in the
     * split template — see `applySplitTemplateToNotes` for why it cannot happen as each note is created.
     */
    await applySplitTemplateToNotes({
      app: this.app,
      notes: createdNotes,
      resourceLockComponent: this.resourceLockComponent,
      template: resolveSplitTemplateForNewTargetFile(this.pluginSettingsComponent.settings)
    });

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        sourcePathOrAbstractFile: file,
        suffix: ` into ${String(createdNotes.length)} note(s)`,
        verb: 'Split note'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    /*
     * A user who made a selection is asking about that selection, so a whole-note command has no business
     * in that context menu (issue #188) — `Extract current selection...` is the one that belongs there.
     * Deliberately NOT in `canExecuteEditor`: unlike the level-scoped gate of issue #94, this only hides the
     * menu item, so the palette command and any hotkey keep working while a selection is active.
     */
    return !editor.somethingSelected();
  }

  /**
   * Asks once, up front, before restructuring the whole note. The individual splits that follow are
   * confirmation-free (`shouldSkipConfirmation`): a deep note produces many of them, and confirming each
   * would be unusable. Mirrors the other flows in mapping "Don't ask again" back onto
   * `shouldAskBeforeSplitting`.
   *
   * @param sourceFile - The note being split.
   * @param previewRows - The notes that will be created, in document order.
   * @returns The dialog result.
   */
  private async confirmRecursiveSplit(sourceFile: TFile, previewRows: readonly RecursiveSplitPreviewRow[]): Promise<ConfirmDialogModalResult> {
    const app = this.app;
    return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openModal(
        new ConfirmDialogModal({
          app,
          buildContent: (fragment): Promise<void> => buildRecursiveSplitConfirmContent({ app, fragment, previewRows, sourceFile }),
          // There is no target to reselect: every target is derived from a heading.
          canReselectTarget: false,
          confirmButtonMobileText: 'Split and don\'t ask again',
          confirmButtonText: 'Split',
          promiseResolve,
          title: 'Split note recursively'
        })
      );
    });
  }

  /**
   * Opens a note produced by the split so the next pass has an editor to work in. {@link SplitComposer}
   * drives the source through the editor (it is the editor selection that gets replaced by the residual
   * link), so a note cannot be split without being open.
   *
   * @param file - The note to open.
   * @returns Its editor, or `null` when the note did not open as a markdown view.
   */
  private async openAndGetEditor(file: TFile): Promise<Editor | null> {
    await this.app.workspace.getLeaf(false).openFile(file, { active: true });
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.editor ?? null;
  }

  /**
   * Splits one note into its heading-named children, then recurses into each of them — which is what turns
   * a heading hierarchy into a folder hierarchy.
   *
   * Each pass extracts a heading together with its whole subtree (`getSelectionUnderHeading` stops at the
   * next equal-or-higher heading), into a new note forced both into the source note's own folder and into
   * a folder of its own. So a child of `<dir>/A/A.md` lands at `<dir>/A/B/B.md`, and the nesting comes out
   * of the existing split machinery rather than from any path arithmetic here.
   *
   * The one exception is the ROOT pass with `shouldSplitRecursivelyIntoDefaultNewNoteFolder` on (issue
   * #173): it resolves through Obsidian's own new-file location instead, which moves the whole produced
   * tree into the `Default location for new notes` while every deeper pass still nests under its parent.
   *
   * @param params - The parameters.
   * @returns The notes created, including those created by the recursive passes, each paired with the note
   * it was split out of. A pass that gives up part-way returns what it created up to that point, so those
   * notes still get templated.
   */
  private async splitBranch(params: SplitNoteByHeadingsRecursivelyEditorCommandHandlerSplitBranchParams): Promise<readonly SplitTemplateNote[]> {
    const { editor, file, minLevel } = params;
    const children: RecursiveSplitChild[] = [];
    const createdNotes: SplitTemplateNote[] = [];

    /*
     * Beside its source for every pass but the root one — that composition with `shouldForceSplitIntoFolder`
     * IS the folder tree. The root pass gives it up only when the user asked for the tree to be rooted in
     * Obsidian's default new-note folder (issue #173); an explicit `false` is what forces that resolution,
     * overriding the `shouldAllowOnlyCurrentFolderByDefault` setting.
     */
    const shouldAllowOnlyCurrentFolderOverride = !params.isRootPass
      || !this.pluginSettingsComponent.settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder;

    for (;;) {
      const cache = await getCacheSafe(this.app, file);
      if (!cache) {
        break;
      }
      const heading = findNextHeadingToSplit(cache.headings ?? [], minLevel);
      if (!heading) {
        break;
      }
      const headingInfo = getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: heading.position.start.line });
      if (!headingInfo) {
        this.pluginNoticeComponent.showNotice('Failed to find heading');
        return createdNotes;
      }
      editor.setSelection(headingInfo.start, headingInfo.end);
      const result = await prepareForSplitFile({
        app: this.app,
        editor,
        heading: headingInfo.heading,
        pluginSettingsComponent: this.pluginSettingsComponent,
        resourceLockComponent: this.resourceLockComponent,
        shouldAllowOnlyCurrentFolderOverride,
        shouldForceSplitIntoFolder: true,
        shouldSkipConfirmation: true,
        shouldSkipModal: true,
        sourceFile: file
      });
      if (!result) {
        return createdNotes;
      }
      const composer = new SplitComposer({
        app: this.app,
        capturedSelections: result.capturedSelections,
        consoleDebugComponent: this.consoleDebugComponent,
        editor,
        heading: headingInfo.heading,
        isMultipleSplit: true,
        isNewTargetFile: result.isNewTargetFile,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent,
        resourceLockComponent: this.resourceLockComponent,
        selectedText: result.selectedText,
        sourceFile: file,
        targetFile: result.targetFile,
        // Write the extracted content untouched: the split template is applied to every produced note
        // Afterwards, once its own children have been split out of it (issue #172).
        templateOverride: CONTENT_ONLY_TEMPLATE
      });
      await composer.splitFile();
      createdNotes.push({ file: result.targetFile, sourceFile: file });
      children.push({ file: result.targetFile, level: heading.level });
    }

    for (const child of children) {
      if (child.level >= MAX_HEADING_LEVEL) {
        continue;
      }
      const childEditor = await this.openAndGetEditor(child.file);
      if (!childEditor) {
        continue;
      }
      createdNotes.push(...await this.splitBranch({ editor: childEditor, file: child.file, isRootPass: false, minLevel: child.level + 1 }));
    }

    return createdNotes;
  }
}

async function buildRecursiveSplitConfirmContent(params: BuildRecursiveSplitConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    previewRows,
    sourceFile
  } = params;
  fragment.appendText('Are you sure you want to split ');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' into a folder tree of ');
  appendCodeBlock(fragment, String(previewRows.length));
  fragment.appendText(' notes?');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: sourceFile }));
  fragment.createEl('br');
  fragment.createEl('br');
  fragment.createEl('h2', { text: 'Notes that will be created' });
  for (const row of previewRows) {
    appendCodeBlock(fragment, `${PREVIEW_INDENT.repeat(row.depth)}${row.headingText}`);
    fragment.createEl('br');
  }
}
