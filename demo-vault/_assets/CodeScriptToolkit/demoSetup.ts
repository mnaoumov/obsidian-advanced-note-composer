import type {
  App,
  Command,
  Editor,
  Hotkey,
  TAbstractFile,
  WorkspaceLeaf
} from 'obsidian';

// A vault has no `node_modules`: `CodeScript Toolkit` serves `@mnaoumov/obsidian-lib` and `@mnaoumov/typescript-lib`
// to vault scripts as built-in modules.
import {
  configureCommunityPlugin,
  disableCommunityPlugin,
  enableCommunityPlugin,
  installConfigureEnableCommunityPlugin
} from '@mnaoumov/obsidian-lib/community-plugins';
import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import {
  MarkdownView,
  Menu,
  Notice,
  TFile,
  TFolder
} from 'obsidian';

const PLUGIN_ID = 'advanced-note-composer';
const TEMPLATER_PLUGIN_ID = 'templater-obsidian';

interface DemoSettingsPatch {
  readonly defaultFrontmatterMergeStrategy?: string;
  readonly frontmatterTitleMode?: string;
  readonly mergeTemplate?: string;
  readonly newFolderContentTemplate?: string;
  readonly shouldAddInvalidTitleToNoteAlias?: boolean;
  readonly shouldAlwaysMergeExcludedItems?: boolean;
  readonly shouldJumpToMovedContentToBottom?: boolean;
  readonly shouldJumpToMovedContentToTop?: boolean;
  readonly shouldKeepHeadingsWhenSplittingContent?: boolean;
  readonly shouldLockAllNotesWhenMarkingSelection?: boolean;
  readonly shouldOpenFirstNoteAfterMergingFolder?: boolean;
  readonly shouldOpenNoteAfterMergingFolderIntoFile?: boolean;
  readonly shouldRunTemplaterOnDestinationFile?: boolean;
  readonly shouldSwapEntireFolderStructureByDefault?: boolean;
  readonly shouldTreatTitleAsPathByDefault?: boolean;
  readonly smartCutAndPasteTemplate?: string;
  readonly smartCutAndPasteToBottomTemplate?: string;
  readonly smartCutAndPasteToTopTemplate?: string;
  readonly splitTemplate?: string;
  readonly textAfterExtractionMode?: string;
}

interface RunCommandOptions {
  /**
   * The command to run. A bare id is this plugin's (`merge-file`); an id holding a `:` is used as it is.
   */
  readonly commandId: string;

  /**
   * Put the cursor right AFTER the first occurrence of this text.
   */
  readonly cursorAfter?: string;

  /**
   * Put the cursor right BEFORE the first occurrence of this text.
   */
  readonly cursorBefore?: string;

  /**
   * Put the cursor at the end of the first line that reads exactly this — a heading line, say, which
   * the walkthrough's own text may also quote.
   */
  readonly cursorOnLine?: string;

  /**
   * The note to run the command in. It is opened in editing mode — in the tab that already shows it, or
   * in a new tab, so the note the button lives in stays open. Omitted, the command runs where you are.
   */
  readonly notePath?: string;

  /**
   * Select the first occurrence of this text before running the command.
   */
  readonly selection?: string;

  /**
   * Go back to the tab the button was clicked in once the command has run, so the walkthrough's next
   * step is in front of you. Needed after a command that locks the note it ran in, such as marking a
   * selection to move: a locked note's tab cannot be pointed at another note until the lock is gone.
   */
  readonly shouldReturnToButton?: boolean;

  /**
   * Wait for an operation that runs with no dialog to finish — until no note is locked any more — so the
   * note it opens at the end is open before the button reports.
   */
  readonly shouldWaitUntilDone?: boolean;

  /**
   * Look for {@link selection}, {@link cursorBefore} or {@link cursorAfter} only from the first
   * occurrence of this text on, for a word the walkthrough's own instructions also mention.
   */
  readonly within?: string;
}

