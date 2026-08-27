import type {
  App,
  TFolder,
  WorkspaceLeaf
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import {
  MarkdownView,
  TFile
} from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { AttachmentToRelocate } from './attachments.ts';
import type { FolderHeadingPlan } from './folder-headings.ts';
import type { LockTarget } from './locked-transaction.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  collectAttachmentsOwnedByNote,
  collectAttachmentsToRelocate,
  relocateAttachments
} from './attachments.ts';
import { MergeComposer } from './composers/merge-composer.ts';
import { runLockedTransaction } from './locked-transaction.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationPermanentProgressNotice
} from './operation-notices.ts';
import { recordRecentTarget } from './recent-targets.ts';

/**
 * Parameters for {@link mergeFilesIntoSingleFile}.
 */
export interface MergeFilesIntoSingleFileParams {
  readonly app: App;

  /**
   * The folder whose attachments follow the notes into the target's attachment folder (issue #160 item
   * 3, issue #161). Omitted for a merge that should leave attachments where they are — the multi-file
   * merge (which has no folder) and a folder merge with the setting off.
   */
  readonly attachmentSourceFolder?: TFolder | undefined;

  readonly consoleDebugComponent: ConsoleDebugComponent;

  /**
   * The folder-derived headings to weave into the target as the sources are merged (issue #160), one
   * entry per source path plus the headings left over after the last of them. Omitted for a plain merge,
   * which writes no headings and demotes nothing.
   */
  readonly folderHeadingPlan?: FolderHeadingPlan | undefined;

  /**
   * Whether {@link MergeFilesIntoSingleFileParams.targetFile} was freshly created (empty) for this
   * operation. When `true`, the FIRST merged source is treated as a new-target merge (so it keeps the
   * source note's `title` and seeds the target frontmatter); every later source merges into the
   * now-existing target.
   */
  readonly isNewTargetFile: boolean;

  readonly pluginNoticeComponent: PluginNoticeComponent;

  readonly pluginSettingsComponent: PluginSettingsComponent;
  /**
   * The progressive label shown in the permanent progress notice, e.g. `Merging folder` or
   * `Merging files`.
   */
  readonly progressLabel: string;
  readonly resourceLockComponent: ResourceLockComponent;

  /**
   * Whether each source note's OWN attachments follow it into the target's attachment folder (issue
   * #161) — the file-level rule, used by the multi-file merge, which has no folder to scope the
   * attachments by. Ignored when {@link MergeFilesIntoSingleFileParams.attachmentSourceFolder} is
   * given: a folder merge collects by folder instead.
   */
  readonly shouldRelocateOwnedAttachments?: boolean | undefined;

  /**
   * The source notes to merge, in the order they should be concatenated into the target. The target
   * itself (if present) is skipped.
   */
  readonly sourceFiles: readonly TFile[];
  readonly targetFile: TFile;
}

/**
 * The outcome of a {@link mergeFilesIntoSingleFile} run.
 */
export interface MergeFilesIntoSingleFileResult {
  /**
   * `true` when the operation was cancelled (user unlock or external change) and everything was rolled
   * back. The caller uses this to clean up a freshly created empty target.
   */
  readonly aborted: boolean;

  /**
   * The source files skipped because their path is ignored in the plugin settings.
   */
  readonly ignoredSourceFiles: readonly TFile[];

  /**
   * The number of source notes actually merged into the target.
   */
  readonly mergedCount: number;
}

/**
 * A tab that was showing one of the notes being merged away, closed up front so its disappearance does not
 * cascade (issue #212). Enough to put it back if the merge rolls back.
 */
interface ClosedNoteLeaf {
  readonly path: string;

  /**
   * Whether this was the tab the user was in, so a restored workspace puts them back in it rather than in
   * whichever note happened to be reopened last.
   */
  readonly wasActive: boolean;
}

interface CollectAttachmentsParams {
  readonly app: App;
  readonly attachmentExtensions: readonly string[];
  readonly folder: TFolder | undefined;
  readonly noteFiles: readonly TFile[];
  readonly shouldRelocateOwnedAttachments: boolean;
}

/**
 * Merges every note in {@link MergeFilesIntoSingleFileParams.sourceFiles} into the single
 * {@link MergeFilesIntoSingleFileParams.targetFile}, in order, inside ONE reversible resource-locked
 * transaction (so the whole batch commits together or rolls back on cancel/error). Each source is run
 * through the same {@link MergeComposer} as a single-file merge — the merge template, frontmatter merge
 * strategy, footnote fixing, and backlink/link updating all apply — with the per-file notice and
 * post-merge open suppressed (so the active tab does not flicker through every note, issue #106).
 *
 * Sources whose path is ignored in the plugin settings are skipped and reported afterwards (unless
 * `Should always merge excluded items` is on). Backs both the "merge multiple selected files into one
 * file" and "merge folder contents into a single file" features (issue #92).
 *
 * @param params - The sources, the target, and the shared app/lock/notice context.
 * @returns A {@link Promise} resolving to the {@link MergeFilesIntoSingleFileResult}.
 */
