import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
import { PathSettings } from 'obsidian-dev-utils/obsidian/path-settings';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import {
  COMMAND_CATEGORIES,
  CommandCategory
} from './command-category.ts';

export {
  COMMAND_CATEGORIES,
  CommandCategory
} from './command-category.ts';

export enum Action {
  Merge = 'Merge',
  Split = 'Split'
}

/**
 * Which of the two context menus over a markdown editor a category's commands appear in (issue #252).
 *
 * Obsidian raises TWO menus there, and they are mutually exclusive by position:
 * - the **editor menu**, from a right-click on the text, is `workspace.on('editor-menu')`;
 * - the **viewport menu**, from a right-click on the empty margin `Readable line length` leaves beside the
 *   text (or on the line-number gutter), is `workspace.on('markdown-viewport-menu')` — the small
 *   `Readable line length` / `Line numbers` / `Inline title` menu.
 *
 * The editor menu's own handler bails when the click lands outside the editor's `contentDOM`, and readable
 * line length puts the margin outside it, so the two never both fire for one click. The reporter of #252
 * wanted the recursive splits demoted to the margin — "allows user to only see the recursive split when
 * they right click the empty space" — because this plugin puts nine items in the editor menu.
 *
 * {@link EditorMenu} is what the plugin has always done and stays the default, so nothing changes for
 * anyone who has not asked.
 */
export enum CommandMenuPlacement {
  /**
   * Both menus offer the category's commands.
   */
  Both = 'Both',

  /**
   * Only the editor menu — a right-click on the text. Today's behavior, and the default.
   */
  EditorMenu = 'EditorMenu',

  /**
   * Neither menu. The commands stay in the command palette and on their hotkeys, which is what separates
   * this from the `Command include/exclude paths` filter — that one hides them everywhere.
   */
  Neither = 'Neither',

  /**
   * Only the viewport menu — a right-click on the readable-line-length margin or the line-number gutter.
   */
  ViewportMenu = 'ViewportMenu'
}

/**
 * Every {@link CommandMenuPlacement}, for validating one read back out of `data.json`.
 *
 * Spelled out for the same reason {@link COMMAND_CATEGORIES} is, and pinned against the enum by the same
 * kind of unit test — a member added to the enum and left out of here would quietly become the one
 * placement the validator rejects.
 */
export const COMMAND_MENU_PLACEMENTS: readonly CommandMenuPlacement[] = [
  CommandMenuPlacement.Both,
  CommandMenuPlacement.EditorMenu,
  CommandMenuPlacement.Neither,
  CommandMenuPlacement.ViewportMenu
];

/**
 * What a folder merge does with the folders it empties. A plugin-local **wrapper** around the
 * `obsidian-dev-utils` `EmptyFolderBehavior`, not that enum itself, because of the fourth member: keeping the
 * merged folder while deleting the folders under it (issue #167) is a change to WHICH paths are offered to
 * `cleanupEmptyFolders`, not a new per-path behavior, so it cannot be expressed as a dev-utils value. The
 * three original members deliberately reuse `EmptyFolderBehavior`'s exact string values, so every
 * already-persisted setting stays valid and no legacy-settings converter is needed. Do not "simplify" this
 * back to the dev-utils enum.
 */
export enum EmptyFolderBehaviorAfterMergingFolder {
  Delete = 'Delete',
  DeleteSubFoldersOnly = 'DeleteSubFoldersOnly',
  DeleteWithEmptyParents = 'DeleteWithEmptyParents',
  Keep = 'Keep'
}

/**
 * What a flatten promotes out of the chosen folder.
 *
 * `AllChildren` is the original behavior. The two folder-only members answer issues #170 and #171:
 * promote the folder's sub-folders while the folder itself keeps its own files (and its attachment
 * folder), either one level down (`ChildFoldersOnly`) or at any depth (`AllFoldersRecursively`).
 *
 * The two axes a flatten could have — WHAT moves and HOW DEEP it looks — are deliberately collapsed into
 * three cells rather than a scope enum plus a "recursive" toggle: the only combination anyone asked for
 * is folders-at-any-depth, and a recursive variant of `AllChildren` (dissolving every descendant file into
 * the parent) is a different operation nobody requested. The enum is the extension point if they do.
 *
 * **No longer a setting** (issue #177): each member is registered as its own folder-menu command, so the
 * variant is chosen when the command is invoked instead of being pre-committed in the settings tab. The
 * `Flatten mode` dropdown that used to select it is gone, and a `flattenMode` key left in an existing
 * `data.json` is simply ignored — nothing to migrate, because there is no longer a setting to migrate to.
 */
export enum FlattenMode {
  AllChildren = 'AllChildren',
  AllFoldersRecursively = 'AllFoldersRecursively',
  ChildFoldersOnly = 'ChildFoldersOnly'
}

export enum FrontmatterMergeStrategy {
  KeepOriginalFrontmatter = 'KeepOriginalFrontmatter',
  MergeAndPreferNewValues = 'MergeAndPreferNewValues',
  MergeAndPreferOriginalValues = 'MergeAndPreferOriginalValues',
  PreserveBothOriginalAndNewFrontmatter = 'PreserveBothOriginalAndNewFrontmatter',
  ReplaceWithNewFrontmatter = 'ReplaceWithNewFrontmatter'
}

export enum FrontmatterTitleMode {
  None = 'None',
  UseAlways = 'UseAlways',
  UseForInvalidTitleOnly = 'UseForInvalidTitleOnly'
}

/**
 * Where `Merge folder contents into a single file...` creates the merged note (issue #178).
 *
 * The report is ambiguous — it says the file "is moved to default folder right away" AND asks to be able
 * to "keep this new file in the parent folder", which is what already happens. `resolveTargetPath` creates
 * the note beside the folder with `vault.create`; nothing is ever moved, and Obsidian's
 * `Default location for new notes` is not consulted at any point. Rather than guess which of the two
 * readings was meant, all three positions are offered — the dropdown costs little more than either one
 * alone, and `BesideFolder` keeps today's behavior as the default.
 */
export enum MergeFolderIntoFileLocation {
  /**
  Today's behavior, and the default: beside the merged folder, in the folder's own parent.
  */
  BesideFolder = 'BesideFolder',

  /**
  Obsidian's own `Default location for new notes`, resolved through `fileManager.getNewFileParent`.
  */
  DefaultNewNoteLocation = 'DefaultNewNoteLocation',

  /**
  Inside the merged folder itself.
  */
  InsideFolder = 'InsideFolder'
}

/**
 * Which recency a picker offers first when there is no query (issue #248).
 *
 * The plugin tracks two, and they disagree exactly when it matters. Issue #206 asked that a folder
 * used as a destination be "always the top one on the list" for the operations that follow, so
 * recorded targets were put ahead of even the active file. Issue #248 — the same reporter — then found
 * that clicking into another note no longer moves that note's folder to the top, because the previous
 * operation's target still outranks it.
 *
 * Both are reasonable, and neither is a bug, so the ordering is a choice rather than a fix.
 * {@link RecentTargetsFirst} is what the plugin has always done and stays the default, so nothing
 * changes for anyone who has not asked.
 */