export async function bindHotkey(app: App, commandId: string, hotkey: Hotkey): Promise<void> {
  app.hotkeyManager.setHotkeys(commandId, [hotkey]);
  await app.hotkeyManager.save();
  app.hotkeyManager.bake();
  new Notice(`Bound hotkey to: ${commandId}`);
}

/**
 * Applies a settings patch, live.
 *
 * This used to write `data.json` behind the loaded plugin and then reload the window, which was wrong
 * twice over. It was a race the plugin wins — it saves its own in-memory settings as it unloads, over
 * the file just written — which is exactly the reasoning the `Templater` helper below already spelled
 * out for itself. And the reload took the whole window with it, so a reader lost their place and any
 * automated click-through lost the page it was driving.
 *
 * `configureCommunityPlugin` routes into the plugin's own save path while it is loaded, so the change
 * is live with no reload and no race.
 *
 * Manual equivalent: change the same option in **Settings -> Community plugins -> Advanced Note
 * Composer**.
 */
export async function changeSettings(app: App, patch: DemoSettingsPatch): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: patch });
}

/**
 * Opens a note, puts the cursor or the selection where a step says to, and runs a command there.
 *
 * Text is found outside code blocks only, so the button's own source — which names the very text it
 * looks for — is never what gets selected.
 *
 * Throws when the command is not available at that point, so a button that cannot do what it promises
 * reports an error instead of silently doing nothing.
 *
 * Manual equivalent: open the note, click or select where the step says, and run the command from the
 * command palette.
 */
export async function runCommand(app: App, options: RunCommandOptions): Promise<void> {
  const buttonLeaf = app.workspace.getMostRecentLeaf();
  await runCommandSetup(app, options);

  const fullCommandId = options.commandId.includes(':') ? options.commandId : `${PLUGIN_ID}:${options.commandId}`;
  if (!app.commands.executeCommandById(fullCommandId)) {
    const command = app.commands.findCommand(fullCommandId);
    const message = command
      ? `${command.name} is not available here.`
      : `There is no command ${fullCommandId}.`;
    new Notice(message);
    throw new Error(message);
  }

  if (options.shouldWaitUntilDone) {
    await waitUntilNoNoteIsLocked();
  }

  if (options.shouldReturnToButton && buttonLeaf) {
    app.workspace.setActiveLeaf(buttonLeaf, { focus: true });
  }
}

/**
 * Installs and enables `Templater`, then loads the multi-alias content template and reloads.
 *
 * The demo vault ships only the plugin under test and the helper, so the `Templater` section of
 * `29 Create folder with notes` has nothing to run against until this has been done. `Templater` is
 * installed through Obsidian's own store path rather than committed to the vault.
 */
export async function setUpTemplaterExample(app: App): Promise<void> {
  new Notice(createFragment((f) => {
    f.appendText('Installing ');
    appendCodeBlock(f, 'Templater');
    f.appendText('...');
  }));
  await installConfigureEnableCommunityPlugin({ app, pluginId: TEMPLATER_PLUGIN_ID });

  // Disabled first rather than patched in place: this one replaces a template the plugin reads at
  // load time, so nothing should hold stale settings while the file changes. Enabling again picks
  // them up with no window reload at all.
  await disableCommunityPlugin({ app, pluginId: PLUGIN_ID });
  await configureCommunityPlugin({
    app,
    pluginId: PLUGIN_ID,
    settings: {
      newFolderContentTemplate: [
        '{{file}} !.md',
        '---',
        'aliases: <% JSON.stringify(TOKENS.rawFolderName.split(\' - \')) %>',
        '---',
        '# <% TOKENS.folderName %>'
      ].join('\n'),
      shouldRunTemplaterOnDestinationFile: true
    }
  });
  await enableCommunityPlugin({ app, pluginId: PLUGIN_ID });
  new Notice(createFragment((f) => {
    appendCodeBlock(f, 'Templater');
    f.appendText(' is ready — the example template is loaded.');
  }));
}

