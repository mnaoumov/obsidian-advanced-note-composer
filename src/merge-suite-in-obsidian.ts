/**
 * @file
 *
 * The in-Obsidian helpers the folder-merge integration suites share — and the record of WHY those suites
 * are split into several short `evalInObsidian` calls instead of the one closure they used to be.
 *
 * `evalInObsidian` ships the WHOLE callback as ONE CDP `Runtime.evaluate` with `awaitPromise: true`, and the
 * transport rejects any single command once `commandTimeoutInMilliseconds` elapses — **30 000 ms** by
 * default (`obsidian-integration-testing`'s `connect-to-cdp.ts`), which nothing in this repo can raise: the
 * transport is built by the `obsidian-dev-utils` global setup, with no option threaded through. A closure
 * that runs longer dies as `CDP command timed out after 30000ms: Runtime.evaluate` and the transport
 * DISCARDS everything it had gathered — no assertion, no message, nothing to read. So an in-page `waitUntil`
 * budget above 30 s is unreachable by construction, whatever vitest's own test timeout says.
 *
 * That is what made `merge-folder-no-active-leaf-cycling` flake in the aggregate (T446): a folder merge of a
 * dozen cross-linked notes is slow enough under load to blow the cap on its own, so the suite failed with a
 * transport error rather than with anything about merging. Measured 2026-08-13, deterministically, not
 * inferred: a closure holding `await sleep(35_000)` fails with exactly that error, while the same wait
 * expressed as a `pollInObsidian` start + poll completes.
 *
 * Hence the shape every suite here follows: each long phase is driven from NODE via `pollInObsidian` — each
 * poll being its own sub-second eval — and the state that has to survive BETWEEN evals (the
 * `active-leaf-change` recording, its `EventRef`, the settings to restore afterwards) lives in a
 * `ContextId`, which is a persistent object on `window` in the Obsidian process. The 90 s operation budget
 * moves to `pollInObsidian`'s Node-side `timeoutInMilliseconds`, where it is finally enforceable, and a
 * stall now fails with the phase's own message instead of the transport's.
 *
 * The helpers below are what those split closures would otherwise each re-declare. Exactly like
 * `settings-tab-navigation.ts` they must stay SELF-CONTAINED — they are serialized with `toString()` and
 * handed in through `evalInObsidian`'s `input`, so an import or a module-scope constant referenced from a
 * body would throw a `ReferenceError` in the renderer.
 *
 * Four of them are plugin-agnostic — `trashIfExistsInObsidian`, `startActivationRecorderInObsidian`,
 * `startNoticeRecorderInObsidian` and `captureStallDiagnosticsInObsidian` say nothing about this plugin —
 * so they belong in `obsidian-integration-testing`'s injected `lib` bag eventually (G52/G61). They are local for now for the
 * same reason `natural-sort.ts` is: extracting them is a cross-repo change (G55) that would have blocked
 * the fix they were written for.
 */

import type {
  App,
  EventRef,
  TFolder
} from 'obsidian';
import type { Lib } from 'obsidian-integration-testing';

/**
 * Params for {@link captureStallDiagnosticsInObsidian}.
 */
export interface CaptureStallDiagnosticsInObsidianParams {
  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * The real `TFolder` class (`obsidianModule.TFolder`), so a folder can be told from a file: a serialized
   * closure cannot import it.
   */
  readonly folderClass: typeof TFolder;

  /**
   * The vault-relative paths the suite is waiting on, reported as "missing", "file" or the folder's own
   * children.
   */
  readonly paths: string[];
}

/**
 * Params for {@link chooseFolderInPickerInObsidian}.
 */
export interface ChooseFolderInPickerInObsidianParams {
  /**
   * The vault-relative folder path to type into the picker.
   */
  readonly folderPath: string;

  /**
   * The harness' own poll helper, taken from the closure's `lib`.
   */
  readonly waitUntil: Lib['waitUntil'];
}

/**
 * Params for {@link findSettingsComponentInObsidian}.
 */
export interface FindSettingsComponentInObsidianParams {
  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * The plugin whose component tree is walked.
   */
  readonly pluginId: string;