export enum PickerRecencyOrder {
  /**
   * The folder you are currently in comes first, then the destinations of completed operations. Pick
   * this if you navigate to where you want things to go.
   */
  ActiveFileFirst = 'ActiveFileFirst',

  /**
   * The destinations of completed operations come first, then the folder you are currently in. Pick
   * this if you run several operations into the same folder without navigating there.
   */
  RecentTargetsFirst = 'RecentTargetsFirst'
}

/**
 * How a finished smart cut & paste move announces itself in the target note (issue #176).
 *
 * Selecting the moved text is the original behavior and stays the default, so nothing changes for an
 * existing vault and no `registerLegacySettingsConverter` is needed — a `data.json` without the key
 * simply gets {@link SmartCutAndPasteCompletionFeedback.SelectMovedContent}.
 *
 * The reason the other two exist: a selection in the target looks exactly like the plugin's own
 * marked-selection highlight in the source, so "this text is still marked, waiting to be moved" and
 * "the move finished, here is where it landed" are indistinguishable — most confusingly while the notes
 * are locked. {@link SmartCutAndPasteCompletionFeedback.Notice} therefore still moves the cursor onto
 * the moved text (leaving text at the cursor and the cursor elsewhere is incoherent — the same
 * reasoning that makes the at-cursor move always jump) but leaves it collapsed, and says so in a
 * notice instead of by highlighting.
 *
 * All three are gated by the same jump settings: with the move's jump turned off, nothing happens at
 * all — no cursor move, no notice.
 */
export enum SmartCutAndPasteCompletionFeedback {
  Notice = 'Notice',
  SelectMovedContent = 'SelectMovedContent',
  SelectMovedContentAndNotice = 'SelectMovedContentAndNotice'
}

/**
 * Which smart cut & paste move a split is: the move at the cursor (`Move marked selection here`, plain or
 * advanced, including the `Move marked selection at cursor` notice button), or a move to the top/bottom of
 * the target note. Supplied by the command handler — only it knows which move this is — and its presence on
 * a `SplitComposer` is what marks the split as a smart cut & paste move at all (issue #174).
 *
 * `AtCursor` deliberately has NO template setting of its own: `smartCutAndPasteTemplate` IS its template,
 * and simultaneously the fallback for the other two. That asymmetry is what keeps the per-direction
 * overrides migration-free — see {@link PluginSettings.smartCutAndPasteToTopTemplate}.
 */
export enum SmartCutAndPasteMoveKind {
  AtCursor = 'AtCursor',
  ToBottom = 'ToBottom',
  ToTop = 'ToTop'
}

/**
 * What the split/extract picker does with the target it resolves (issue #227): create a brand-new note, or
 * merge the extracted content into an existing one.
 *
 * Both halves already existed — `SplitItemSelector` created a note when the input named nothing (or `Mod`
 * was held) and merged into the picked file otherwise — but nothing on screen said which was about to
 * happen. The mode makes that fork EXPLICIT: it drives the picker's switch, which suggestions are offered,
 * and which branch the selector takes.
 */
export enum SplitTargetMode {
  Create = 'Create',
  Merge = 'Merge'
}

export enum TextAfterExtractionMode {
  EmbedNewFile = 'embed',
  LinkToNewFile = 'link',
  None = 'none'
}

/**
 * The name of one of the per-category command path settings (issue #249) — the eighteen accessors
 * {@link COMMAND_CATEGORIES} implies, two per category.
 *
 * Derived from {@link PluginSettings} rather than spelled out, so the settings tab and the tests that
 * drive them by name fail to type-check when one is renamed. The un-prefixed {@link
 * PluginSettings.commandIncludePaths} / {@link PluginSettings.commandExcludePaths} deliberately do NOT
 * match: their `command` is lower-case, because they are the baseline over every category rather than one
 * category's own list.
 */
export type CommandCategoryPathsSettingName = Extract<keyof PluginSettings, `${string}Command${'Exclude' | 'Include'}Paths`>;

export class PluginSettings {
  /**
   * Extensions that make a file an attachment rather than a note, matched against the file's whole name
   * by `obsidian-dev-utils` `isTreatedAsAttachment` — so a multi-part extension like `.excalidraw.md` is
   * written out in full. Such a file is never merged — inlining an Excalidraw drawing's raw payload into
   * a note is never what the user wanted (issue #160). It is moved like any other attachment instead: by
   * the folder merges (into a single file, or into another folder) and by the file merge that owns it
   * (issue #161).
   */
  public attachmentExtensions: string[] = ['.excalidraw.md'];

  /**
   * Which menus each COMMAND appears in (issue #252, per-command since issue #254).
   *
   * Keyed by command id. It stayed a `Map` through the widening — the key is now a plain `string` because
   * a command id is one, and `menu-placeable-commands.ts` is what constrains which strings are meaningful.
   *
   * Deliberately NOT pre-seeded from that table, unlike the category map it replaces: importing the table
   * here would close a cycle (it names {@link CommandCategory}, which lives in this module), and an absent
   * key already means the default — so `data.json` also stays free of thirty entries nobody chose.
   *
   * The categories were the old key (issue #252). They lost that job entirely: `Split/extract` alone holds
   * fifteen commands, and the reporter of #254 could not demote the recursive splits to the margin without
   * taking every extract with them.
   *
   * Public because both writers are outside this class — the settings tab's per-command toggles, and the
   * legacy converter that expands the six retired per-category keys into it. Read it through
   * {@link commandMenuPlacement}, which is where an absent or hand-edited value is answered.
   */
  public commandMenuPlacements = new Map<string, CommandMenuPlacement>();

  public defaultFrontmatterMergeStrategy = FrontmatterMergeStrategy.MergeAndPreferNewValues;

  /**
   * Which mode the split/extract picker opens in (issue #227). The switch above the picker's input flips it
   * per invocation; this is only where it starts — unless {@link shouldShowModalInstructions} hides that
   * switch (issue #242), in which case this decides the mode outright.
   *
   * Defaults to {@link SplitTargetMode.Create}, which is the common extract-to-a-new-note case and what the
   * picker did before the switch existed whenever the typed name matched nothing. No
   * `registerLegacySettingsConverter` is needed: the key is new, and an absent key already resolves to
   * `Create`.
   *
   * This value is REWRITTEN by the picker each time the
   * user chooses a target in a mode they could see and flip (issue #245), so it reads as "where the picker
   * opens" rather than "what I set once".
   */
  public defaultSplitTargetMode = SplitTargetMode.Create;

  /**
   * What happens to the folders a folder merge empties. Defaults to deleting them: once every note is
   * merged away, the folder tree left behind is litter (issue #160). `DeleteSubFoldersOnly` is the
   * in-between option (issue #167) for a folder whose own name matters but whose children's do not.
   */
  public emptyFolderBehaviorAfterMergingFolder = EmptyFolderBehaviorAfterMergingFolder.Delete;

