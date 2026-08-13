import type {
  App,
  CachedMetadata,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
  TFile,
  TFolder
} from 'obsidian';
import type { EditorCommandHandlerConstructorParams } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { MarkdownView } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
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
import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import {
  resolveSplitTemplateForNewTargetFile,
  SplitComposer
} from '../composers/split-composer.ts';
import {
  findNextHeadingToSplit,
  MAX_HEADING_LEVEL
} from '../heading-split-recursion.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { selectFolder } from '../modals/select-folder-modal.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { openConfirmDialogModal } from '../open-minimizable-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { recordRecentTarget } from '../recent-targets.ts';
import { ActiveEditorCommandHandlerBase } from './active-editor-command-handler-base.ts';

/**
 * What one invocation of a recursive split is going to do, as resolved by the subclass from the cursor and
 * the note's heading cache. Everything the flow needs that differs between the whole-note command and the
 * single-heading one lives here; everything below the root pass is identical and stays in this base.
 */
export interface RecursiveSplitRun {
  /**
   * The verb the completion notice opens with, e.g. `Split note`.
   */
  readonly completionVerb: string;

  /**
   * The confirmation dialog's title.
   */
  readonly dialogTitle: string;

  /**
   * The heading the run is scoped to, named in the confirmation dialog, or `null` when the whole note is
   * being split.
   */
  readonly headingText: null | string;

  /**
   * The notes that will be created, in document order.
   */
  readonly previewRows: readonly RecursiveSplitPreviewRow[];

  /**
   * The verb the progress notice opens with, e.g. `Splitting note recursively`.
   */
  readonly progressVerb: string;

  /**
   * The line of the ONE heading the root pass extracts, or `null` to extract every heading at the
   * shallowest level the note has (and then, as it loops, its every sibling) — which is the difference
   * between `Split heading recursively...` and `Split note by headings recursively...`. Either way the
   * passes below the root are the same: each produced note is recursed into with its own heading's level
   * plus one.
   */
  readonly rootHeadingLine: null | number;
}

interface BuildRecursiveSplitConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;

  /**
   * The heading the run is scoped to, or `null` when the whole note is being split.
   */
  readonly headingText: null | string;
  readonly previewRows: readonly RecursiveSplitPreviewRow[];
  readonly rootFolder: TFolder;
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

/**
 * Where the recursive split roots the tree it produces.
 *
 * `rootFolderOverride` is `null` on an untouched run — the DERIVED destination stands, resolved as it always
 * was from `shouldSplitRecursivelyIntoDefaultNewNoteFolder`. Only a folder the user picked from "Change
 * target" (issue #205) makes it non-`null`, and it applies to the root pass alone.
 */
interface RecursiveSplitRootTarget {
  readonly rootFolderOverride: null | TFolder;
}

interface SplitRecursivelyEditorCommandHandlerBaseConstructorParams extends EditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface SplitRecursivelyEditorCommandHandlerBaseSplitBranchParams {
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

  /**
   * The folder the user picked from the confirmation dialog's "Change target", or `null` to keep the derived
   * destination. Meaningful for the ROOT pass only — a deeper pass always nests beside its own source.
   */
  readonly rootFolderOverride: null | TFolder;

  /**
   * See {@link RecursiveSplitRun.rootHeadingLine} — `null` on every pass but a scoped root one.
   */
  readonly rootHeadingLine: null | number;
}

interface SplitRecursivelyEditorCommandHandlerBaseSplitOneHeadingParams {
  readonly editor: Editor;
  readonly file: TFile;
  readonly heading: HeadingCache;
  readonly shouldAllowOnlyCurrentFolderOverride: boolean;
  readonly targetParentFolderOverride: null | TFolder;
}

const PREVIEW_INDENT_WIDTH = 4;
const PREVIEW_INDENT = ' '.repeat(PREVIEW_INDENT_WIDTH);

/**
 * Shared base for the recursive split commands. It owns the whole flow — the ignored-path guard, the single
 * up-front confirmation with its "Change target" loop, the progress/completion notices, the recursion
 * itself, and the deferred split-template pass — leaving subclasses only {@link resolveRun}: WHICH headings
 * the root pass extracts, and what the dialog and notices call the operation.
 */
