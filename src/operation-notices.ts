import type {
  App,
  Notice
} from 'obsidian';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentDelayedNotice,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { PathOrAbstractFile } from 'obsidian-dev-utils/obsidian/file-system';
import type { ValueProvider } from 'obsidian-dev-utils/value-provider';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { normalizeOptionalProperties } from 'obsidian-dev-utils/object-utils';
import { PluginNoticeMode } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { resolveValue } from 'obsidian-dev-utils/value-provider';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { buildFolderNoteOptions } from './folder-note.ts';
import { showOperationProgressModal } from './operation-progress-modal.ts';

/**
 * How many of an operation's created notes a notice names before it stops and counts the rest (issue #235).
 *
 * A notice is one line in the corner of the screen that hides itself again, so the list has to stay
 * readable at a glance; three names plus ` and N more` still says WHAT was created and HOW MUCH, while a
 * batch split of thirty headings would otherwise fill the screen with links.
 */
export const MAX_LINKED_CREATED_NOTES = 3;

/**
 * Parameters for {@link buildOperationNoticeContent}.
 */
export interface BuildOperationNoticeContentParams {
  readonly app: App;

  /**
   * The notes the operation CREATED at its TOP level, named as links after the {@link suffix} (issue #235).
   *
   * Top level, not every note produced: a recursive split turns one heading tree into a folder tree of
   * arbitrarily many notes, and naming all of them would make the notice unreadable — the total is what
   * {@link suffix} already states, and every deeper note is reachable from the ones named here. At most
   * {@link MAX_LINKED_CREATED_NOTES} are linked; the rest are counted as ` and N more`.
   *
   * @default `undefined`
   */
  readonly createdPathsOrAbstractFiles?: readonly PathOrAbstractFile[];

  /**
   * Whether the operation is still running. When `true` the content ends with the `is-loading` spinner
   * instead of a period, which is what makes a progress notice read as "still going".
   *
   * @default `false`
   */
  readonly isLoading?: boolean;

  /**
   * What clicking the TARGET link should do on top of opening the note and revealing it (issue #232).
   *
   * Supplied by the extract/split flow to land the user on the content it just wrote; every other
   * operation omits it and the link behaves as it always has. Invoked through `invokeAsyncSafely`, since a
   * DOM click listener cannot await.
   *
   * @default `undefined`
   */
  // `this: void` because it is a standalone callback, never a method of these params — which is also what
  // Lets it be destructured and handed on without tripping `unbound-method`.
  onTargetLinkClick?(this: void): Promise<void>;

  /**
   * Carries the `Folder note` settings a FOLDER link resolves its note with.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * The word joining the source to the target. `into` fits every merge/split/move; a swap reads `with`.
   * Ignored when there is no target.
   *
   * @default `'into'`
   */
  readonly preposition?: string;

  /**
   * Whether the source is rendered as a clickable internal link. Operations that CONSUME their source (a
   * merge trashes the note it merged away) must pass `false`: an internal link to a path that no longer
   * exists renders as unresolved, and clicking an unresolved note link CREATES that note — so the notice
   * reporting a deletion would offer to undo it by accident.
   *
   * @default `true`
   */
  readonly shouldLinkSource?: boolean;

  /**
   * The note or folder the operation acts on.
   */
  readonly sourcePathOrAbstractFile: PathOrAbstractFile;

  /**
   * Extra text appended after the last link, before the terminating period — e.g. ` and updated 3 links`.
   *
   * @default `''`
   */
  readonly suffix?: string;

  /**
   * The note or folder the operation acts on the source WITH. Omitted by operations that have only one
   * side, such as a flatten or a heading rename.
   *
   * @default `undefined`
   */
  readonly targetPathOrAbstractFile?: PathOrAbstractFile;

  /**
   * The verb phrase opening the notice — `Merging note` while it runs, `Merged note` once it is done.
   */
  readonly verb: string;
}

/**
 * Parameters for {@link renderOperationNoticeLink}.
 */
export interface RenderOperationNoticeLinkParams {
  readonly app: App;

  /**
   * What to run on click, on top of the open and the reveal.
   *
   * @default `undefined`
   */
  // See {@link BuildOperationNoticeContentParams.onTargetLinkClick} for why `this: void`.
  onClick?(this: void): Promise<void>;

  readonly pathOrAbstractFile: PathOrAbstractFile;

  /**
   * Carries the `Folder note` settings a FOLDER link resolves its note with. Still needed after dev-utils
   * took the resolution over: WHICH note describes a folder is this plugin's setting to answer, and the
   * library asks for it as a parameter.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link showOperationCompletionNotice}.
 */
export interface ShowOperationCompletionNoticeParams {
  readonly content: DocumentFragment | string;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link showOperationPermanentProgressNotice}.
 */
export interface ShowOperationPermanentProgressNoticeParams {
  readonly content: DocumentFragment;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link showOperationProgressNotice}.
 */
export interface ShowOperationProgressNoticeParams {
  /**
   * The operation's abort controller, which the notice's Cancel button aborts. Omitted by operations that
   * have no cancellation path, so no Cancel button is offered rather than one that does nothing.
   *
   * @default `undefined`
   */
  readonly abortController?: AbortController;