  /**
   * The notes `Create folder with notes...` puts inside the folder it creates (issue #191).
   *
   * A line whose first non-whitespace is `{{file}}` starts a new note and names it with the rest of that
   * line; everything up to the next marker is that note's content. The default is EMPTY, which declares no
   * marker and therefore means one empty note named after the folder — issue #191's literal ask, with the
   * multi-note machinery costing nothing until someone writes a marker.
   *
   * The marker is a bare `{{file}}` with the name after it rather than a `{{file:NAME}}` parameter, because
   * a name may itself contain tokens (`{{file}} {{safeFolderName}}.md`) and `TEMPLATE_TOKEN_REG_EXP`
   * is lazy — it would stop at the inner `}}`. Nothing nests, so the token grammar is untouched.
   */
  /**
   * The alias a rename writes into the renamed FOLDER's folder note (issue #217).
   *
   * `{{safeFolderName}}` is the new folder name WITHOUT its index — which is what `Create folder with
   * notes...` already writes as the alias, so a folder created and then renamed ends up with the alias it
   * would have had if it had been created under the new name. `{{folderName}}` is the same name WITH the
   * index, for a vault whose aliases carry the number too.
   *
   * The rendered alias REPLACES the one the old name rendered and nothing else, so hand-written aliases
   * survive a rename. An EMPTY template leaves the property alone entirely; that is the opt-out, so no
   * separate toggle exists.
   *
   * A reorder does not write aliases and still does not: with this default the alias carries no index, so a
   * renumber would not change it anyway.
   */
  public folderNoteAliasesTemplate = '{{safeFolderName}}';

  /**
   * Where this vault keeps its folder notes (issue #216 / issue #217's thread).
   *
   * `Auto` reads the installed `folder-notes` plugin at every use rather than copying its values here — a
   * copy would go stale the moment that plugin is reconfigured — and falls back to a note named after its
   * folder, inside it, when that plugin is absent or set to a storage location with no counterpart here.
   *
   * `obsidian-dev-utils`' own {@link FolderNoteLocation}, NOT a plugin-local enum of the same name: the
   * library owns the folder-note concept since 94.2.0, and its four members are the four this plugin had
   * declared. The move needs **no** `registerLegacySettingsConverter` because the member VALUES are
   * byte-identical (`Auto` / `InsideFolder` / `None` / `ParentFolder`), so every already-persisted
   * `data.json` value is still a valid member — the same reasoning that let
   * {@link EmptyFolderBehaviorAfterMergingFolder} reuse `EmptyFolderBehavior`'s values. The difference is
   * the conclusion: that enum stays local because it has a member dev-utils cannot express, and this one has
   * nothing of its own left to keep.
   *
   * @default {@link FolderNoteLocation.Auto}
   */
  public folderNoteLocation = FolderNoteLocation.Auto;

  /**
   * What a folder's folder note is called, when {@link folderNoteLocation} is not `Auto`.
   *
   * `{{folderName}}` names the note after its folder (`charlie/charlie.md`); a literal like `!` or `index`
   * gives every folder note the same name. This is why the layout is a location PLUS a name rather than an
   * enum of fixed shapes: the two established inside-the-folder conventions differ only here.
   */
  public folderNoteNameTemplate = '{{folderName}}';

  /**
   * The `title` property written into a FOLDER's folder note — by a reorder that renumbered it (issue #216)
   * and by a rename that renamed it (issue #217).
   *
   * `{{folderName}}` is the new folder name WITH its index — which is exactly what the reporter's own
   * plugin writes — while `{{safeFolderName}}` is the same name without it, so a vault whose titles differ
   * from its folder names can say how.
   *
   * ONE setting for both operations rather than one each: they write the same property of the same note, so
   * two templates could only ever disagree, and whichever command ran last would win.
   *
   * An EMPTY template leaves the property alone entirely; that is the opt-out, so no separate toggle
   * exists.
   */
  public folderNoteTitleTemplate = '{{folderName}}';

  public frontmatterTitleMode = FrontmatterTitleMode.UseForInvalidTitleOnly;

  /**
   * Where a folder merge creates the merged note (issue #178). Defaults to `BesideFolder`, which is the
   * existing behavior, so no `registerLegacySettingsConverter` is needed — the same reasoning as
   * `flattenMode` and `shouldSplitRecursivelyIntoDefaultNewNoteFolder`.
   */
  public mergeFolderIntoFileLocation = MergeFolderIntoFileLocation.BesideFolder;

  public mergeFolderIntoFileNoteNameTemplate = '';

  public mergeTemplate = '\n\n{{content}}';

  /**
   * How a user-supplied name is rewritten before it is sanitized into a file name (issue #196) — the vault's
   * OWN replacements, instead of living with one universal {@link replacement} character.
   *
   * `{{rawString}}` is the name as supplied; with Templater installed the same value is bound as
   * `TOKENS.rawString`, so a mapping is written as
   * `<% TOKENS.rawString.replaceAll(": ", " - ") %>` — which turns `A: B` into `A - B` — and a
   * conditional one is just as easy. (The separator carries its space: replacing a bare `:` in `A: B`
   * would leave `A -  B`, which only survives because folder names collapse whitespace runs.)
   *
   * A Templater run needs a note to report on through `tp.file.*`, and it does NOT have to be an open one
   * (issue #218): the open note is used when there is one, otherwise the note last open, otherwise the note
   * last written. Only a vault holding no note at all refuses. Before that, a configured template made every
   * folder command — which has no note of its own to offer — fail whenever nothing was focused.
   *
   * A TEMPLATE rather than a `FROM => TO` mapping list, for the reason the rest of this plugin's decisions
   * are templates: a list can only ever express the substitutions someone already thought of, while one
   * escape hatch covers every mapping anyone will ask for. It is also why Templater is required for anything
   * conditional — plain token substitution cannot branch, and inventing a second mini-language to make it
   * branch would be a worse Templater.
   *
   * Applies EVERYWHERE a name becomes a file name — splits, extracts, the folder-merge note name, folder
   * creation — matching {@link replacement}, which is already plugin-wide. Empty (the default) skips it
   * entirely, which is what makes this need no `registerLegacySettingsConverter`: an existing `data.json`
   * has no such key, gets `''`, and behaves exactly as before.
   *
   * What the transform leaves invalid is NOT its problem — see
   * {@link shouldReplaceInvalidTitleCharacters}.
   */
  public nameTransformTemplate = '';
  public newFolderContentTemplate = '';
  /**
   * The name `Create folder with notes...` gives the folder it creates (issue #191).
   *
   * The default reproduces the reporter's own `folder-note-extended` plugin: `1. Test Notes`. `{{index}}`
   * is the next number in the sibling sequence, and `{{index:000}}` zero-pads it to the mask's width.
   *
   * Numbering is a template rather than a toggle so that the prefix/suffix, the separator and the padding
   * are all one decision written the way it will look — and dropping `{{index}}` turns numbering off, so no
   * separate switch is needed. The sibling scan derives its pattern from this very template, which is what
   * keeps "what gets numbered" and "what counts as already numbered" from drifting apart.
   */
  public newFolderNameTemplate = '{{index}}. {{safeFolderName}}';