export async function mergeFilesIntoSingleFile(params: MergeFilesIntoSingleFileParams): Promise<MergeFilesIntoSingleFileResult> {
  const {
    app,
    attachmentSourceFolder,
    consoleDebugComponent,
    folderHeadingPlan,
    isNewTargetFile,
    pluginNoticeComponent,
    pluginSettingsComponent,
    progressLabel,
    resourceLockComponent,
    shouldRelocateOwnedAttachments,
    sourceFiles,
    targetFile
  } = params;

  const { settings } = pluginSettingsComponent;
  const sourcesToMerge = sourceFiles.filter((sourceFile) => sourceFile !== targetFile);
  const ignoredSourceFiles: TFile[] = [];
  const headingPlanByPath = new Map((folderHeadingPlan?.entries ?? []).map((entry) => [entry.filePath, entry]));
  const trailingHeadings = folderHeadingPlan?.trailingHeadings ?? [];
  let mergedCount = 0;

  const notice = showOperationPermanentProgressNotice({
    content: await createFragmentAsync(async (f) => {
      f.appendText(`Advanced Note Composer: ${progressLabel} into `);
      f.append(await renderInternalLink({ app, pathOrAbstractFile: targetFile.path }));
      f.createEl('br');
      f.createEl('br');
      f.createDiv('is-loading');
    }),
    pluginNoticeComponent,
    pluginSettingsComponent
  });

  // The sources that will actually be merged away, as opposed to the ignored ones, which are left exactly
  // As they are - both their attachments and their open tabs.
  const notesToMerge = sourcesToMerge.filter((sourceFile) => !isMergeIgnored(pluginSettingsComponent, sourceFile.path, targetFile.path));
  const attachmentsToRelocate = await collectAttachments({
    app,
    attachmentExtensions: settings.attachmentExtensions,
    folder: attachmentSourceFolder,
    noteFiles: notesToMerge,
    shouldRelocateOwnedAttachments: shouldRelocateOwnedAttachments ?? false
  });

  /*
   * Issue #212: every note in this batch is about to be deleted, so every tab showing one is doomed. Left to
   * happen on its own, that is a cascade: `VaultTransaction` trashes the staged notes one at a time on
   * commit, and Obsidian activates the NEXT surviving tab on each closure - the tab strip visibly walks
   * through the notes being merged. Measured with four of a folder's notes open: four `active-leaf-change`
   * events, the last of them landing on an unrelated note. Closing them here, in ONE synchronous pass before
   * anything is mutated, collapses that to a single change (measured: zero events for the batch itself).
   *
   * This is NOT the issue-#106 bug - nothing here ever OPENED a merged note, and the per-note
   * `shouldOpenAfterMerge: false` below has always held - but it is the same symptom the user sees, which is
   * why #212 reported it as one.
   */
  const closedNoteLeaves = closeLeavesShowingFiles(app, notesToMerge);

  const lockTargets: LockTarget[] = [{ mode: 'file', pathOrFile: targetFile }];
  for (const sourceFile of sourcesToMerge) {
    lockTargets.push({ mode: 'file', pathOrFile: sourceFile });
  }
  for (const attachment of attachmentsToRelocate) {
    lockTargets.push({ mode: 'file', pathOrFile: attachment.file });
  }

  const abortController = new AbortController();
  try {
    await runLockedTransaction({
      abortController,
      app,
      body: async (vaultTransaction) => {
        // Attachments move FIRST, while their notes still exist: the vault's own rename then fixes the
        // Links in those notes, and each merge's link rewriting re-resolves them against the target.
        await relocateAttachments({
          app,
          relocations: attachmentsToRelocate.map((attachment) => ({
            attachment: attachment.file,
            newNoteFile: targetFile,
            oldNoteFile: attachment.ownerNoteFile
          })),
          vaultTransaction
        });

        let isFirstMergeIntoNewTarget = isNewTargetFile;
        const pendingHeadings: string[] = [];
        for (const sourceFile of sourcesToMerge) {
          if (abortController.signal.aborted) {
            throw new Error('Merge into single file aborted.');
          }
          const headingPlanEntry = headingPlanByPath.get(sourceFile.path);
          pendingHeadings.push(...headingPlanEntry?.headings ?? []);
          if (isMergeIgnored(pluginSettingsComponent, sourceFile.path, targetFile.path)) {
            ignoredSourceFiles.push(sourceFile);
            continue;
          }
          // Headings are flushed only once a source actually reaches the merge, so a folder whose notes
          // Are all skipped never leaves an empty heading behind in the target.
          if (pendingHeadings.length > 0) {
            const headingBlock = buildHeadingBlock(pendingHeadings);
            pendingHeadings.length = 0;
            await vaultTransaction.process(targetFile, (targetFileContent) => targetFileContent + headingBlock);
          }
          const composer = new MergeComposer({
            app,
            consoleDebugComponent,
            headingLevelShift: headingPlanEntry?.depth ?? 0,
            isNewTargetFile: isFirstMergeIntoNewTarget,
            pluginNoticeComponent,
            pluginSettingsComponent,
            resourceLockComponent,
            // The whole batch shares ONE target: a per-file open would flicker the active tab through
            // Every merged note (issue #106), and a per-file notice would spam. The batch reports once.
            // Follows the picker that chose the target (issue #253): an excluded destination the picker
            // Was allowed to offer must not then be refused by the composer's own guard.
            shouldMergeIgnoredTarget: settings.shouldOfferExcludedPathsAsMergeDestinations,
            // The batch relocates the attachments itself, once, before the first merge (see above), so
            // The composer's own per-note relocation would move them a second time.
            shouldMoveAttachments: false,
            shouldOpenAfterMerge: false,
            shouldShowNotice: false,
            sourceFile,
            targetFile,
            vaultTransaction
          });
          await composer.mergeFile();
          isFirstMergeIntoNewTarget = false;
          mergedCount++;
        }

        /*
         * The folders visited after the LAST note have no source left to be flushed in front of, so they
         * are appended once here (issue #168 — an empty folder at the tail of the walk). Whatever is still
         * in `pendingHeadings` is deliberately NOT: those belong to a folder whose notes were all skipped,
         * which must leave no heading behind. The plan separates the two so this does not have to guess.
         */
        if (trailingHeadings.length > 0) {
          await vaultTransaction.process(targetFile, (targetFileContent) => targetFileContent + buildHeadingBlock(trailingHeadings));
        }
      },
      lockTargets,
      operationName: progressLabel,
      resourceLockComponent
    });
  } catch (error) {
    // The transaction has rolled back, so every merged-away note is back on disk - and so must be the tabs
    // Closed for them above, or a cancelled merge would leave the workspace quietly rearranged.
    await reopenClosedLeaves(app, closedNoteLeaves);
    if (abortController.signal.aborted) {
      // The operation was cancelled (user or external change); the transaction has rolled back.
      return { aborted: true, ignoredSourceFiles, mergedCount: 0 };
    }
    throw error;
  } finally {
    notice?.hide();
  }

  if (mergedCount > 0) {
    // The batch records its target once for the whole run, for the same reason it reports once: the
    // Per-note composers run on the injected transaction and deliberately record nothing (issue #206).
    recordRecentTarget(targetFile);

    // The batch reports once for the whole run — every `MergeComposer` in it was constructed with
    // `shouldShowNotice: false` precisely so it does not report per note.
    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app,
        pluginSettingsComponent,
        sourcePathOrAbstractFile: targetFile.path,
        verb: `Merged ${String(mergedCount)} note(s) into`
      }),
      pluginNoticeComponent,
      pluginSettingsComponent
    });
  }

  await showIgnoredFilesNotice(app, pluginNoticeComponent, ignoredSourceFiles);
  warnIfTemplaterMissing(app, pluginNoticeComponent, settings.shouldRunTemplaterOnDestinationFile);

  return { aborted: false, ignoredSourceFiles, mergedCount };
}