const WAIT_STEP_IN_MILLISECONDS = 100;
const WAIT_LIMIT_IN_MILLISECONDS = 8000;
const OPEN_AFTER_OPERATION_SETTLE_IN_MILLISECONDS = 500;

interface ShowAvailableCommandsOptions {
  /**
   * The commands to ask about, as for {@link runCommand}.
   */
  readonly commandIds: string[];

  /**
   * The note to ask in, opened as for {@link runCommand}.
   */
  readonly notePath: string;

  /**
   * Text to select first, for commands that need a selection.
   */
  readonly selection?: string;
}

/**
 * Opens the settings window on this plugin's tab.
 *
 * Manual equivalent: open **Settings** and pick `Advanced Note Composer` under **Community plugins**.
 */
export function openPluginSettings(app: App): void {
  app.setting.open();
  app.setting.openTabById(PLUGIN_ID);
}

/**
 * Sets one of Obsidian's own editor settings, such as `readableLineLength`.
 *
 * Manual equivalent: change it under **Settings -> Editor**.
 */
export function setObsidianSetting(app: App, key: Parameters<App['vault']['setConfig']>[0], value: unknown): void {
  app.vault.setConfig(key, value);
  new Notice(`Set ${key} to ${String(value)}.`);
}

/**
 * Opens a note, optionally selects text in it, and says in a notice which of the given commands are
 * offered there — the question the command palette answers by listing them or not.
 *
 * Manual equivalent: open the note, select the text, and open the command palette (or right-click).
 */
export async function showAvailableCommands(app: App, options: ShowAvailableCommandsOptions): Promise<void> {
  await runCommandSetup(app, { commandId: '', notePath: options.notePath, ...options.selection !== undefined && { selection: options.selection } });
  const available: string[] = [];
  const unavailable: string[] = [];
  for (const commandId of options.commandIds) {
    const fullCommandId = commandId.includes(':') ? commandId : `${PLUGIN_ID}:${commandId}`;
    const command = app.commands.findCommand(fullCommandId);
    if (!command) {
      throw new Error(`There is no command ${fullCommandId}.`);
    }
    const pluginNamePrefix = `${app.plugins.manifests[PLUGIN_ID]?.name ?? ''}: `;
    const name = command.name.startsWith(pluginNamePrefix) ? command.name.slice(pluginNamePrefix.length) : command.name;
    (isCommandAvailable(app, command) ? available : unavailable).push(name);
  }
  new Notice(createFragment((f) => {
    f.appendText(`In ${options.notePath}:`);
    f.createEl('br');
    f.appendText(`Offered: ${available.join(', ') || 'none'}`);
    f.createEl('br');
    f.appendText(`Not offered: ${unavailable.join(', ') || 'none'}`);
  }), AVAILABLE_COMMANDS_NOTICE_DURATION_IN_MILLISECONDS);
}

/**
 * An operation shows a lock indicator on every note it holds, and gives the last one back when it
 * commits. Opening its result comes a moment after that, hence the settle.
 */
async function waitUntilNoNoteIsLocked(): Promise<void> {
  for (let waited = 0; waited < WAIT_LIMIT_IN_MILLISECONDS; waited += WAIT_STEP_IN_MILLISECONDS) {
    await sleep(WAIT_STEP_IN_MILLISECONDS);
    if (!activeDocument.querySelector('.obsidian-lib-lock-indicator')) {
      break;
    }
  }
  await sleep(OPEN_AFTER_OPERATION_SETTLE_IN_MILLISECONDS);
}

const AVAILABLE_COMMANDS_NOTICE_DURATION_IN_MILLISECONDS = 15_000;

function isCommandAvailable(app: App, command: Command): boolean {
  const activeEditor = app.workspace.activeEditor;
  if (command.editorCheckCallback) {
    return !!activeEditor?.editor && command.editorCheckCallback(true, activeEditor.editor, activeEditor) === true;
  }
  if (command.editorCallback) {
    return activeEditor?.editor !== undefined;
  }
  if (command.checkCallback) {
    return command.checkCallback(true) === true;
  }
  return true;
}