  /**
   * The name a split gives the FOLDER it wraps its new note in — the auto-numbering of issue #269, for the
   * `Should split into folder` case where the reporter asked for the number to go on the folder "instead".
   *
   * `{{index}}` is the next number in the sibling sequence: `1 + max` over the destination's already-numbered
   * child FOLDERS, so the reporter's own `1, 3, 4` continues at `5` — a gap is never backfilled and a
   * deleted folder in the middle can never cause a collision. Sibling NOTES are a separate sequence and are
   * not consulted.
   *
   * EMPTY BY DEFAULT, and empty means the folder is named after the note exactly as it always was. That is
   * the opt-out: numbering is a template rather than a toggle for the same reason as
   * {@link newFolderNameTemplate} — the separator, the padding (`{{index:000}}`) and even the number's
   * POSITION (`{{safeFolderName}} ({{index}})`) are one decision written the way it will look, and dropping
   * `{{index}}` turns numbering off. A default of `''` is also what keeps every existing vault's splits
   * producing exactly the names they produce today.
   *
   * It takes the folder vocabulary of {@link newFolderNameTemplate}, with `{{safeFolderName}}` the name the
   * folder would have had. Whenever this one applies, {@link numberedSplitNoteNameTemplate} deliberately
   * does not: the note is already identified by the folder around it, so numbering both would write the
   * number twice.
   */
  public numberedSplitFolderNameTemplate = '';

  /**
   * The name a split gives the NOTE it creates, when that note is NOT wrapped in a folder of its own
   * (issue #269) — the `Should split into folder` off case, and the other half of
   * {@link numberedSplitFolderNameTemplate}.
   *
   * Same `1 + max` rule, over the destination's already-numbered sibling NOTES; numbered folders beside them
   * belong to the other sequence and are not consulted, and neither is an attachment. Empty by default and
   * empty means off, exactly as above.
   *
   * It takes the file vocabulary of {@link reorderedFileNameTemplate}, with `{{safeName}}` the basename the
   * note would have had. The extension is never templated.
   *
   * The number makes the note's name differ from the one that was typed, so — exactly like a
   * {@link splitIntoFolderNoteNameTemplate} override (issue #153) — the typed name is kept as an alias
   * and/or a frontmatter title, as {@link shouldAddInvalidTitleToNoteAlias} and
   * {@link frontmatterTitleMode} are configured. That is what keeps `[[D]]` resolving to `5. D`.
   */
  public numberedSplitNoteNameTemplate = '';

  /**
   * Which recency the pickers offer first when there is no query (issue #248). See
   * {@link PickerRecencyOrder} for why this is a choice rather than a fix.
   */
  public pickerRecencyOrder: PickerRecencyOrder = PickerRecencyOrder.RecentTargetsFirst;

  public releaseNotesShown: readonly string[] = [];

  /**
   * The name a reorder gives a renumbered FILE (issue #216).
   *
   * Its own setting rather than the folder one: folders and files are numbered as two independent
   * sequences (the file explorer always sorts folders above files), so a vault that numbers folders
   * `01. ` and notes `1 - ` can say so. The extension is never templated — it is carried across the rename
   * untouched.
   *
   * As with every numbered name here, the format is entirely this template's: the separator is literal
   * text, `{{index:000}}` zero-pads, and `{{safeName}} ({{index}})` puts the number at the end. The parse
   * that reads an existing index back is derived from this same template, so the two can never disagree.
   */
  public reorderedFileNameTemplate = '{{index}}. {{safeName}}';

  /**
   * The `title` property a reorder writes into a renumbered FILE (issue #216).
   *
   * Empty by default — and that means the property is left alone. Only folders were asked for, so a
   * reordered note is renamed and nothing else until this is filled in; `{{name}}` is the new basename
   * with its index, `{{safeName}}` the one without.
   */
  public reorderedFileTitleTemplate = '';

  /**
   * The name a reorder gives a renumbered FOLDER (issue #216).
   *
   * Deliberately NOT {@link newFolderNameTemplate}: that one names a folder being CREATED, and a vault may
   * want reordering to follow a different scheme — so the two are separate settings that merely start from
   * the same default.
   */
  public reorderedFolderNameTemplate = '{{index}}. {{safeFolderName}}';
  public replacement = '_';
  public shouldAddCommandsToSubmenu = true;
  public shouldAddInvalidTitleToNoteAlias = true;
  public shouldAllowOnlyCurrentFolderByDefault = false;

  public shouldAllowSplitIntoUnresolvedPathByDefault = true;
  /**
   * Whether a merge SWALLOWS items whose path is excluded/ignored in the plugin settings, instead of
   * skipping them and reporting them in a notice (issue #150).
   *
   * Strictly about the source side since issue #253. It used to double as "an excluded path may be picked
   * as a destination" — an inference never asked for, made for the file pickers in issue #240's task and
   * extended to the folder picker afterwards — which is what the reporter of #253 saw as a bug. That half
   * now lives in {@link shouldOfferExcludedPathsAsMergeDestinations}.
   */
  public shouldAlwaysMergeExcludedItems = false;
  public shouldApplyTextAfterExtractionToSameFile = false;

  /**
   * Whether `Create folder with notes...` confirms before creating anything (issue #191).
   *
   * Defaults to `false`, unlike every other `shouldAskBefore*` setting, and deliberately: this flow already
   * has a modal the user types into, so a second dialog would make the one-step flow the request describes
   * into a two-step one. It is worth turning on for a different reason than the other flows have — the
   * normalization means the folder's name is not what was typed, and the dialog is where that becomes
   * visible before it happens.
   */
  public shouldAskBeforeCreatingFolder = false;
  public shouldAskBeforeFlattening = true;
  public shouldAskBeforeMerging = true;
  public shouldAskBeforeMovingFolder = true;
  public shouldAskBeforeSplitting = true;

  public shouldAskBeforeSwapping = true;

  /**
   * Whether a split/extract that CREATES its note asks where to put it, right after the name is confirmed
   * and before the confirmation dialog (issue #238).
   *
   * The reporter's ask was ordering — name first, path second — because without it the destination is never
   * asked for at all: it falls out of `Should allow only current folder`, a path typed into the name box, or
   * Obsidian's own `Default location for new notes`, which is where their extract silently landed.
   *
   * Defaults to `false` so the common case is untouched: a heading-driven extract seeds the box with the
   * heading and the user presses `Enter`, and growing a second modal on that path for everyone would trade
   * one reporter's problem for everyone else's. It applies only where there is a name to place first — the
   * picker actually opened, and the switch says `Create` — so heading-driven passes that skip the picker and
   * every `Merge` are unaffected.
   */
  public shouldAskForTargetFolderWhenSplitting = false;

