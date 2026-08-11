import { PathSettings } from 'obsidian-dev-utils/obsidian/path-settings';

export enum Action {
  Merge = 'Merge',
  Split = 'Split'
}

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

/**
 * Where a folder's folder note lives (issue #217's thread) — the one note whose properties describe the
 * folder itself, and therefore the only note a folder rename or renumber may rewrite.
 *
 * The three concrete members are the shapes the folder-note ecosystem actually uses:
 * `charlie/charlie.md` and `charlie/index.md` are both `InsideFolder` (they differ only in the NAME
 * template, which is why the name is a template and not a fourth member), while `charlie.md` beside the
 * folder is `ParentFolder` — whose whole point is that `[[alpha/bravo/charlie]]` links to a folder with no
 * special syntax.
 */
export enum FolderNoteLocation {
  /**
   * Take the answer from the installed `folder-notes` plugin, falling back to a note named after its
   * folder, inside it. The default, and resolved LIVE rather than copied — see `folder-note.ts`.
   */
  Auto = 'Auto',

  /**
   * `alpha/bravo/charlie/<name>.md`.
   */
  InsideFolder = 'InsideFolder',

  /**
   * The vault has no folder notes — nothing is resolved and no properties are ever rewritten.
   */
  None = 'None',

  /**
   * `alpha/bravo/<name>.md`, beside the folder rather than inside it.
   */
  ParentFolder = 'ParentFolder'
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

export enum TextAfterExtractionMode {
  EmbedNewFile = 'embed',
  LinkToNewFile = 'link',
  None = 'none'
}

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

  public defaultFrontmatterMergeStrategy = FrontmatterMergeStrategy.MergeAndPreferNewValues;

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
   * Where this vault keeps its folder notes (issue #216 / issue #217's thread).
   *
   * `Auto` reads the installed `folder-notes` plugin at every use rather than copying its values here — a
   * copy would go stale the moment that plugin is reconfigured — and falls back to a note named after its
   * folder, inside it, when that plugin is absent or set to a storage location with no counterpart here.
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
   * The `title` property a reorder writes into a renumbered FOLDER's folder note (issue #216).
   *
   * `{{folderName}}` is the new folder name WITH its index — which is exactly what the reporter's own
   * plugin writes — while `{{safeFolderName}}` is the same name without it, so a vault whose titles differ
   * from its folder names can say how.
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
   * Seeds the modal's `Include files` checkbox, which is where the choice is actually made — so this is a
   * default, not a switch. It starts OFF so that reordering a folder's subfolders never silently renames
   * the notes sitting beside them.
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
  public shouldOfferCurrentNoteWhenSplitting = true;
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
  public shouldShowModalInstructions = true;
  public shouldShowMoveAtCursorButton = true;
  public shouldShowMoveToBottomButton = true;
  public shouldShowMoveToTopButton = true;

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

  public shouldShowSmartCutNotice = true;
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

  public isPathIgnored(path: string): boolean {
    return this._pathSettings.isPathIgnored(path);
  }

  /**
   * Whether an Advanced Note Composer command must be blocked (hidden) on the given path (issue #93):
   * decided ENTIRELY by the command-visibility filter, {@link _commandPathSettings}, and no longer by
   * `excludePaths` plus a toggle (issue #198).
   *
   * With both of its lists empty — the default — nothing is ever blocked, so commands stay visible on a
   * merely excluded path and show an "ignored in the plugin settings" notice on trigger instead, exactly
   * as they did with the removed toggle off.
   *
   * @param path - The path to check.
   * @returns Whether commands must be blocked on the path.
   */
  public shouldBlockCommandOnPath(path: string): boolean {
    return this._commandPathSettings.isPathIgnored(path);
  }
}