  /**
   * The name of a BOOLEAN setting the sought component is known to carry, which is what tells it apart from
   * the plugin's other components.
   */
  readonly probeSettingName: string;
}

/**
 * A notice as it appeared, together with when it appeared. The timestamp is what makes the log more than a
 * list: a notice logged 200 ms after the merge started and one logged at 89 s are different stories.
 */
export interface NoticeLogEntryInObsidian {
  /**
   * Milliseconds since the recorder was installed.
   */
  readonly atMilliseconds: number;

  /**
   * The notice's text, truncated.
   */
  readonly text: string;
}

/**
 * The part of the plugin's settings component these suites drive.
 */
export interface SettingsCarrier<Settings extends object> {
  /**
   * Mutates the settings through the plugin's own save path.
   *
   * @param editor - Receives the live settings to mutate.
   * @returns A {@link Promise} that resolves once they are saved.
   */
  editAndSave(editor: (settings: Settings) => void): Promise<void>;

  /**
   * The live settings.
   */
  settings: Settings;
}

/**
 * Params for {@link startActivationRecorderInObsidian}.
 */
export interface StartActivationRecorderInObsidianParams {
  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * What to record when a leaf change carries no file at all — the leaf being emptied rather than pointed at
   * another note. A value rather than `null`, so the recording reads as an ordered log.
   */
  readonly noFile: string;

  /**
   * The array to append to. It lives in the suite's `ContextId`, so it survives between evals.
   */
  readonly recording: string[];
}

/**
 * Params for {@link startNoticeRecorderInObsidian}.
 */
export interface StartNoticeRecorderInObsidianParams {
  /**
   * The log to append to. It lives in the suite's `ContextId`, so it survives between evals.
   */
  readonly noticeLog: NoticeLogEntryInObsidian[];
}

/**
 * Params for {@link trashIfExistsInObsidian}.
 */
export interface TrashIfExistsInObsidianParams {
  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * The vault-relative path to trash when it exists.
   */
  readonly path: string;
}

/* v8 ignore start -- Serialized via toString() and executed inside Obsidian, not callable in unit tests. */

/**
 * Reads back what the app looks like at the moment a suite gave up waiting.
 *
 * A stalled merge otherwise reports only that it did not finish, and the aggregate is where these stalls
 * live - so the ONE run that reproduces has to carry its own evidence or it is spent. What is captured is
 * what has actually explained a stall here before: a modal nobody dismissed (the aggregate shares one
 * Obsidian, so a suite that leaves one blocks every suite after it), a still-visible progress notice (the
 * operation is mid-flight rather than dead), a lock indicator, and which of the awaited paths exist.
 *
 * Notices are read from `activeDocument` rather than `document`: in a serialized closure the latter is
 * reliably empty of them.
 *
 * @param params - The params.
 * @returns A JSON-serializable snapshot.
 */
export function captureStallDiagnosticsInObsidian(params: CaptureStallDiagnosticsInObsidianParams): Record<string, unknown> {
  const { app, folderClass, paths } = params;
  const TEXT_LIMIT = 200;

  const pathStates: Record<string, string> = {};
  for (const path of paths) {
    const abstractFile = app.vault.getAbstractFileByPath(path);
    if (!abstractFile) {
      pathStates[path] = 'missing';
      continue;
    }

    pathStates[path] = abstractFile instanceof folderClass
      ? `folder: ${abstractFile.children.map((child) => child.name).join(', ')}`
      : 'file';
  }

  return {
    activePath: app.workspace.getActiveFile()?.path ?? null,
    lockIndicatorCount: activeDocument.querySelectorAll('.obsidian-dev-utils-lock-indicator').length,
    modals: [...activeDocument.querySelectorAll('.modal')].map((el) => el.textContent.slice(0, TEXT_LIMIT)),
    notices: [...activeDocument.querySelectorAll('.notice')].map((el) => el.textContent.slice(0, TEXT_LIMIT)),
    pathStates
  };
}

/**
 * Types a folder path into the open merge/move folder picker and accepts the matching suggestion.
 *
 * @param params - The params.
 * @returns A {@link Promise} that resolves once the suggestion has been accepted.
 */