  /**
   * Whether every operation reports itself — a progress notice while it runs, and a notice naming what it
   * did once it finishes (issue #182). Covers merge, split/extract, swap, move, flatten, rename heading and
   * reorder headings alike; refusals ("this path is ignored in the plugin settings") and errors are always
   * shown and are NOT gated by this.
   *
   * Deliberately NOT folded into `shouldShowSmartCutNotice`, which gates an *interactive* notice — turning
   * that one off removes buttons, not just information — nor into
   * `smartCutAndPasteCompletionFeedback`, which already owns how a finished smart cut & paste announces
   * itself (so a move is never reported twice).
   *
   * The progress notice is what carries the operation's Cancel button, so turning this off also removes
   * that affordance; cancelling then goes through the lock indicator's right-click unlock, which aborts the
   * operation just the same.
   *
   * Needs no `registerLegacySettingsConverter` — an existing `data.json` simply has no such key and gets
   * `true`. Unlike the plugin's other migration-free settings, that default deliberately CHANGES behavior
   * for an existing vault: reporting every operation IS the feature the issue asks for. Do not "fix" this
   * later by flipping the default.
   */
  /**
   * Whether an operation's progress is reported by a dialog that blocks the vault instead of by a
   * notice (issue #247).
   *
   * The operations rewrite links, names, folder paths and frontmatter across many notes. A notice
   * says so while leaving Obsidian clickable, so a second operation can be started on top of a
   * half-applied first one. The dialog takes that away, and stays up until the work QUEUED by the
   * operation has drained too — a command returning is not the end, because renaming a file makes
   * other plugins queue their own link updates.
   *
   * Defaults to `false`. Blocking the whole vault is a strong thing to do to someone who did not ask
   * for it, and the notice already reports the same progress and offers the same Cancel.
   *
   * Honors {@link shouldShowOperationNotices}: with progress reporting off, nothing is shown at all.
   */
  public shouldBlockVaultDuringOperations = false;

  /**
   * Whether a split/extract that CREATES a note asks for its folder first and its name second, in two
   * plain prompts, instead of opening the target picker (issue #261).
   *
   * The reporter's objection is that the picker's box does two jobs at once: what he types is the new
   * note's NAME, and it simultaneously filters a list of notes that already exist — none of which he
   * wants. With this on he is asked the two questions separately, and the name box has no suggestions
   * under it at all.
   *
   * **Consequence, and the reason it is opt-in**: the `Create` / `Merge` switch lives in the picker, so a pass
   * that skips the picker cannot be switched to `Merge`. The setting therefore applies only while
   * {@link defaultSplitTargetMode} is `Create` — someone whose default is `Merge` is asking for the picker
   * — and anyone who wants to merge on a given pass turns it off.
   *
   * Name CLEANING needs nothing new: `createNoteFromTypedName` already runs
   * {@link nameTransformTemplate}, replaces invalid characters per
   * {@link shouldReplaceInvalidTitleCharacters}, and records what was typed as an alias / `title`.
   */
  public shouldChooseFolderBeforeNameWhenSplitting = false;
  /**
   * Whether the target note is handed to the Custom Attachment Location plugin once an extract lands,
   * so that plugin collects its attachments (issue #246).
   *
   * This exists because {@link shouldMoveAttachmentsWhenSplitting} deliberately stops short: it moves
   * an attachment only when the extracted range is its SOLE referencer, since deciding where a SHARED
   * attachment belongs is a question this plugin has no answer to. Custom Attachment Location does —
   * it has a mode setting for exactly that, and a note-priority list on top — so the note is handed
   * over instead of growing a second, worse copy of that logic here. The reporter reached the same
   * conclusion themselves before filing.
   *
   * Defaults to `false`, unlike the move toggles. It reaches into another plugin and moves files as a
   * side effect of an unrelated command, so a user who has not asked for it should see no change.
   *
   * Scoped to extract, which is what was asked for. Merge relocates its attachments before it reads
   * its source rather than after, so the same hook there is a separate question.
   */
  public shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit = false;
  public shouldConvertFoldersToHeadingsWhenMergingFolder = false;
  /**
   * Whether a selection taken entirely from the source note's frontmatter is extracted as PROPERTIES —
   * merged into the target note's own frontmatter through the frontmatter merge strategy — instead of being
   * pasted into its body as raw YAML text (issue #183).
   *
   * Every frontmatter line the selection touches is taken in full, together with the key lines it sits
   * under, so selecting two `aliases` values moves them across as `aliases`. Anything else — a selection
   * reaching outside the block, or lines that do not parse into properties — extracts the raw text exactly
   * as before, and so do the smart cut & paste moves, which insert at a token placed in the body.
   */
  public shouldExtractFrontmatterSelectionAsProperties = true;

  public shouldFixFootnotesByDefault = true;

  public shouldIncludeChildFoldersWhenMergingByDefault = true;
  public shouldIncludeChildFoldersWhenSwappingByDefault = true;
  /**
   * Whether a reorder offers the folder's FILES for renumbering as well, and not only its folders
   * (issue #216).
   *
   * Seeds the modal's `Include files` checkbox, which is where the choice is made while
   * {@link shouldShowModalInstructions} offers that checkbox — and is the whole of it once that setting hides
   * it (issue #242). It starts OFF so that reordering a folder's subfolders never silently renames the notes
   * sitting beside them.
   */
  public shouldIncludeFilesWhenReorderingByDefault = false;
  public shouldIncludeFrontmatterWhenSplittingByDefault = false;
  public shouldIncludeParentFoldersWhenMergingByDefault = true;
  public shouldIncludeParentFoldersWhenSwappingByDefault = true;
  public shouldJumpToMovedContentToBottom = true;
  public shouldJumpToMovedContentToTop = true;
  public shouldKeepHeadingsWhenSplittingContent = true;
  public shouldLockAllNotesWhenMarkingSelection = false;

  public shouldMergeHeadingsByDefault = false;

  public shouldMoveAttachmentsWhenMergingFile = true;

  public shouldMoveAttachmentsWhenMergingFolder = true;
  /**
   * Whether the attachments an extracted range references follow it into the new note's attachment folder
   * (issue #239) — the split-side counterpart of {@link shouldMoveAttachmentsWhenMergingFile}.
   *
   * ONE toggle covers every split flow (owner, 2026-08-14), unlike the merge pair: a merge collects by note
   * or by folder — two genuinely different rules — while every split shares one, so a second toggle would
   * gate the same behavior twice.
   *
   * Defaults to `true`, matching the merge pair. That is safe rather than merely symmetric because
   * `collectAttachmentsReferencedBySelections` moves an attachment only when the extracted range is its SOLE
   * referencer: one referenced by both the extracted heading and the text left behind stays where it is.
   */
  public shouldMoveAttachmentsWhenSplitting = true;

  public shouldOfferCurrentNoteWhenSplitting = true;

  /**
   * Whether a merge destination picker offers a note or folder whose path is excluded/ignored in the
   * plugin settings, and lets the merge land there (issue #253).
   *
   * Split out of {@link shouldAlwaysMergeExcludedItems}, which governs only what a merge swallows. The two
   * answer different questions — what may be poured in, and where it may be poured — and conflating them
   * meant a user who wanted excluded items merged rather than skipped also got excluded folders offered as
   * destinations, which is what #253 reports.
   *
   * Defaults to `false`, and deliberately with NO `registerLegacySettingsConverter` seeding it from
   * {@link shouldAlwaysMergeExcludedItems}: such a converter would preserve for every existing vault
   * exactly the behavior #253 calls a bug, the reporter's own included. The relaxation was never a
   * requested feature, so it does not carry forward — anyone who wants it turns this on.
   *
   * Governs PICKERS and the destination guard they feed, never where a command is offered: every
   * `canExecute*` gate and every ignored-SOURCE refusal is decided elsewhere and is untouched by it.
   */
  public shouldOfferExcludedPathsAsMergeDestinations = false;