/**
 * The menu {@link showFileMenu} last showed, at most one, so the next call can hide it first.
 */
const shownMenus: Menu[] = [];
const MENU_X_FRACTION_WITHOUT_ANCHOR = 0.5;
const MENU_Y_FRACTION_WITHOUT_ANCHOR = 0.33;

/**
 * Shows the file explorer's own right-click menu for one file or folder, or for several files at once,
 * next to the button.
 *
 * It is the same menu right-clicking the item in the file explorer opens, built by raising the same
 * workspace event, so every command on it is the real one.
 *
 * Manual equivalent: right-click the item in the file explorer (Ctrl/Cmd-click to select several first).
 */
export function showFileMenu(app: App, paths: string[], anchorEl?: HTMLElement | null): void {
  const files = paths.map((path) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) {
      throw new Error(`${path} does not exist. Reset the demo to bring it back.`);
    }
    return file;
  });

  for (const previousMenu of shownMenus.splice(0)) {
    previousMenu.hide();
  }
  const menu = new Menu();
  const [firstFile] = files;
  if (files.length === 1 && firstFile) {
    app.workspace.trigger('file-menu', menu, firstFile, 'file-explorer-context-menu', null);
  } else {
    app.workspace.trigger('files-menu', menu, files, 'file-explorer-context-menu', null);
  }

  const rect = anchorEl?.getBoundingClientRect();
  menu.showAtPosition({
    x: rect ? rect.left : window.innerWidth * MENU_X_FRACTION_WITHOUT_ANCHOR,
    y: rect ? rect.bottom : window.innerHeight * MENU_Y_FRACTION_WITHOUT_ANCHOR
  });
  shownMenus.push(menu);
}

/**
 * The hidden folder `startup.ts` copies the vault's notes into on first launch, so a demo can be put
 * back the way it shipped. A dot-folder is invisible to Obsidian, so the copy never shows up in the file
 * explorer, in a search, or in a picker.
 */
const SNAPSHOT_FOLDER = '.demo-vault-snapshot';

/**
 * Puts notes and folders back the way the vault shipped.
 *
 * A path the vault shipped with is restored: a note gets its original content back, and a folder gets
 * its original notes back while anything a step added inside it is deleted. A path the vault did NOT
 * ship with — a note a step created — is deleted.
 *
 * Each folder in `createdInFolders` loses whatever a step created directly inside it: every item the
 * vault did not ship with, whatever it is called. That is how a reset finds notes a step named after
 * headings, or a folder tree a recursive split built.
 *
 * Manual equivalent: undo the step (`Ctrl+Z` in the note, or delete what it created), or download the
 * demo vault again.
 */
export async function resetDemo(app: App, paths: string[], createdInFolders: string[] = []): Promise<void> {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(SNAPSHOT_FOLDER)) {
    throw new Error('The demo vault has no snapshot to reset from yet. Reload the vault once and try again.');
  }

  for (const folderPath of createdInFolders) {
    const folder = folderPath === '' ? app.vault.getRoot() : app.vault.getFolderByPath(folderPath);
    // eslint-disable-next-line unicorn/no-useless-spread -- A copy: deleting a child removes it from `children` mid-loop.
    for (const child of [...folder?.children ?? []]) {
      if (isSnapshotted(child.path) && !await adapter.exists(`${SNAPSHOT_FOLDER}/${child.path}`)) {
        await deleteIfExists(app, child);
      }
    }
  }

  for (const path of paths) {
    const snapshotPath = `${SNAPSHOT_FOLDER}/${path}`;
    const stat = await adapter.stat(snapshotPath);
    if (stat?.type === 'folder') {
      await restoreFolder(app, path);
    } else if (stat?.type === 'file') {
      await restoreFile(app, path);
    } else {
      await deleteIfExists(app, app.vault.getAbstractFileByPath(path));
    }
  }

  new Notice('The demo is back the way it shipped.');
}