function buildHeadingBlock(headings: readonly string[]): string {
  return headings.map((heading) => `\n\n${heading}`).join('');
}

/**
 * Closes every open tab showing one of the notes this batch is about to merge away, in ONE synchronous pass
 * (issue #212).
 *
 * The tabs are doomed either way — the notes are deleted — so the choice is only between them going all at
 * once and them falling away one at a time. The latter is what a user sees as the tab strip "cycling"
 * through the notes being merged: `VaultTransaction` trashes the staged notes individually on commit, and
 * Obsidian activates the next surviving tab on each closure. Detaching them together produces no
 * intermediate activation at all.
 *
 * The detaching is deliberately separated from the collecting: mutating the workspace while iterating it is
 * how a leaf gets skipped.
 *
 * @param app - The Obsidian application instance.
 * @param files - The notes that are about to be merged away.
 * @returns What was closed, in the order it was found, for {@link reopenClosedLeaves} to restore.
 */
function closeLeavesShowingFiles(app: App, files: readonly TFile[]): ClosedNoteLeaf[] {
  const pathsToClose = new Set(files.map((file) => file.path));
  const activeLeaf = app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
  const leavesToDetach: WorkspaceLeaf[] = [];
  const closedNoteLeaves: ClosedNoteLeaf[] = [];

  app.workspace.iterateAllLeaves((leaf) => {
    const { view } = leaf;
    if (!(view instanceof MarkdownView)) {
      return;
    }
    const path = view.file?.path;
    if (path === undefined || !pathsToClose.has(path)) {
      return;
    }
    leavesToDetach.push(leaf);
    closedNoteLeaves.push({ path, wasActive: leaf === activeLeaf });
  });

  for (const leaf of leavesToDetach) {
    leaf.detach();
  }

  return closedNoteLeaves;
}