  /**
   * Whether `Merge current folder with another folder...` opens the first note of the destination folder
   * once the merge lands (issue #215) — the folder's own notes ordered naturally, descending into a
   * sub-folder only when the top level holds none.
   *
   * NOT the per-note {@link shouldOpenNoteAfterMerge}, which the folder merge deliberately overrides to
   * `false`: opening every merged note in turn is the "visual cycling" of issue #106. This is ONE open,
   * after the whole transaction has committed.
   *
   * Defaults to `false`, so an existing vault behaves exactly as before and needs no
   * `registerLegacySettingsConverter` — an absent key already resolves to it.
   */
  public shouldOpenFirstNoteAfterMergingFolder = false;
  /**
   * Whether `Create folder with notes...` opens the note it created (issue #191). Defaults to `true`,
   * matching the reporter's own plugin — the point of the command is to start writing in the new note.
   * With several notes declared, the FIRST one declared is the one opened.
   */
  public shouldOpenNoteAfterCreatingFolder = true;
  public shouldOpenNoteAfterMerge = false;
  /**
   * Whether `Merge folder contents into a single file...` opens the note it produced (issue #212).
   *
   * Same shape as {@link shouldOpenFirstNoteAfterMergingFolder}, and separate from it on purpose: the two
   * commands produce different things — one merged note against a folder full of them — so wanting to land
   * in one is not wanting to land in the other. Both are layered ABOVE the per-note
   * `shouldOpenAfterMerge: false` that issue #106 requires, never a relaxation of it.
   *
   * Defaults to `false`; see {@link shouldOpenFirstNoteAfterMergingFolder} for why that needs no converter.
   */
  public shouldOpenNoteAfterMergingFolderIntoFile = false;

  public shouldOpenTargetNoteAfterSplit = false;

  /**
   * What happens to invalid characters that {@link nameTransformTemplate} did NOT handle (issue #196).
   *
   * On (the default), they take the universal {@link replacement} — the plugin's original behavior. Off,
   * they are left exactly where they are, and the flow's own validation refuses the name: the prompt of
   * `Create folder with notes...` re-asks, and the split / folder-merge note-name templates fall back to
   * their default name. That refusal IS issue #196's "block the characters that have no replacement", which
   * is why the request needed no setting of its own — with a transform mapping the characters the user
   * cares about, this toggle already says what to do with the rest.
   */
  public shouldReplaceInvalidTitleCharacters = true;
  public shouldRunTemplaterOnDestinationFile = false;
  /**
   * Whether the modals offer the controls that override a setting for a single operation (issue #242).
   *
   * Covers the instruction bar of the merge/split/swap pickers, the reorder dialog's `Include files` checkbox,
   * and the split picker's `Create` / `Merge` switch — everything that lets one run disagree with this page.
   * Turned off, the settings page is the only place those choices are made, which is what the reporter asked
   * for; the operations still behave exactly as the defaults say, because every control is already seeded from
   * the setting it overrides.
   *
   * The property name says `ModalInstructions` because that is all it originally gated, and it keeps that name
   * deliberately: renaming it would need a `registerLegacySettingsConverter` and would silently reset the
   * choice of anyone who had already turned it off, for no gain the displayed name cannot deliver.
   *
   * Two controls are deliberately NOT covered. `Don't ask again` (and its mobile
   * `... and don't ask again` button) WRITES a setting rather than overriding one, so hiding it would remove
   * the in-flow way to reach this page's own value. The paste-options modal is reached only from the
   * *advanced* `Move marked selection here` command — the plain command already runs on these settings with no
   * UI at all — so choosing it IS the opt-in to overriding, and gating it would leave an empty dialog.
   */
  public shouldShowModalInstructions = true;
  public shouldShowMoveAtCursorButton = true;

  public shouldShowMoveToBottomButton = true;

  public shouldShowMoveToTopButton = true;

  public shouldShowOperationNotices = true;

  /**
   * Whether the `Create folder with notes...` confirmation dialog offers a `Rename` button beside the FOLDER
   * name (issue #214).
   *
   * Separate from {@link shouldShowRenameButtonForCreatedNotes} because the two names arrive from opposite
   * directions. This one is the name the user TYPED, which normalization then rewrites — title casing,
   * invalid characters, the numbering template — so the button is the affordance for fixing what
   * normalization did, and is worth keeping even when the note buttons are gone.
   *
   * Only has any effect while `shouldAskBeforeCreatingFolder` is on: with no dialog there is no button.
   *
   * Defaults to `true`, so an existing vault behaves exactly as it did after issue #200 and needs no
   * `registerLegacySettingsConverter` — an absent key already resolves to it.
   */
  public shouldShowRenameButtonForCreatedFolder = true;

  /**
   * Whether the `Create folder with notes...` confirmation dialog offers a `Rename` button beside each note
   * in `Notes that will be created` — issue #214's literal ask.
   *
   * Those names come from {@link newFolderContentTemplate}, which the user wrote themselves: for a vault
   * with a consistent naming scheme the template is already the answer, and the button is only a way to
   * deviate from it by accident. Turning it off makes the previewed names final without removing the
   * preview, which is the whole point of the dialog.
   *
   * Reported by the same person who asked for the buttons in issue #200 — the request is to make that
   * feature optional, never to withdraw it, which is why the default is `true`. See
   * {@link shouldShowRenameButtonForCreatedFolder} for why the folder half is a setting of its own and for
   * why neither needs a `registerLegacySettingsConverter`.
   */
  public shouldShowRenameButtonForCreatedNotes = true;

  /**
   * Whether the smart cut & paste notice offers a `Reorder headings...` button while a HEADING is marked
   * (issue #229). Only a heading mark ever shows it — a plain selection mark has no heading to act on — and
   * the `Reorder headings...` command stays available regardless.
   */
  public shouldShowReorderHeadingsButton = true;

  public shouldShowSmartCutNotice = true;

  /**
   * Whether the smart cut & paste notice offers a `Split heading recursively...` button while a HEADING is
   * marked (issue #229). Like {@link shouldShowReorderHeadingsButton}, it is a heading-mark-only button and
   * the command it drives stays available regardless.
   */
  public shouldShowSplitHeadingRecursivelyButton = true;
  public shouldSplitHeadingsAutomatically = false;

