# CHANGELOG

## 6.4.0

This release has 1 new feature, 1 fix and 1 documentation change.

### New

- **bulk-rename:** rename a whole explorer selection at once (<https://github.com/mnaoumov/obsidian-explorer-multi-select/issues/1>)

### Fixed

- **demo-vault:** link the bulk rename example with markdown links

### Documentation

- **changelog:** regroup the published release notes for readers

## 6.3.0

This release has 1 new feature and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **merge:** merge a note back in place of its residual link (#310)

### Documentation

- **demo-vault:** list the merge-at-the-link setting on the settings page

## 6.2.0

This release has 1 new feature and 2 documentation changes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **split:** add a Folder for split notes setting (#309)

### Documentation

- make issue attachments optional and strongly encouraged
- link to the Obsidian resources page

## 6.1.0

This release has 3 new features, 2 fixes and 5 documentation changes. 11 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add a Report a bug command
- record folder-wide commands as `git` commits for undo
- preserve permanent links when merging notes

### Fixed

- retain incoming frontmatter when templates have no properties
- **create-folder:** keep the confirm row's colon beside its label

### Documentation

- **readme:** point bug reports at the Report a bug command
- add issue-filing instructions for AI agents
- **readme:** combine related resources and plugin comparisons
- **readme:** bring the README under the landing-page size budget
- **readme:** add a Similar plugins section

## 6.0.0

This release has 1 breaking change, 3 fixes and 6 documentation changes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Breaking changes

- **deps:** move to `obsidian-lib` 6 and off the dropped `obsidian-dev-utils` names

### Fixed

- **demo-vault:** wait for the automatic heading splits before a button reports
- drop the plugin name from notice text
- **demo-vault:** load the demo setup helpers from @mnaoumov/obsidian-lib

### Documentation

- name `obsidian-lib` where comments said dev-utils
- point leftover `obsidian-dev-utils` mentions at the packages that hold the APIs now
- shorten the debugging section
- **changelog:** escape the issue-title tags so `markdownlint` and `cspell` pass
- **changelog:** name the issue each released entry resolved
- **readme:** lead the Debugging section with `Advanced Debug Mode`

## 5.20.0

This release has 1 new feature and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **path-settings:** accept globs and match include/exclude paths case-insensitively

### Documentation

- mark plugin names as code

## 5.19.2

This release has 2 fixes and 2 documentation changes. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **split:** refuse when the source tab navigates away mid-split
- **split:** merge naming a note after a heading's text, not the space after its hashes

### Documentation

- **demo-vault:** give every settings button a way back to the shipped default
- **demo-vault:** give every Try it section buttons for its setup and steps

## 5.19.1

This release has 1 fix. 6 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **ui:** render plugin names as code in notices, settings, docs and comments

## 5.19.0

This release has 1 new feature.

### New

- **select:** merge Copy link to this file (#308)

## 5.18.0

This release has 1 new feature.

### New

- **reorder:** merge reversing a heading level and the end drop zone (#307)

## 5.17.0

This release has 2 new features and 1 documentation change.

### New

- **reorder:** merge sorting headings by created, modified or recently seen time (#306)
- **reorder:** sort a heading level by name in Reorder headings (#306)

### Documentation

- **screenshots:** merge the five-frame mobile set

## 5.16.0

This release has 1 new feature.

### New

- **selection:** finish an interrupted selection with End selection alone (#305)

## 5.15.0

This release has 1 new feature.

### New

- **pickers:** optionally show a folder note by its folder's path (#304)

## 5.14.0

This release has 1 new feature and 3 fixes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- rename the split/extract wording to extract (#299)

### Fixed

- **split:** keep the create/merge switch steady across the folder prompt and the picker (#303)
- **templater:** consume the cursor marker when a created note opens (#301)
- **smart-cut:** re-select the moved content from the completion notice link (re #300 - \[FR\] Highlight the content with continuous clicking)

## 5.13.0

This release has 6 new features and 1 documentation change. 8 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **merge-folder:** merge keeping attachment unit folders whole (#298)
- **split:** merge offering the create/merge switch before the folder is chosen (#297)
- **merge-folder:** keep same-named folders separate by path (re #296 - \[FR\] `Folder names to keep separate` adjustment)
- **reorder-headings:** number headings the way folders and notes are numbered (re #295 - \[FR\] Reorder Headings Enhancement)
- **reorder-headings:** move headings under a different parent (re #295 - \[FR\] Reorder Headings Enhancement)
- **rename-folder:** merge several folder note aliases per template (re #294 - \[FR\] Allow folder note aliases to enter multiple `aliases`)

### Documentation

- merge updating five JSDoc links whose targets were renamed or removed

## 5.12.0

This release has 10 new features, 13 fixes and 11 documentation changes. 20 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **settings:** merge moving each command menus section onto its command page (#278)
- **settings:** merge folding the strategies group into Common (re #275 - \[FR\] Settings Enhancement)
- **paths:** merge letting commands run on a path the content filter excludes (#288)
- **select:** merge resuming a live selection instead of dropping it (#287)
- **templates:** merge `Templater` in the split and folder-note templates (#284)
- **create-note:** merge typed-name cleaning for the create-empty-note commands (#283)
- **settings:** merge nested settings sections (#282)
- **merge:** keep named folders out of a same-named destination folder (#267)
- **split:** keep create/merge reachable and enrich the naming box (#280)
- **move:** auto-number what a move or a flatten relocates (#273)

### Fixed

- **release-notes:** merge waiting for the settings before deciding what was shown (#293)
- **split:** merge keeping the title a split template writes on a new note (re #276 - \[BUG\] `{{index}}` doesn't work in properties)
- merge keeping the editor focused after every extract-notice click (re #263 - \[FR\] Continuous clicking on notification should keep highlighting the selection)
- **merge:** merge merging a folder into its destination, not beneath it
- **deps:** merge restoring the lockfile's missing resolved and integrity fields
- **split:** merge gating the folder-then-name pair on the effective mode
- **links:** merge keeping heading and block links pointing at their target through a split (#291)
- **progress:** merge making Cancel roll an operation back whole (#289)
- **release-notes:** merge naming the plugin in the release notes popup (#286)
- **settings:** merge keeping an emptied folder-note property template empty (#285)
- **confirm-dialog:** merge the single action row restoration (#281)
- **reorder:** keep a folder's contents reorderable when only the folder is excluded (#279)
- **deps:** float devalue to 5.9.4, clearing GHSA-9rgm-9g3h-6x36

### Documentation

- **screenshots:** merge recapturing the recursive-split mobile frames
- **settings:** merge naming the commands the strategies heading leaves out
- **settings:** merge the Attachment extensions pointer to the path lists (#290)
- **agents:** correct the stale raiseSoftKeyboard warning in the keyboard notes
- **settings:** record why the two root setting groups stay at the root (#274)
- replace the private rule-id citations with what they assert
- name the library and the sibling plugins so a reader can resolve them
- replace the private tracker references with what they pointed at
- record why the rename-heading frame does not raise the soft keyboard
- say where the debug command is run
- **agents:** record where the picker's spellcheck rule now lives

## 5.11.0

This release has 12 new features, 9 fixes and 3 documentation changes. 14 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **settings:** merge the title page into the frontmatter page (#272)
- **paths:** move each include/exclude list under its own command (#271)
- **paths:** narrow the content filter per command category (#270)
- **split:** auto-number the notes or folders a split creates (#269)
- **split:** spell-check the picker box while it names a note
- **select:** selection-only commands and the Selection anchor pair (#266)
- **split-picker:** ask for the folder before the name, with no suggestions (#261)
- **create:** hide `Create empty note at cursor...` while a selection is active (#265)
- **split-picker:** keep the cursor in the box when the mode is flipped (#260)
- **split-picker:** keep the create/merge switch out of the override setting (#258)
- **create:** let `Create empty note in folder...` honor `Should split into folder` (#255)
- **commands:** choose each command's context menu one command at a time (#254)

### Fixed

- **build:** wire build:compile to buildCompile and drop the duplicate leaf script
- **deps:** move to `obsidian-integration-testing` 11 and `obsidian-dev-utils` 96.5.2
- **deps:** drop the brace-expansion file: override that breaks a clean install
- **notices:** put the user back in the editor when the destination link is clicked (#263)
- **split-picker:** always remember the last create/merge mode (#264)
- **split-picker:** put the cursor in the box when the picker opens (#262)
- **split-picker:** choose an existing note clicked while nothing is typed (#257)
- **pickers:** rank a completed target and a note you opened by which came last (#256)
- **merge:** give excluded merge destinations their own setting (#253)

### Documentation

- name the unversioned demo-vault asset and the folder it unzips into
- **agents:** record refreshSpellcheck and de-stale the spell-check note
- point plugin-directory links at community.obsidian.md

## 5.10.1

This release has 1 fix and 1 documentation change.

### Fixed

- **test:** stop the multi-line name-transform test reading other tests' notices

### Documentation

- **demo-vault:** unwrap the notes so Obsidian stops rendering a break per line

## 5.10.0

This release has 15 new features, 6 fixes and 4 documentation changes. 11 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **commands:** offer each command category on the readable-line-length margin (#252)
- **commands:** narrow command blocking to one category at a time (#249)
- **split:** apply the split template to the create-empty-note commands (#244)
- **split:** remember the last used create/merge mode behind a setting
- **pickers:** let the picker recency order be chosen, rather than fixed (#248)
- **ui:** offer a progress dialog that blocks the vault until the work is done (#247)
- **split:** hand an extract's destination note to `Custom Attachment Location` (#246)
- **split:** create an empty note from an empty extract (#244)
- **settings:** move the lock-all-notes row to the smart cut & paste page (#243)
- **settings:** hide every per-operation override when the UI setting is off (#242)
- **settings:** flatten the swap settings page (#241)
- **settings:** give each merge command its own settings header (#240)
- **split:** carry a heading's own attachments into the note it creates
- **prompt:** spell-check the name prompts, following the vault's Spellcheck setting (#233)
- **notices:** open a folder's folder note when its notice link is clicked

### Fixed

- override deepmerge-ts to clear GHSA-ggr8-5vv4-36mx
- **merge-folder:** make the excluded-items setting reach the folder picker
- **split-picker:** require a name before a new note can be placed (#238)
- **split-picker:** clear the heading name when the switch is set to merge (#237)
- **split-picker:** keep the create/merge switch clear of the minimize button (#236)
- **operation-notices:** name the notes a batch split created (#235)

### Documentation

- **agents:** record CommandMenuPlacement and the two editor context menus
- **readme:** match the `GitHub` rendering on Obsidian's plugin page (#251)
- show the screenshots in the README
- capture the community-store screenshot set

## 5.9.2

This release has 1 new feature and 1 fix.

### New

- **notices:** land the extract notice link on the extracted content and reveal the file

### Fixed

- **demo-vault:** stop committing the app.json settings `obsidian-dev-utils` owns

## 5.9.1

This release has 7 new features, 4 fixes and 2 documentation changes. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **demo-vault:** migrate to `obsidian-dev-utils` 93.3.1 and adopt the authoring convention
- **split:** add a `Create`/`Merge` switch to the split/extract picker (#227)
- **templates:** resolve the `Create folder with notes` folder tokens in the note templates (#227)
- **smart-cut:** mark a whole heading for smart cut & paste (#229)
- **split:** add `Split heading recursively...` scoped to the cursor's heading (#228)
- **settings:** reorganize the settings tab into pages (#220-#226)
- \[FR\] `Rename` Model that updates `folder name`, `title`, and `aliases` (#217)

### Fixed

- **flatten-folder:** keep judging the nesting rule under an attachment plugin (#230)
- **prompt:** show the red invalid outline only after Create is clicked (#219)
- **name-transform:** find a templater context note instead of demanding an open one
- **reorder:** drag a row and it actually moves

### Documentation

- make the demo vault the documentation, in the standard layout
- **agents:** record the #230 synchronous nesting gate in the flatten-items notes

## 5.9.0

This release has 4 new features and 3 fixes. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **reorder:** reorder a folder's contents, renumbering names and folder-note titles (#216)
- **create-folder:** make the confirmation dialog's rename buttons optional (#214)
- **merge-folder:** open the result after a folder merge (#212, #215)
- **flatten-folder:** hide a flatten variant that duplicates a simpler one (#210)

### Fixed

- **smart-cut:** stop the marked-selection notice from throwing on dev-utils 93
- **merge-into-single-file:** close the tabs of the merged-away notes in one pass (#212)
- **flatten-folder:** ignore the attachment setting a plugin has taken over (#213)

## 5.8.0

This release has 5 new features and 3 fixes. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **recent-suggestions:** count a completed operation's target as clicked-on (#206)
- **modals:** show the minimize button on every confirmation menu (#201)
- **confirm-dialog:** rename the folder and each note from `Create folder with notes...` (#200)
- **confirm-dialog:** make `Change target` work on every confirmation menu (#205, #199)
- **settings:** split command blocking out of Exclude paths (#198)

### Fixed

- **merge-folder-into-file:** hide the command for folders with fewer than two notes (#209)
- **merge-folder-into-file:** order numbered notes and folders naturally (#208)
- **name-transform:** refuse a multi-line name and say why (#203)

## 5.7.0

This release has 4 new features, 2 fixes and 2 documentation changes.

### New

- **demo-vault:** install `Templater` from the note that needs it
- **create-folder:** make a template's own property writes survive the render (#197)
- **name-transform:** define your own replacements via a template (#196)
- **create-folder:** resolve the palette's destination from Obsidian's setting (#194)

### Fixed

- **create-folder:** declare TOKENS first, so it works in a note's frontmatter (#197)
- **prompt:** show the empty-name error only after Create is clicked (#195)

### Documentation

- narrow the overstated processFrontMatter claim to the flows it applies to
- **demo-vault:** show how to split a name into several aliases (#197)

## 5.6.1

This release has 2 new features. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **flatten:** protect excluded items and the configured attachment folder
- add `Create folder with notes...` command (#191)

## 5.6.0

This release has 1 fix and 1 documentation change.

### Fixed

- The two folder-only flatten commands no longer appear on a folder whose only child (#185)

### Documentation

- describe flatten as three commands, not a Flatten mode setting

## 5.5.0

This release has 1 new feature.

### New

- Hide `Extract this heading...` and `Split note by headings recursively...` (#188)

## 5.4.0

This release has 1 new feature and 2 fixes.

### New

- \[FR\] Current note should not show up as when `split/extract` search (#184)

### Fixed

- \[BUG\] File is renamed when `Inside the folder` option is clicked (#186)
- \[BUG\] Property Order is switched when a property value is moved to another note (#187)

## 5.3.1

This release has 4 new features and 4 fixes. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- re #183
- show a progress and completion notice for every operation (#182)
- \[FR\] Allow `flatten children` and `flatten recursively` to both appear as options on right click context menu (#177)
- \[FR\] Option to not move file, after merging all folder items to a single file (#178)

### Fixed

- build fresh command handler instances on every factory call
- **test:** build the command handlers through the registered factory
- Folder-to-heading merge no longer emits a heading for a sub-folder that (#181)
- \[FR\] Move line down after clicking `move to top of file` & Create new line at the end after clicking `move to bottom of file` (#179)

## 5.3.0

This release has 1 new feature. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- re #175 re #176

## 5.2.0

This release has 6 new features and 2 fixes.

### New

- \[FR\] Unification of `merge` and `smart cut and paste` templates (#174)
- \[FR\] Setting to place the the recursive splits in Obsidian defined folder (#173)
- \[FR\] `Recursive Split` Should use the split template (#172)
- re #170 re #171
- \[FR\] `Merge into a single file` keep current folder, delete children folders (#167)
- \[FR\] When moving folder the destination should be clickable (#165)

### Fixed

- \[BUG\] Converting to headers is not working correctly (#168)
- \[BUG\] Clicking note confirmation will create the note on merge into single file (#166)

## 5.1.0

This release has 1 breaking change, 7 new features, 3 fixes and 2 documentation changes. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Breaking changes

- **attachments:** configure real extensions instead of markdown sub-extensions

### New

- **merge:** make attachments follow a merged note (re #161)
- **merge-folder:** enhance Merge folder contents into a single file (re #160, re #161)
- per-direction jump-to-moved-content settings (re #144)
- ask before flattening and moving folders (re #154)
- split note by headings recursively (re #79)
- predefine the note name for folder splits (re #153)
- split headings automatically (re #79)

### Fixed

- **settings:** report an invalid path regular expression instead of ignoring it (re #155)
- **merge-folder:** stop clamping folder headings at six levels (re #160)
- offer the folder you are on first in the folder pickers (re #158)

### Documentation

- fix the demo vault download instructions
- explain the path-string vs regular-expression forms of Include/Exclude paths (re #159)

## 5.0.0

This release has 11 new features, 3 fixes and 1 documentation change. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- split into folder (re #79)
- merge multiple selected files into one file (re #92)
- merge folder contents into a single file (re #92)
- add Rename heading command that updates nested-subpath links (re #111)
- add swap confirmation dialog (re #74)
- gate split-by-headings menu items on the selected heading level (re #94)
- block commands on excluded paths (re #93)
- always-merge-excluded-items setting (re #150)
- recent folders in the move-folder picker (re #149)
- swap button in the smart cut & paste notice (re #148)
- reorder nested headings (re #147)

### Fixed

- skip vanished backlink sources when fixing backlinks
- don't cycle the active leaf on folder merge (re #106)
- move the cursor to the moved content for smart cut & paste (re #144)

### Documentation

- demo folder commands, reorder and swap-selection in demo vault (re #105, #73, #103, #108)

## 4.0.0

This release has 6 new features and 3 fixes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- \[FR\] Reorder Headers (#103)
- \[FR\] Swap selection/header (#108)
- \[FR\] Better Move Folder to... Command (#73)
- \[FR\] Flatten Folder (#105)
- \[FR\] {{parentFolder}} variable (#89)
- \[FR\] Make current “Extract this heading” command work in body (#143)

### Fixed

- \[BUG\] Splash Page since last update (#95)
- \[BUG\] First extract selection causes some sort of refresh in the background (#102)
- \[BUG\] Merge Folder Bug with `tldraw` file (#72)

## 3.35.0

This release has 1 new feature. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- \[FR\] Extract between Horizontal Rules '---' or (#113)

## 3.34.9

This release has 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- \[BUG\] title property gets deleted when child (#114)

## 3.34.8

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.34.7

This release has 1 fix and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- \[BUG\] Enter button creates sound on folder model (#142)

### Documentation

- rewrite

## 3.34.6

This release has 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **demo-vault:** export invoke() from startup script; add Invocables folder

## 3.34.5

This release has 2 new features and 4 documentation changes.

### New

- number demo vault example notes
- add demo vault

### Documentation

- standardize demo-vault README
- drop per-plugin demo-vault setup notes (bootstrap covered by `obsidian-dev-utils` harness)
- renumber demo-vault setup notes
- reconcile the demo vault helper description with the injected helper

## 3.34.4

This release has 1 fix.

### Fixed

- \[BUG\] Note switches when switch to smart/cut and (#141)

## 3.34.3

This release has 1 fix and 1 documentation change.

### Fixed

- \[BUG\] None of the smart buttons work on smart (#140)

### Documentation

- update

## 3.34.2

This release has 1 new feature.

### New

- \[FR\] A way around clicking the notice (#137)

## 3.34.1

This release has 1 new feature, 1 fix and 2 documentation changes.

### New

- \[FR\]  UI setting to remove minimization and x button of a Advanced note composer command with no selection (#125)

### Fixed

- \[FR\] Add search button to smart cut and paste (#136)

### Documentation

- fix link
- migrate to AGENTS.md

## 3.34.0

This release has 3 new features, 1 fix and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- re #131
- \[FR\] Allow user to define different template for cursor insertions (#138)
- \[FR\] UI setting to hide Move marked selection to top of file (#139)

### Fixed

- \[BUG\] Unlock button still doesn't work on extract selection (#130)

### Documentation

- update

## 3.33.0

This release has 2 new features, 1 fix and 1 other change. 5 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- `Smart cut & paste` UX improvements
- Originally requested: (#127)

### Fixed

- \[BUG\] Minimize button can be infinitely cast (#126)

### Other changes

- Merge branch 'issue-129'

## 3.32.0

This release has 1 new feature.

### New

- move selection to another note re #97 #100

## 3.31.0

This release has 1 new feature.

### New

- re #119

## 3.30.1

This release has 1 fix and 1 documentation change.

### Fixed

- \[BUG\] Transparent Button (#124)

### Documentation

- fix changelog wrong ref

## 3.30.0

This release has 1 new feature.

### New

- re #121

## 3.29.0

This release has 1 new feature.

### New

- \[FR\] Keep title property when there is no new (#123)

## 3.28.0

This release has 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- \[BUG\] Random Dialog box at the very end of (#122)

## 3.27.0

This release has 1 fix and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- preserve context when splitting/merging, even if the editor changed #120

### Documentation

- drop completed session-progress notes

## 3.26.12

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.11

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.10

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.9

This release has 1 fix. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- restrict merge-file command to markdown files

## 3.26.8

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.7

This release has maintenance changes only. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

## 3.26.6

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.5

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.4

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.3

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.26.2

This release has 1 fix.

### Fixed

- exclude root folder from merge/swap re #104

## 3.26.1

This release has 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- safe trash re #107

## 3.26.0

This release has 3 new features and 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- show confirms for split by heading commands
- remove new split file is cancelled
- shouldAskBeforeSplitting re #77

### Fixed

- correct button caption

## 3.25.0

This release has 1 new feature.

### New

- shouldAddCommandsToSubmenu re #86

## 3.24.0

This release has 1 new feature.

### New

- additional explanation for `Should allow split into unresolved path` re #85

## 3.23.0

This release has 1 new feature.

### New

- additional explanation for `Should treat title as path` re #84

## 3.22.0

This release has 1 new feature.

### New

- shouldOpenTargetNoteAfterSplit re #78

## 3.21.0

This release has 2 new features and 2 fixes. 36 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- improve captions
- extract submenu

### Fixed

- don't confirm after clicking checkbox
- wrong title

## 3.20.0

This release has 1 new feature. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- restructure/reword settings re #82 #81

## 3.19.1

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.19.0

This release has 1 new feature and 1 fix.

### New

- rewrite swap re #71

### Fixed

- change setting title re #68

## 3.18.0

This release has 3 new features and 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- allow excluding child/parent paths re #68
- check source path for ignored
- swap command re #69

### Fixed

- improve subfolder merging re #70

## 3.17.0

This release has 4 new features and 2 fixes. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- check source folder for ignores
- filter excluded folders re #60
- add links to folders
- add warning re #61

### Fixed

- change setting only on Merge click
- mobile dialog

## 3.16.0

This release has 1 new feature. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- rewrite recursive merge to preserve links / fix: carefully merge into sub/superfolder / re #64 #65 #62

## 3.15.2

This release has 1 fix.

### Fixed

- clean UI re #67

## 3.15.1

This release has 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- exclude current recent folder re #66

## 3.15.0

This release has 1 fix.

### Fixed

- merging with subfolders re #62

## 3.14.0

This release has 1 new feature.

### New

- show recent folders first

## 3.13.1

This release has 1 fix.

### Fixed

- don't merge non-md

## 3.13.0

This release has 2 new features. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- implement merge folder re #25
- add MergeFolderCommand

## 3.12.0

This release has 1 new feature.

### New

- split frontmatter as text for KeepOriginalFrontmatter re #58

## 3.11.0

This release has 1 new feature.

### New

- add frontmatterTitleMode setting re #56 #55

## 3.10.1

This release has 1 new feature.

### New

- ignore `Keep original frontmatter` setting when splitting into a new file re #54 #53

## 3.10.0

This release has 1 new feature. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add setting splitToExistingFileTemplate re #52 #51

## 3.9.0

This release has 2 new features and 2 fixes.

### New

- add splitTemplate re #50
- setting shouldKeepHeadingsWhenSplittingContent re #38

### Fixed

- extracting content under Setext heading
- extracting first symbol after heading

## 3.8.0

This release has 2 new features.

### New

- add merge modal hotkeys
- delay before open re #32

## 3.7.0

This release has 1 new feature. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add progress bar re #33

## 3.6.0

This release has 2 new features. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- add source/target clickable links re #49
- enable `Templater` re #37

## 3.5.7

This release has 1 fix.

### Fixed

- disable files menu re #47

## 3.5.6

This release has 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- parse frontmatter safely re #48

## 3.5.5

This release has maintenance changes only. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

## 3.5.4

- fix: remove recent paths duplicates
- fix: broke links to itself after merge
- fix: don't treat manual split as merge
  - re 39

## 3.5.3

This release has 1 fix.

### Fixed

- change links message to Updated

## 3.5.2

This release has 1 new feature and 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- show links updates notice

### Fixed

- handle formats re #45

## 3.5.1

- fix: handling include/exclude paths not ending with /
  - re #46

## 3.5.0

- chore: spellcheck
- fix: include only markdown files
  - re #43
- chore: update libs
- feat: add include/exclude paths
  - re #44

## 3.4.1

This release has 1 new feature.

### New

- add extra line

## 3.4.0

This release has 1 new feature and 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- more readable merge dialog re #41

### Fixed

- compilation

## 3.3.0

- feat: add {{fromPath}}, {{newPath}} tokens
- feat: show full path of merged notes
  - re #40

## 3.2.0

- feat: add console.debug
  - ref #35

## 3.1.1

- chore: update libs
- docs: better section Treat title as path
- docs: treat title as path documentation
  - fix 28

## 3.1.0

- feat: add support for template in frontmatter
  - fix #30
- fix: code highlighter tokens

## 3.0.0

This release has 5 new features and 5 fixes. 8 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add release notes
- add dropdown
- merge frontmatters
- reorder dropdown options
- remove dependency from core plugin

### Fixed

- remove keys from correct frontmatter
- key
- cancel button
- close dialog on merge
- renamed fields

## 2.2.1

This release has 1 other change.

### Other changes

- Exclude source file from selector (#23)

## 2.2.0

This release has 1 other change.

### Other changes

- Change/hide rendering of unresolved links (#22)

## 2.1.1

This release has 3 other changes.

### Other changes

- Fix file parts (#21)
- Use split placeholder
- Ensure unresolved links filter shouldAllowOnlyCurrentFolder (#20)

## 2.1.0

This release has 1 other change.

### Other changes

- Add Extract before/after cursor (#19)

## 2.0.1

- Minor changes

## 2.0.0

This release has 1 other change.

### Other changes

- Add should merge headings

## 1.13.0

This release has 1 other change.

### Other changes

- Remove unused / restore used extracted footnotes (#18)

## 1.12.0

This release has 1 other change.

### Other changes

- Should hide core plugin menu items (#17)

## 1.11.2

This release has 1 other change.

### Other changes

- Fix empty filename failure (#16)

## 1.11.1

- Minor changes

## 1.11.0

This release has 3 other changes.

### Other changes

- Should allow only current folder
- Preserve title
- Change wording and hotkeys

## 1.10.1

- Minor changes

## 1.10.0

- Fix footnotes (#12)

## 1.9.6

- Minor changes

## 1.9.5

- Minor changes

## 1.9.4

- Rerelease

## 1.9.3

- Minor changes

## 1.9.2

This release has 1 other change.

### Other changes

- Fix link source (#10)

## 1.9.1

- Minor changes

## 1.9.0

This release has 1 other change.

### Other changes

- Add command to split heading content

## 1.8.2

- Minor changes

## 1.8.1

- Minor changes

## 1.8.0

This release has 1 other change.

### Other changes

- shouldOpenNoteAfterMerge

## 1.7.1

This release has 1 other change.

### Other changes

- Change links only for merges

## 1.7.0

This release has 2 other changes.

### Other changes

- Ensure wikilinks are renamed
- Support links without subpath

## 1.6.0

- Skip update links. As it's already done earlier

## 1.5.0

This release has 1 other change.

### Other changes

- Handle titles with period

## 1.4.5

- Improve performance

## 1.4.4

- Minor changes

## 1.4.3

- Minor changes

## 1.4.2

- Minor changes

## 1.4.1

This release has 1 other change.

### Other changes

- New template

## 1.4.0

This release has 2 other changes.

### Other changes

- Add alias if duplicate created
- Add extract by headings

## 1.3.0

This release has 1 other change.

### Other changes

- Allow include frontmatter

## 1.2.0

This release has 1 other change.

### Other changes

- Update links in memory

## 1.1.0

This release has 1 other change.

### Other changes

- Fix backlinks

## 1.0.0

- Initial release