/**
 * Resolves which attachments this batch carries into the target, by the rule that fits the operation: a
 * folder merge collects everything under the merged FOLDER (issue #160 item 3), while the multi-file
 * merge — which has no folder — collects the attachments each source NOTE owns (issue #161). Neither
 * applies when the corresponding setting is off, in which case nothing moves.
 *
 * @param params - The notes, the optional folder, and which rule to apply.
 * @returns The attachments to relocate with their owning notes.
 */
async function collectAttachments(params: CollectAttachmentsParams): Promise<AttachmentToRelocate[]> {
  const {
    app,
    attachmentExtensions,
    folder,
    noteFiles,
    shouldRelocateOwnedAttachments
  } = params;

  if (folder) {
    return await collectAttachmentsToRelocate({ app, folder, noteFiles });
  }

  if (!shouldRelocateOwnedAttachments) {
    return [];
  }

  const attachments = new Map<string, AttachmentToRelocate>();
  for (const noteFile of noteFiles) {
    for (const attachment of collectAttachmentsOwnedByNote({ app, attachmentExtensions, noteFile })) {
      attachments.set(attachment.file.path, attachment);
    }
  }
  return [...attachments.values()];
}

function isMergeIgnored(pluginSettingsComponent: PluginSettingsComponent, sourcePath: string, targetPath: string): boolean {
  const { settings } = pluginSettingsComponent;
  // Source and target are decided by their own settings since issue #253 — what a merge may swallow, and
  // Where it may land. Mirrors `MergeFolderCommandHandler.isMergeIgnored`.
  if (!settings.shouldAlwaysMergeExcludedItems && settings.isPathIgnored(sourcePath)) {
    return true;
  }
  return !settings.shouldOfferExcludedPathsAsMergeDestinations && settings.isPathIgnored(targetPath);
}

/**
 * Puts back the tabs {@link closeLeavesShowingFiles} closed, after a merge that rolled back (issue #212).
 *
 * A note that is not there is skipped rather than treated as an error: the rollback restores what the
 * transaction staged, and a note it could not bring back has no tab to restore either.
 *
 * @param app - The Obsidian application instance.
 * @param closedNoteLeaves - What was closed before the merge started.
 * @returns A {@link Promise} that resolves once the tabs are back.
 */
async function reopenClosedLeaves(app: App, closedNoteLeaves: readonly ClosedNoteLeaf[]): Promise<void> {
  for (const closedNoteLeaf of closedNoteLeaves) {
    const file = app.vault.getFileByPath(closedNoteLeaf.path);
    if (!file) {
      continue;
    }
    await app.workspace.getLeaf('tab').openFile(file, { active: closedNoteLeaf.wasActive });
  }
}

async function showIgnoredFilesNotice(app: App, pluginNoticeComponent: PluginNoticeComponent, ignoredSourceFiles: readonly TFile[]): Promise<void> {
  if (ignoredSourceFiles.length === 0) {
    return;
  }
  pluginNoticeComponent.showNotice(
    await createFragmentAsync(async (f) => {
      f.appendText(
        `Advanced Note Composer: ${String(ignoredSourceFiles.length)} file(s) were not merged because they are ignored in the plugin settings:`
      );
      for (const ignoredSourceFile of ignoredSourceFiles) {
        f.createEl('br');
        f.append(await renderInternalLink({ app, pathOrAbstractFile: ignoredSourceFile.path }));
      }
    })
  );
}

function warnIfTemplaterMissing(app: App, pluginNoticeComponent: PluginNoticeComponent, shouldRunTemplater: boolean): void {
  if (!shouldRunTemplater) {
    return;
  }
  if (app.plugins.plugins['templater-obsidian']) {
    return;
  }
  pluginNoticeComponent.showNotice(createFragment((f) => {
    f.appendText('Advanced Note Composer: You have enabled setting ');
    appendCodeBlock(f, 'Should run templater on destination file');
    f.appendText(', but Templater plugin is not installed.');
  }));
}