  public shouldSplitIntoFolder = false;
  /**
   * Whether `Split note by headings recursively...` roots the tree it produces in Obsidian's own
   * `Default location for new notes` instead of beside the source note (issue #173).
   *
   * **Root-only, deliberately.** Only the FIRST pass — the note the command was invoked on — resolves
   * against that folder; every deeper pass keeps creating its note beside its source, which is what makes
   * each pass nest one level deeper. Redirecting every pass would put every produced note in one flat
   * folder and destroy the hierarchy the command exists to build, so it is not offered.
   *
   * Off by default, which reproduces the pre-#173 behavior exactly — which is what makes this setting need
   * no `registerLegacySettingsConverter`: an existing `data.json` simply has no such key and gets `false`.
   *
   * With Obsidian set to `Same folder as current file` the setting changes nothing, because that resolution
   * IS the beside-the-source behavior.
   */
  public shouldSplitRecursivelyIntoDefaultNewNoteFolder = false;
  public shouldSwapEntireFolderStructureByDefault = true;

  /**
   * Whether `Create folder with notes...` Title Cases the typed folder name (issue #191): the first letter
   * of each word upper-cased and the rest lower-cased, EXCEPT a word that is already entirely upper-case,
   * which is left alone so an acronym survives (`api TEST` becomes `Api TEST`).
   *
   * The only normalization step with a switch of its own, because it is the only one that rewrites letters
   * the user deliberately typed. Trimming and whitespace collapsing are unconditional, and invalid
   * characters are already governed by `shouldReplaceInvalidTitleCharacters` / `replacement`.
   */
  public shouldTitleCaseCreatedFolderName = true;
  public shouldTreatTitleAsPathByDefault = true;

  public shouldUseSourceTitleWhenTargetHasNoTitle = false;

  /**
   * How a finished smart cut & paste move announces itself in the target note (issue #176). Defaults to
   * the original select-the-moved-text behavior, so the notice modes are strictly opt-in.
   */
  public smartCutAndPasteCompletionFeedback = SmartCutAndPasteCompletionFeedback.SelectMovedContent;

  /**
   * The template a smart cut & paste move applies, and the base of the per-direction chain (issue #174):
   *
   * ```text
   * at cursor  →  smartCutAndPasteTemplate                                   →  split → merge chain
   * to top     →  smartCutAndPasteToTopTemplate    → smartCutAndPasteTemplate →  split → merge chain
   * to bottom  →  smartCutAndPasteToBottomTemplate → smartCutAndPasteTemplate →  split → merge chain
   * ```
   *
   * So this is BOTH the at-cursor template and the default for the two edge moves. Resolved by
   * `resolveSmartCutAndPasteTemplate`; empty everywhere falls through to the ordinary split → merge chain.
   */
  public smartCutAndPasteTemplate = '';

  /**
   * Optional override of {@link smartCutAndPasteTemplate} for `Move marked selection to bottom of file`.
   * Empty (the default) means "use {@link smartCutAndPasteTemplate}".
   */
  public smartCutAndPasteToBottomTemplate = '';
  /**
   * Optional override of {@link smartCutAndPasteTemplate} for `Move marked selection to top of file` — the
   * direction issue #162 wanted its own formatting for (a blank line after the frontmatter), which one
   * template shared by all three moves could not express.
   *
   * Empty (the default) means "use {@link smartCutAndPasteTemplate}", which is exactly the pre-#174
   * behavior — an existing `data.json` has no such key, gets `''`, and keeps applying its shared template
   * to all three moves. That is why these overrides need no `registerLegacySettingsConverter`.
   */
  public smartCutAndPasteToTopTemplate = '';

  public splitIntoFolderNoteNameTemplate = '';
  /**
   * The template a split into a BRAND-NEW note applies, falling back to {@link mergeTemplate} when empty.
   *
   * It also fills the note the two create commands make — `Create empty note at cursor...` and
   * `Create empty note in folder...` (issue #244) — where `{{content}}` interpolates to nothing, since
   * nothing was extracted, and therefore marks where the CARET goes in the created note. There the fallback
   * to {@link mergeTemplate} deliberately does NOT apply: an empty template leaves the created note
   * genuinely empty, because wrapping the shipped `\n\n{{content}}` around no content is what would put two
   * blank lines in a note asked to be empty.
   *
   * The caret needs an editor to land in, so it is only observable when the created note actually opens —
   * always for the folder command, and for the editor one when `shouldOpenTargetNoteAfterSplit` is on.
   */
  public splitTemplate = '';
  public splitToExistingFileTemplate = Action.Split;

  public textAfterExtractionMode = TextAfterExtractionMode.LinkToNewFile;

  /**
   * Paths on which the plugin's commands are NOT offered — the exclude half of the SECOND, independent
   * path filter that decides command visibility (issue #198).
   */
  public get commandExcludePaths(): string[] {
    return this._commandPathSettings.excludePaths;
  }

  public set commandExcludePaths(value: string[]) {
    this._commandPathSettings.excludePaths = value;
  }

  /**
   * Paths the plugin's commands are restricted to — the include half of the command-visibility filter
   * (issue #198). Empty (the default) offers them everywhere the exclude half does not block.
   */
  public get commandIncludePaths(): string[] {
    return this._commandPathSettings.includePaths;
  }