/**
 * Puts every note of the vault back the way it shipped: every shipped note restored, and every note a
 * demo created deleted. Settings are left as they are — each demo's own reset button puts back the ones
 * it changed.
 */
export async function resetWholeDemoVault(app: App): Promise<void> {
  const topLevelPaths = app.vault.getRoot().children
    .map((child) => child.path)
    .filter((path) => isSnapshotted(path));
  const adapter = app.vault.adapter;
  if (await adapter.exists(SNAPSHOT_FOLDER)) {
    const listed = await adapter.list(SNAPSHOT_FOLDER);
    for (const path of [...listed.files, ...listed.folders]) {
      const vaultPath = path.slice(SNAPSHOT_FOLDER.length + 1);
      if (!topLevelPaths.includes(vaultPath)) {
        topLevelPaths.push(vaultPath);
      }
    }
  }

  await resetDemo(app, topLevelPaths);
}

/**
 * Copies every note and fixture of the vault into {@link SNAPSHOT_FOLDER}, once — a later launch keeps
 * the first copy, which is the vault as it shipped.
 */
export async function snapshotVault(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  if (await adapter.exists(SNAPSHOT_FOLDER)) {
    return;
  }

  await adapter.mkdir(SNAPSHOT_FOLDER);
  for (const file of app.vault.getFiles()) {
    if (!isSnapshotted(file.path)) {
      continue;
    }

    await ensureAdapterFolder(app, parentPath(`${SNAPSHOT_FOLDER}/${file.path}`));
    await adapter.writeBinary(`${SNAPSHOT_FOLDER}/${file.path}`, await app.vault.readBinary(file));
  }
}

async function deleteIfExists(app: App, file: null | TAbstractFile): Promise<void> {
  if (file) {
    await app.fileManager.trashFile(file);
  }
}

async function ensureAdapterFolder(app: App, path: string): Promise<void> {
  if (path === '' || await app.vault.adapter.exists(path)) {
    return;
  }

  await ensureAdapterFolder(app, parentPath(path));
  await app.vault.adapter.mkdir(path);
}

async function ensureVaultFolder(app: App, path: string): Promise<void> {
  if (path === '' || app.vault.getFolderByPath(path)) {
    return;
  }
  await ensureVaultFolder(app, parentPath(path));
  await app.vault.createFolder(path);
}

function findTextOffset(view: MarkdownView, text: string, within?: string): number {
  const content = view.editor.getValue();
  const codeRanges = listCodeFenceRanges(content);
  let offset = content.indexOf(text, within === undefined ? 0 : findTextOffset(view, within));
  while (offset !== -1) {
    const candidate = offset;
    if (codeRanges.every(([start, end]) => !(start <= candidate && candidate < end))) {
      return offset;
    }
    offset = content.indexOf(text, offset + 1);
  }
  throw new Error(`Could not find "${text}" in ${view.file?.path ?? 'the note'}. Reset the demo to bring it back.`);
}

function isSnapshotted(path: string): boolean {
  const [topLevel = ''] = path.split('/', 1);
  return !topLevel.startsWith('.') && !topLevel.startsWith('_');
}