export async function chooseFolderInPickerInObsidian(params: ChooseFolderInPickerInObsidianParams): Promise<void> {
  const { folderPath, waitUntil } = params;
  const input = document.querySelector('.prompt-input');
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError('No folder picker input.');
  }

  input.value = folderPath;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitUntil({
    message: `no suggestion for ${folderPath}`,
    predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(folderPath))
  });
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
}

/**
 * Finds the plugin's settings component by walking its component tree, so a suite can flip a setting through
 * the plugin's own save path instead of through the settings tab.
 *
 * @param params - The params.
 * @returns The component.
 */
export function findSettingsComponentInObsidian<Settings extends object>(params: FindSettingsComponentInObsidianParams): SettingsCarrier<Settings> {
  const { app, pluginId, probeSettingName } = params;

  interface ComponentTreeNode {
    _children?: ComponentTreeNode[];
    editAndSave?: unknown;
    settings?: Record<string, unknown>;
  }

  const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
  const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (typeof node.editAndSave === 'function' && typeof node.settings?.[probeSettingName] === 'boolean') {
      // eslint-disable-next-line no-restricted-syntax -- Approved double cast: the tree is walked as an untyped shape, and the probe above IS the narrowing.
      return node as unknown as SettingsCarrier<Settings>;
    }

    if (node._children) {
      queue.push(...node._children);
    }
  }

  throw new Error('Settings component was not found.');
}

/**
 * Records EVERY active-leaf change into the given array — not only the interesting ones: when a suite's
 * assertion fails it is the recorded ORDER that names the cause, and filtering here would throw that away.
 * Each suite filters the recording in Node, where the failure message can show what was actually recorded.
 *
 * @param params - The params.
 * @returns The event reference, to be stashed in the suite's context and `offref`-ed on cleanup.
 */
export function startActivationRecorderInObsidian(params: StartActivationRecorderInObsidianParams): EventRef {
  const { app, noFile, recording } = params;
  return app.workspace.on('active-leaf-change', () => {
    recording.push(app.workspace.getActiveFile()?.path ?? noFile);
  });
}

/**
 * Records EVERY notice as it APPEARS, rather than reading the ones still standing when a suite gives up.
 *
 * A notice auto-hides after ~5 s, so by the time a 90 s wait times out the notice that explains the stall —
 * an error notice from an aborted merge, a progress notice that came and went — is long gone from the DOM.
 * A snapshot taken at the timeout can only ever see a notice that is still up; this sees the ones that
 * mattered a minute earlier, in order, with their timings.
 *
 * Observed on `activeDocument.body` rather than `document`: in a serialized closure the latter is reliably
 * empty of notices.
 *
 * @param params - The params.
 * @returns The observer, to be stashed in the suite's context and disconnected on cleanup.
 */
export function startNoticeRecorderInObsidian(params: StartNoticeRecorderInObsidianParams): MutationObserver {
  const { noticeLog } = params;
  const TEXT_LIMIT = 200;
  const ELEMENT_NODE_TYPE = 1;
  const startedAtMilliseconds = Date.now();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const addedNode of mutation.addedNodes) {
        // The notice container itself is added on the first notice, so a subtree query is needed as well as
        // The node's own match - otherwise the very first notice of a run is the one that goes unrecorded.
        if (addedNode.nodeType !== ELEMENT_NODE_TYPE) {
          continue;
        }

        const addedElement = addedNode as Element;
        const notices = addedElement.matches('.notice') ? [addedElement] : [...addedElement.querySelectorAll('.notice')];
        for (const notice of notices) {
          noticeLog.push({ atMilliseconds: Date.now() - startedAtMilliseconds, text: notice.textContent.slice(0, TEXT_LIMIT) });
        }
      }
    }
  });
  observer.observe(activeDocument.body, { childList: true, subtree: true });
  return observer;
}

/**
 * Trashes a file or folder when it is there, so a suite can start from a clean slate in the temp vault the
 * whole aggregate shares.
 *
 * @param params - The params.
 * @returns A {@link Promise} that resolves once it is gone.
 */
export async function trashIfExistsInObsidian(params: TrashIfExistsInObsidianParams): Promise<void> {
  const { app, path } = params;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) {
    await app.fileManager.trashFile(existing);
  }
}

/* v8 ignore stop */