  public set commandIncludePaths(value: string[]) {
    this._commandPathSettings.includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.Create} commands are not offered (issue #249) — the exclude
   * half of that category's own filter, narrowing what {@link commandExcludePaths} already blocks.
   */
  public get createCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Create).excludePaths;
  }

  public set createCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Create).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.Create} commands are restricted to (issue #249). Empty — the
   * default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get createCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Create).includePaths;
  }

  public set createCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Create).includePaths = value;
  }

  public get excludePaths(): string[] {
    return this._pathSettings.excludePaths;
  }

  public set excludePaths(value: string[]) {
    this._pathSettings.excludePaths = value;
  }

  public get includePaths(): string[] {
    return this._pathSettings.includePaths;
  }

  public set includePaths(value: string[]) {
    this._pathSettings.includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.Merge} commands are not offered (issue #249) — the exclude
   * half of that category's own filter, narrowing what {@link commandExcludePaths} already blocks.
   */
  public get mergeCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Merge).excludePaths;
  }

  public set mergeCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Merge).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.Merge} commands are restricted to (issue #249). Empty — the
   * default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get mergeCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Merge).includePaths;
  }

  public set mergeCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Merge).includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.MoveAndFlatten} commands are not offered
   * (issue #249) — the exclude half of that category's own filter.
   */
  public get moveAndFlattenCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.MoveAndFlatten).excludePaths;
  }

  public set moveAndFlattenCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.MoveAndFlatten).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.MoveAndFlatten} commands are restricted to (issue #249).
   * Empty — the default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get moveAndFlattenCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.MoveAndFlatten).includePaths;
  }

  public set moveAndFlattenCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.MoveAndFlatten).includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.Rename} commands are not offered (issue #249) — the exclude
   * half of that category's own filter.
   */
  public get renameCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Rename).excludePaths;
  }

  public set renameCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Rename).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.Rename} commands are restricted to (issue #249). Empty — the
   * default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get renameCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Rename).includePaths;
  }

  public set renameCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Rename).includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.Reorder} commands are not offered (issue #249) — the
   * exclude half of that category's own filter.
   */
  public get reorderCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Reorder).excludePaths;
  }

  public set reorderCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Reorder).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.Reorder} commands are restricted to (issue #249). Empty — the
   * default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get reorderCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Reorder).includePaths;
  }

  public set reorderCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Reorder).includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.Select} commands are not offered (issue #266) — the exclude
   * half of that category's own filter.
   *
   * The select commands got a category of their own rather than joining
   * {@link CommandCategory.SplitAndExtract}, whose ranges they share: they only move the caret, so hiding
   * every extract on a path is no reason to lose them too.
   */
  public get selectCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Select).excludePaths;
  }

  public set selectCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Select).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.Select} commands are restricted to (issue #266). Empty — the
   * default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get selectCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Select).includePaths;
  }

  public set selectCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Select).includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.SmartCutAndPaste} commands are not offered (issue #249) —
   * the exclude half of that category's own filter.
   */
  public get smartCutAndPasteCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.SmartCutAndPaste).excludePaths;
  }

  public set smartCutAndPasteCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.SmartCutAndPaste).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.SmartCutAndPaste} commands are restricted to (issue #249). Empty —
   * the default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get smartCutAndPasteCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.SmartCutAndPaste).includePaths;
  }

  public set smartCutAndPasteCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.SmartCutAndPaste).includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.SplitAndExtract} commands are not offered (issue #249) —
   * the exclude half of that category's own filter.
   */
  public get splitCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.SplitAndExtract).excludePaths;
  }

  public set splitCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.SplitAndExtract).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.SplitAndExtract} commands are restricted to (issue #249). Empty —
   * the default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get splitCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.SplitAndExtract).includePaths;
  }

  public set splitCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.SplitAndExtract).includePaths = value;
  }

  /**
   * Paths on which the {@link CommandCategory.Swap} commands are not offered (issue #249) — the exclude
   * half of that category's own filter.
   */
  public get swapCommandExcludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Swap).excludePaths;
  }

  public set swapCommandExcludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Swap).excludePaths = value;
  }

  /**
   * Paths the {@link CommandCategory.Swap} commands are restricted to (issue #249). Empty — the
   * default — leaves them offered wherever the baseline pair and the exclude half above allow.
   */
  public get swapCommandIncludePaths(): string[] {
    return this.commandCategoryPathSettings(CommandCategory.Swap).includePaths;
  }

  public set swapCommandIncludePaths(value: string[]) {
    this.commandCategoryPathSettings(CommandCategory.Swap).includePaths = value;
  }

  /**
   * One {@link PathSettings} instance per {@link CommandCategory} (issue #249) — the per-category half of
   * the command-visibility filter, layered on {@link _commandPathSettings} rather than replacing it.
   *
   * A category's filter can only NARROW: {@link shouldBlockCommandOnPath} blocks when either filter says
   * so, so a category list never re-opens a path the baseline pair already hid. That is what keeps the
   * feature free of a legacy-settings converter — an existing `data.json` carries only the baseline pair,
   * every category here starts with two empty lists, and two empty lists block nothing.
   */
  private readonly _commandCategoryPathSettings: ReadonlyMap<CommandCategory, PathSettings> = new Map(
    COMMAND_CATEGORIES.map((commandCategory) => [commandCategory, new PathSettings()])
  );

  /**
   * The command-visibility filter (issue #198) — a SECOND {@link PathSettings} instance, deliberately
   * separate from {@link _pathSettings}.
   *
   * The two filters answer different questions and the client wanted them controlled separately:
   * {@link _pathSettings} decides what is off-limits as CONTENT (never a picker entry, never a merge/split
   * target or source, never moved by a folder operation), while this one decides only whether the commands
   * are OFFERED at all. Wanting commands hidden in a subtree that is still a valid merge destination — or
   * the reverse — was impossible while one list drove both.
   *
   * It replaces the `shouldBlockCommandsOnExcludedPaths` toggle, which needed a switch precisely because it
   * borrowed the other filter's list. Two empty lists already mean "block nothing" (ODU's `PathSettings`
   * defaults make {@link PathSettings.isPathIgnored} `false`), which IS the old toggle-off default, so a
   * separate switch would only add the incoherent "off, yet paths listed" state. Existing settings are
   * carried over by the `shouldBlockCommandsOnExcludedPaths` legacy converter in
   * `plugin-settings-component.ts`, which seeds BOTH halves from the original lists — the include half
   * matters because the old blocking fired on `isPathIgnored`, which already accounted for `includePaths`.
   */
  private readonly _commandPathSettings = new PathSettings();

  private readonly _pathSettings = new PathSettings();

  /**
   * Which context menus offer one command (issue #254).
   *
   * @param commandId - The id of the command asking, without the plugin-id prefix.
   * @returns Its {@link CommandMenuPlacement}.
   */
  public commandMenuPlacement(commandId: string): CommandMenuPlacement {
    const commandMenuPlacement = this.commandMenuPlacements.get(commandId);
    /*
     * An absent key is a command the user has never chosen a placement for — every command until one is
     * changed, and any command with no settings row at all. An UNKNOWN value is a hand-edited `data.json`;
     * it is answered here rather than by a registered validator, because the placements live in one `Map`
     * keyed by command id while a validator binds to a settings property name. This is the ONE place that
     * decides it, so every caller downstream can treat a placement as a real member.
     */
    if (commandMenuPlacement === undefined || !COMMAND_MENU_PLACEMENTS.includes(commandMenuPlacement)) {
      return CommandMenuPlacement.EditorMenu;
    }
    return commandMenuPlacement;
  }

  public isPathIgnored(path: string): boolean {
    return this._pathSettings.isPathIgnored(path);
  }

  /**
   * Whether an Advanced Note Composer command must be blocked (hidden) on the given path (issue #93):
   * decided ENTIRELY by the command-visibility filter, {@link _commandPathSettings}, and no longer by
   * `excludePaths` plus a toggle (issue #198).
   *
   * Since issue #249 the answer also depends on WHICH command asks. Two filters are consulted and either
   * one blocking is enough: {@link _commandPathSettings}, the baseline pair that covers every command,
   * and the asking command's own {@link CommandCategory} filter, which narrows it further. A category
   * therefore cannot re-open what the baseline hid — the ask was to block LESS by naming a category, not
   * to carve exceptions out of a blanket block.
   *
   * With every list empty — the default — nothing is ever blocked, so commands stay visible on a merely
   * excluded path and show an "ignored in the plugin settings" notice on trigger instead, exactly as they
   * did with the removed toggle off.
   *
   * @param path - The path to check.
   * @param commandCategory - The category of the command asking.
   * @returns Whether the command must be blocked on the path.
   */
  public shouldBlockCommandOnPath(path: string, commandCategory: CommandCategory): boolean {
    return this._commandPathSettings.isPathIgnored(path) || this.commandCategoryPathSettings(commandCategory).isPathIgnored(path);
  }

  /**
   * The path filter of a single command category.
   *
   * @param commandCategory - The category whose filter is wanted.
   * @returns Its {@link PathSettings}.
   */
  private commandCategoryPathSettings(commandCategory: CommandCategory): PathSettings {
    return ensureNonNullable(this._commandCategoryPathSettings.get(commandCategory));
  }
}