function listCodeFenceRanges(content: string): [number, number][] {
  const ranges: [number, number][] = [];
  let fenceStart = -1;
  let fenceMarker = '';
  let offset = 0;
  for (const line of content.split('\n')) {
    const marker = /^\s*(?<marker>`{3,}|~{3,})/.exec(line)?.groups?.['marker'] ?? '';
    if (fenceStart === -1 && marker !== '') {
      fenceStart = offset;
      fenceMarker = marker;
    } else if (fenceStart !== -1 && marker.startsWith(fenceMarker) && line.trim() === marker) {
      ranges.push([fenceStart, offset + line.length]);
      fenceStart = -1;
    }
    offset += line.length + 1;
  }
  if (fenceStart !== -1) {
    ranges.push([fenceStart, content.length]);
  }
  return ranges;
}

async function openInEditingMode(app: App, path: string): Promise<WorkspaceLeaf> {
  const file = app.vault.getFileByPath(path);
  if (!file) {
    throw new Error(`${path} does not exist. Reset the demo to bring it back.`);
  }

  const leaf = app.workspace.getLeavesOfType('markdown').find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === path)
    ?? app.workspace.getLeaf('tab');
  await leaf.setViewState({ active: true, state: { file: path, mode: 'source', source: false }, type: 'markdown' });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function placeCursor(view: MarkdownView, options: RunCommandOptions): void {
  const editor: Editor = view.editor;
  if (options.selection !== undefined) {
    const start = findTextOffset(view, options.selection, options.within);
    const from = editor.offsetToPos(start);
    const to = editor.offsetToPos(start + options.selection.length);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  } else if (options.cursorOnLine !== undefined) {
    const line = editor.getValue().split('\n').indexOf(options.cursorOnLine);
    if (line === -1) {
      throw new Error(`Could not find the line "${options.cursorOnLine}" in ${view.file?.path ?? 'the note'}. Reset the demo to bring it back.`);
    }
    const position = { ch: options.cursorOnLine.length, line };
    editor.setCursor(position);
    editor.scrollIntoView({ from: position, to: position }, true);
  } else if (options.cursorBefore !== undefined || options.cursorAfter !== undefined) {
    const offset = options.cursorBefore === undefined
      ? findTextOffset(view, options.cursorAfter ?? '', options.within) + (options.cursorAfter ?? '').length
      : findTextOffset(view, options.cursorBefore, options.within);
    const position = editor.offsetToPos(offset);
    editor.setCursor(position);
    editor.scrollIntoView({ from: position, to: position }, true);
  }
  editor.focus();
}

async function restoreFile(app: App, path: string): Promise<void> {
  const snapshotPath = `${SNAPSHOT_FOLDER}/${path}`;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) {
    await deleteIfExists(app, existing);
  }

  const file = app.vault.getFileByPath(path);
  if (path.endsWith('.md')) {
    const content = await app.vault.adapter.read(snapshotPath);
    if (!file) {
      await ensureVaultFolder(app, parentPath(path));
      await app.vault.create(path, content);
    } else if (await app.vault.read(file) !== content) {
      await app.vault.modify(file, content);
    }
    return;
  }

  const data = await app.vault.adapter.readBinary(snapshotPath);
  if (file) {
    await app.vault.modifyBinary(file, data);
  } else {
    await ensureVaultFolder(app, parentPath(path));
    await app.vault.createBinary(path, data);
  }
}

async function restoreFolder(app: App, path: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await deleteIfExists(app, existing);
  }
  await ensureVaultFolder(app, path);

  const listed = await app.vault.adapter.list(`${SNAPSHOT_FOLDER}/${path}`);
  const shippedChildren = new Set([...listed.files, ...listed.folders].map((childPath) => childPath.slice(SNAPSHOT_FOLDER.length + 1)));
  const folder = app.vault.getFolderByPath(path);
  // eslint-disable-next-line unicorn/no-useless-spread -- A copy: deleting a child removes it from `children` mid-loop.
  for (const child of [...folder?.children ?? []]) {
    if (!shippedChildren.has(child.path)) {
      await deleteIfExists(app, child);
    }
  }

  for (const filePath of listed.files) {
    await restoreFile(app, filePath.slice(SNAPSHOT_FOLDER.length + 1));
  }
  for (const folderPath of listed.folders) {
    await restoreFolder(app, folderPath.slice(SNAPSHOT_FOLDER.length + 1));
  }
}

async function runCommandSetup(app: App, options: RunCommandOptions): Promise<void> {
  if (options.notePath === undefined) {
    return;
  }
  const leaf = await openInEditingMode(app, options.notePath);
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) {
    throw new TypeError(`${options.notePath} did not open as a note.`);
  }
  placeCursor(view, options);
}