export abstract class SplitRecursivelyEditorCommandHandlerBase extends ActiveEditorCommandHandlerBase {
  protected readonly pluginNoticeComponent: PluginNoticeComponent;
  protected readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SplitRecursivelyEditorCommandHandlerBaseConstructorParams) {
    super(params);

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
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

    const run = this.resolveRun(editor, file, cache);
    if (!run) {
      return;
    }

    const rootTarget = await this.resolveRootTarget(file, run);
    if (!rootTarget) {
      return;
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
          pluginSettingsComponent: this.pluginSettingsComponent,
          sourcePathOrAbstractFile: file,
          verb: run.progressVerb
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    let createdNotes: readonly SplitTemplateNote[];
    try {
      createdNotes = await this.splitBranch({
        editor,
        file,
        isRootPass: true,
        minLevel: 1,
        rootFolderOverride: rootTarget.rootFolderOverride,
        rootHeadingLine: run.rootHeadingLine
      });
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
      folderNameTemplate: this.pluginSettingsComponent.settings.reorderedFolderNameTemplate,
      notes: createdNotes,
      resourceLockComponent: this.resourceLockComponent,
      template: resolveSplitTemplateForNewTargetFile(this.pluginSettingsComponent.settings)
    });

    // The run landed, so the folder the produced tree was rooted in counts as clicked-on for the next
    // Picker (issue #206). Recorded here, once, rather than by the per-note composers: this is the only
    // Destination in the run the user actually chose, and recording every produced note would bury the
    // List under a single operation's output.
    recordRecentTarget(rootTarget.rootFolderOverride ?? this.resolveDefaultRootFolder(file));

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourcePathOrAbstractFile: file,
        suffix: ` into ${String(createdNotes.length)} note(s)`,
        verb: run.completionVerb
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  /**
   * Resolves what this invocation will split, from the cursor and the note's heading cache.
   *
   * @param editor - The editor the command was invoked in.
   * @param file - The note being split.
   * @param cache - That note's metadata cache entry.
   * @returns The run, or `null` when there is nothing to split.
   */
  protected abstract resolveRun(editor: Editor, file: TFile, cache: CachedMetadata): null | RecursiveSplitRun;

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  /**
   * Asks once, up front, before restructuring the note. The individual splits that follow are
   * confirmation-free (`shouldSkipConfirmation`): a deep heading tree produces many of them, and confirming
   * each would be unusable. Mirrors the other flows in mapping "Don't ask again" back onto
   * `shouldAskBeforeSplitting`.
   *
   * Every note's own name comes from its heading and is not changeable, but WHERE the produced tree is
   * rooted is — so "Change target" picks the root folder (issue #205).
   *
   * @param sourceFile - The note being split.
   * @param rootFolder - The folder the produced tree will be rooted in.
   * @param run - The resolved run.
   * @returns The dialog result.
   */
  private async confirmRecursiveSplit(
    sourceFile: TFile,
    rootFolder: TFolder,
    run: RecursiveSplitRun
  ): Promise<ConfirmDialogModalResult> {
    const app = this.app;
    return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openConfirmDialogModal(
        new ConfirmDialogModal({
          app,
          buildContent: (fragment): Promise<void> =>
            buildRecursiveSplitConfirmContent({
              app,
              fragment,
              headingText: run.headingText,
              previewRows: run.previewRows,
              rootFolder,
              sourceFile
            }),
          canReselectTarget: true,
          confirmButtonMobileText: 'Split and don\'t ask again',
          confirmButtonText: 'Split',
          promiseResolve,
          title: run.dialogTitle
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
   * Where the produced tree is rooted when the user does not change it — the two answers issue #173 settled
   * on. Resolved here rather than left implicit inside the split machinery, because the confirmation dialog
   * has to SHOW it before "Change target" can mean anything.
   *
   * @param sourceFile - The note being split.
   * @returns The folder the root pass would create its notes in.
   */
  private resolveDefaultRootFolder(sourceFile: TFile): TFolder {
    if (this.pluginSettingsComponent.settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder) {
      return this.app.fileManager.getNewFileParent(sourceFile.path);
    }
    /* v8 ignore next -- a note in the vault always has a parent folder. */
    return sourceFile.parent ?? this.app.vault.getRoot();
  }

  /**
   * Runs the confirmation dialog and, whenever it comes back with "Change target", the root-folder picker —
   * looping until the user confirms or cancels (issue #205).
   *
   * The override stays `null` unless the user actually picks something, so an untouched run goes down
   * exactly the path it did before: the root pass keeps resolving through
   * `shouldSplitRecursivelyIntoDefaultNewNoteFolder`, and nothing about the nesting of the deeper passes
   * changes. The preview rows need no rebuilding — they are heading text and depth, which the root folder
   * does not affect.
   *
   * @param sourceFile - The note being split.
   * @param run - The resolved run.
   * @returns The chosen root, or `null` when the flow was cancelled.
   */
  private async resolveRootTarget(sourceFile: TFile, run: RecursiveSplitRun): Promise<null | RecursiveSplitRootTarget> {
    if (!this.pluginSettingsComponent.settings.shouldAskBeforeSplitting) {
      return { rootFolderOverride: null };
    }

    const defaultRootFolder = this.resolveDefaultRootFolder(sourceFile);
    let rootFolderOverride: null | TFolder = null;
    for (;;) {
      const confirmResult = await this.confirmRecursiveSplit(sourceFile, rootFolderOverride ?? defaultRootFolder, run);
      if (confirmResult.shouldReselectTarget) {
        const selectedFolder = await selectFolder({
          app: this.app,
          isAllowedFolder: (folder) => !this.pluginSettingsComponent.settings.isPathIgnored(folder.path),
          placeholder: 'Select folder to root the produced tree in...',
          pluginSettingsComponent: this.pluginSettingsComponent
        });
        if (selectedFolder) {
          rootFolderOverride = selectedFolder;
        }
        continue;
      }
      if (!confirmResult.isConfirmed) {
        return null;
      }
      await this.pluginSettingsComponent.editAndSave((settings) => {
        settings.shouldAskBeforeSplitting = confirmResult.shouldAskAgain;
      });
      return { rootFolderOverride };
    }
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
   * A `rootHeadingLine` root pass extracts that ONE heading and stops looping (issue #228); every pass
   * below it is the ordinary loop, so the subtree under the chosen heading comes out exactly as it would
   * have in a whole-note split while the note's other headings are never looked at.
   *
   * @param params - The parameters.
   * @returns The notes created, including those created by the recursive passes, each paired with the note
   * it was split out of. A pass that gives up part-way returns what it created up to that point, so those
   * notes still get templated.
   */
  private async splitBranch(params: SplitRecursivelyEditorCommandHandlerBaseSplitBranchParams): Promise<readonly SplitTemplateNote[]> {
    const {
      editor,
      file,
      minLevel,
      rootHeadingLine
    } = params;
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
      const headings = cache.headings ?? [];
      const heading = rootHeadingLine === null
        ? findNextHeadingToSplit(headings, minLevel)
        : headings.find((candidate) => candidate.position.start.line === rootHeadingLine) ?? null;
      if (!heading) {
        break;
      }
      const child = await this.splitOneHeading({
        editor,
        file,
        heading,
        shouldAllowOnlyCurrentFolderOverride,
        // Root pass only: the deeper passes must keep nesting beside their own source, which IS the folder
        // Tree. `null` on an untouched run, so the setting-driven resolution above stands unchanged.
        targetParentFolderOverride: params.isRootPass ? params.rootFolderOverride : null
      });
      if (!child) {
        return createdNotes;
      }
      createdNotes.push({ file: child.file, sourceFile: file });
      children.push(child);
      if (rootHeadingLine !== null) {
        break;
      }
    }

    for (const child of children) {
      if (child.level >= MAX_HEADING_LEVEL) {
        continue;
      }
      const childEditor = await this.openAndGetEditor(child.file);
      if (!childEditor) {
        continue;
      }
      createdNotes.push(
        ...await this.splitBranch({
          editor: childEditor,
          file: child.file,
          isRootPass: false,
          minLevel: child.level + 1,
          rootFolderOverride: null,
          rootHeadingLine: null
        })
      );
    }

    return createdNotes;
  }

  /**
   * Extracts one heading and its whole subtree into a note of its own.
   *
   * @param params - The parameters.
   * @returns The produced note paired with the level of the heading it came from, or `null` when the pass
   * gave up (the heading could not be resolved, or the split setup was cancelled).
   */
  private async splitOneHeading(params: SplitRecursivelyEditorCommandHandlerBaseSplitOneHeadingParams): Promise<null | RecursiveSplitChild> {
    const {
      editor,
      file,
      heading
    } = params;
    const headingInfo = getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: heading.position.start.line });
    if (!headingInfo) {
      this.pluginNoticeComponent.showNotice('Failed to find heading');
      return null;
    }
    editor.setSelection(headingInfo.start, headingInfo.end);
    const result = await prepareForSplitFile({
      app: this.app,
      editor,
      heading: headingInfo.heading,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      shouldAllowOnlyCurrentFolderOverride: params.shouldAllowOnlyCurrentFolderOverride,
      shouldForceSplitIntoFolder: true,
      shouldSkipConfirmation: true,
      shouldSkipModal: true,
      sourceFile: file,
      targetParentFolderOverride: params.targetParentFolderOverride
    });
    if (!result) {
      return null;
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
    return { file: result.targetFile, level: heading.level };
  }
}

async function buildRecursiveSplitConfirmContent(params: BuildRecursiveSplitConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    headingText,
    previewRows,
    rootFolder,
    sourceFile
  } = params;
  fragment.appendText('Are you sure you want to split ');
  if (headingText !== null) {
    fragment.appendText('heading ');
    appendCodeBlock(fragment, headingText);
    fragment.appendText(' of ');
  }
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' into a folder tree of ');
  appendCodeBlock(fragment, String(previewRows.length));
  fragment.appendText(' notes under ');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText('?');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: sourceFile }));
  fragment.createEl('br');
  fragment.createEl('br');
  /*
   * The root the tree is built under. Rendered because "Change target" changes it (issue #205), and a
   * control whose effect is invisible is indistinguishable from one that does nothing — the very complaint
   * that issue is about. It is a real, existing folder, so it links (unlike the merge target of issue #166,
   * which does not exist until the operation runs).
   */
  appendCodeBlock(fragment, 'Target');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: rootFolder }));
  fragment.createEl('br');
  fragment.createEl('br');
  fragment.createEl('h2', { text: 'Notes that will be created' });
  for (const row of previewRows) {
    appendCodeBlock(fragment, `${PREVIEW_INDENT.repeat(row.depth)}${row.headingText}`);
    fragment.createEl('br');
  }
}