  /**
   * The Obsidian application instance, needed to open the blocking dialog when the user has asked for
   * one instead of a notice.
   */
  readonly app: App;

  /**
   * The notice content, resolved lazily only if the delay elapses.
   */
  readonly content: ValueProvider<DocumentFragment | string>;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface AppendCreatedNoteLinksParams {
  readonly app: App;
  readonly createdPathsOrAbstractFiles: readonly PathOrAbstractFile[];
  readonly fragmentEl: DocumentFragment;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Builds the content shared by every operation notice:
 * `<verb> <source>[ <preposition> <target>][suffix][: <created notes>]`, with every path rendered as a
 * clickable internal link, closed either by the `is-loading` spinner (a progress notice) or by a period (a
 * completion notice).
 *
 * @param params - The parameters.
 * @returns A {@link Promise} resolving to the notice content fragment.
 */
export function buildOperationNoticeContent(params: BuildOperationNoticeContentParams): Promise<DocumentFragment> {
  const {
    app,
    createdPathsOrAbstractFiles,
    isLoading,
    onTargetLinkClick,
    pluginSettingsComponent,
    preposition,
    shouldLinkSource,
    sourcePathOrAbstractFile,
    suffix,
    targetPathOrAbstractFile,
    verb
  } = params;

  return createFragmentAsync(async (fragmentEl) => {
    fragmentEl.appendText(`${verb} `);
    if (shouldLinkSource ?? true) {
      fragmentEl.append(await renderOperationNoticeLink({ app, pathOrAbstractFile: sourcePathOrAbstractFile, pluginSettingsComponent }));
    } else {
      // Deliberately NOT `getPath()`: that resolves the path against the vault, and the whole reason this
      // Branch exists is that the source is already gone from it.
      appendCodeBlock(fragmentEl, typeof sourcePathOrAbstractFile === 'string' ? sourcePathOrAbstractFile : sourcePathOrAbstractFile.path);
    }
    if (targetPathOrAbstractFile !== undefined) {
      fragmentEl.appendText(` ${preposition ?? 'into'} `);
      fragmentEl.append(
        await renderOperationNoticeLink(normalizeOptionalProperties<RenderOperationNoticeLinkParams>({
          app,
          onClick: onTargetLinkClick,
          pathOrAbstractFile: targetPathOrAbstractFile,
          pluginSettingsComponent
        }))
      );
    }
    if (suffix !== undefined) {
      fragmentEl.appendText(suffix);
    }
    await appendCreatedNoteLinks({
      app,
      createdPathsOrAbstractFiles: createdPathsOrAbstractFiles ?? [],
      fragmentEl,
      pluginSettingsComponent
    });
    if (isLoading ?? false) {
      fragmentEl.createDiv('is-loading');
      return;
    }
    fragmentEl.appendText('.');
  });
}

/**
 * Renders the clickable link an operation notice names a file or folder with.
 *
 * The link, and what clicking it does to the vault, are dev-utils' {@link renderInternalLink} since 94.2.0 —
 * both halves this module used to add itself now live there, asked for by parameter:
 *
 * - A FILE link opens the note (Obsidian's own handler) and, with `shouldRevealFile`, also REVEALS it in the
 *   file explorer (issue #232) — always on here, which is what makes a file link and a folder link read
 *   consistently.
 * - A FOLDER link cannot open a folder, so it opens that folder's FOLDER NOTE and reveals it (issue #234),
 *   landing the user in a document instead of leaving them in the explorer. Which note that is, is the
 *   plugin's own `Folder note` settings' answer — {@link buildFolderNoteOptions} — the same one
 *   `Rename folder...` and the reorder commands keep in step. A folder whose note is HIDDEN reveals the
 *   folder instead, and one with no note at all reveals the folder and opens nothing; nothing is ever
 *   created by a click.
 *
 * Both land on every notice this module builds rather than on the one operation each issue was filed about.
 * Everything is resolved at CLICK time rather than at render time — a notice outlives the operation that
 * showed it, so a destination renamed in between still reveals the right item, and a folder note written
 * after the notice appeared is still found.
 *
 * What is left HERE is the one thing dev-utils has no opinion about: the caller's own {@link
 * RenderOperationNoticeLinkParams.onClick} hook, layered on top of everything above.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} resolving to the rendered anchor.
 */
export async function renderOperationNoticeLink(params: RenderOperationNoticeLinkParams): Promise<HTMLAnchorElement> {
  const {
    app,
    onClick,
    pathOrAbstractFile,
    pluginSettingsComponent
  } = params;
  const aEl = await renderInternalLink({
    app,
    folderNote: buildFolderNoteOptions(pluginSettingsComponent.settings),
    pathOrAbstractFile,
    shouldRevealFile: true
  });

  if (onClick) {
    aEl.addEventListener('click', () => {
      // A DOM listener cannot await, and the jump has to outlive this handler: it polls for the very view
      // Obsidian's own handler is still opening.
      invokeAsyncSafely(onClick);
    });
  }

  return aEl;
}

/**
 * Reports a finished operation, unless the user turned operation notices off.
 *
 * Shown as a STANDALONE notice ({@link PluginNoticeMode.Separate}) rather than in the shared per-plugin
 * slot. An operation can have more than one thing to say — a folder merge reports which notes it skipped as
 * ignored, and that summary is emitted on either side of this one depending on the flow — and a slot notice
 * silently replaces whatever is in the slot, so one report would erase the other.
 *
 * `obsidian-dev-utils` 93 replaced the `isReusable` boolean this used to pass with
 * {@link PluginNoticeMode}; `Separate` is that boolean's `false` — it "never replaces, and is never
 * replaced by, a slot notice" — so the behavior above is unchanged.
 *
 * @param params - The parameters.
 */
export function showOperationCompletionNotice(params: ShowOperationCompletionNoticeParams): void {
  const { content, pluginNoticeComponent, pluginSettingsComponent } = params;
  if (!pluginSettingsComponent.settings.shouldShowOperationNotices) {
    return;
  }
  pluginNoticeComponent.showNotice(content, { mode: PluginNoticeMode.Separate });
}

/**
 * Shows a permanent progress notice for a batch operation whose steps are reported as one unit, unless the
 * user turned operation notices off. Unlike {@link showOperationProgressNotice} it appears immediately —
 * these operations are long by construction, so there is no fast case to avoid flashing.
 *
 * @param params - The parameters.
 * @returns The notice, or `null` when operation notices are off.
 */
export function showOperationPermanentProgressNotice(params: ShowOperationPermanentProgressNoticeParams): Notice | null {
  const { content, pluginNoticeComponent, pluginSettingsComponent } = params;
  if (!pluginSettingsComponent.settings.shouldShowOperationNotices) {
    return null;
  }
  return pluginNoticeComponent.showNotice(content, { isPermanent: true });
}

/**
 * Shows a progress notice once the operation has run long enough to be worth reporting, unless the user
 * turned operation notices off.
 *
 * @param params - The parameters.
 * @returns A handle whose disposal hides the notice, or `null` when operation notices are off — so callers
 * dispose it as `progressNotice?.[Symbol.dispose]()`.
 */
export function showOperationProgressNotice(params: ShowOperationProgressNoticeParams): null | PluginNoticeComponentDelayedNotice {
  const {
    abortController,
    app,
    content,
    pluginNoticeComponent,
    pluginSettingsComponent
  } = params;
  if (!pluginSettingsComponent.settings.shouldShowOperationNotices) {
    return null;
  }

  /*
   * The dialog answers the same contract as the delayed notice — `setContent` plus disposal — so every
   * call site shows whichever the user asked for without knowing which it got, and keeps disposing it
   * in its own `finally` exactly as before. That `finally` is what guarantees the vault is given back.
   */
  if (pluginSettingsComponent.settings.shouldBlockVaultDuringOperations) {
    return showOperationProgressModal({
      abortController: abortController ?? new AbortController(),
      app,
      content: () => resolveValue(content, {})
    });
  }

  return pluginNoticeComponent.showNoticeAfterDelay(normalizeOptionalProperties<PluginNoticeComponentShowNoticeAfterDelayParams>({ abortController, content }));
}

/**
 * Names the notes an operation created, as links, after everything else the notice says (issue #235).
 *
 * A batch split used to end at its source link, which is the note the user was already looking at — so the
 * notice reported a restructuring without offering a way into any of its output. The names are appended
 * rather than made the notice's subject because the source link is not wrong: a split leaves a residual
 * link to every note it produced in the note it split, so the source IS the index, and this list is the
 * shortcut past it.
 *
 * @param params - The parameters.
 */
async function appendCreatedNoteLinks(params: AppendCreatedNoteLinksParams): Promise<void> {
  const {
    app,
    createdPathsOrAbstractFiles,
    fragmentEl,
    pluginSettingsComponent
  } = params;

  /*
   * Deduped by path, and here rather than at the callers: two headings with the same text split into the
   * same note, so a batch split can legitimately hand the same destination in twice — and a notice naming
   * it twice reads as though the operation created two notes.
   */
  const uniquePaths = [
    ...new Set(
      createdPathsOrAbstractFiles.map((pathOrAbstractFile) => typeof pathOrAbstractFile === 'string' ? pathOrAbstractFile : pathOrAbstractFile.path)
    )
  ];
  if (uniquePaths.length === 0) {
    return;
  }

  fragmentEl.appendText(': ');
  const linkedPaths = uniquePaths.slice(0, MAX_LINKED_CREATED_NOTES);
  for (const [index, path] of linkedPaths.entries()) {
    if (index > 0) {
      fragmentEl.appendText(', ');
    }
    fragmentEl.append(await renderOperationNoticeLink({ app, pathOrAbstractFile: path, pluginSettingsComponent }));
  }

  const restCount = uniquePaths.length - linkedPaths.length;
  if (restCount > 0) {
    fragmentEl.appendText(` and ${String(restCount)} more`);
  }
}
