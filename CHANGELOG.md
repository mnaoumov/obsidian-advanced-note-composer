# CHANGELOG

## 5.10.1

- fix(test): stop the multi-line name-transform test reading other tests' notices
- docs(demo-vault): unwrap the notes so Obsidian stops rendering a break per line

## 5.10.0

- chore: lint
- chore: lint
- test: pin that loading the plugin creates no leaf (#250)
- docs(agents): record CommandMenuPlacement and the two editor context menus
- feat(commands): offer each command category on the readable-line-length margin (#252)
- chore: update libs
- docs(readme): match the GitHub rendering on Obsidian's plugin page (#251)
- feat(commands): narrow command blocking to one category at a time (#249)
- feat(split): apply the split template to the create-empty-note commands (#244)
- feat(split): remember the last used create/merge mode behind a setting
- chore: update obsidian-dev-utils to 94.6.1
- chore: update obsidian-dev-utils to 94.6.0
- fix: override deepmerge-ts to clear GHSA-ggr8-5vv4-36mx
- feat(pickers): let the picker recency order be chosen, rather than fixed (#248)
- feat(ui): offer a progress dialog that blocks the vault until the work is done (#247)
- feat(split): hand an extract's destination note to Custom Attachment Location (#246)
- test: gate the demo vault by clicking every code button
- feat(split): create an empty note from an empty extract (#244)
- feat(settings): move the lock-all-notes row to the smart cut & paste page (#243)
- chore: teach cspell the advisory wording
- chore: update libs
- fix(merge-folder): make the excluded-items setting reach the folder picker
- feat(settings): hide every per-operation override when the UI setting is off (#242)
- feat(settings): flatten the swap settings page (#241)
- docs: show the screenshots in the README
- feat(settings): give each merge command its own settings header (#240)
- docs: capture the community-store screenshot set
- feat(split): carry a heading's own attachments into the note it creates
- fix(split-picker): require a name before a new note can be placed (#238)
- fix(split-picker): clear the heading name when the switch is set to merge (#237)
- fix(split-picker): keep the create/merge switch clear of the minimize button (#236)
- fix(operation-notices): name the notes a batch split created (#235)
- refactor(folder-note): dissolve the local folder-note code onto dev-utils 94.2.0
- test(merge-suites): make a stalled folder merge report why it stalled
- feat(prompt): spell-check the name prompts, following the vault's Spellcheck setting (#233)
- feat(notices): open a folder's folder note when its notice link is clicked

## 5.9.2

- fix(demo-vault): stop committing the app.json settings obsidian-dev-utils owns
- feat(notices): land the extract notice link on the extracted content and reveal the file

## 5.9.1

- docs: make the demo vault the documentation, in the standard layout
- feat(demo-vault): migrate to obsidian-dev-utils 93.3.1 and adopt the authoring convention
- test(merge-suites): stop the folder-merge suites dying on the 30 s CDP cap
- test(modals): pin the modal keyboard paths and drop the dead Escape handlers
- docs(agents): record the #230 synchronous nesting gate in the flatten-items notes
- fix(flatten-folder): keep judging the nesting rule under an attachment plugin (#230)
- feat(split): add a `Create`/`Merge` switch to the split/extract picker (#227)
- feat(templates): resolve the `Create folder with notes` folder tokens in the note templates (#227)
- feat(smart-cut): mark a whole heading for smart cut & paste (#229)
- feat(split): add `Split heading recursively...` scoped to the cursor's heading (#228)
- fix(prompt): show the red invalid outline only after Create is clicked (#219)
- feat(settings): reorganize the settings tab into pages (#220-#226)
- fix(name-transform): find a templater context note instead of demanding an open one
- feat: re #217
- fix(reorder): drag a row and it actually moves

## 5.9.0

- chore: update libs
- fix(smart-cut): stop the marked-selection notice from throwing on dev-utils 93
- chore: overexposed
- chore: update libs
- feat(reorder): reorder a folder's contents, renumbering names and folder-note titles (#216)
- fix(merge-into-single-file): close the tabs of the merged-away notes in one pass (#212)
- feat(create-folder): make the confirmation dialog's rename buttons optional (#214)
- fix(flatten-folder): ignore the attachment setting a plugin has taken over (#213)
- feat(merge-folder): open the result after a folder merge (#212, #215)
- feat(flatten-folder): hide a flatten variant that duplicates a simpler one (#210)

## 5.8.0

- test(integration): restore the fixtures the two-note merge guard broke (#209)
- fix(merge-folder-into-file): hide the command for folders with fewer than two notes (#209)
- test(modals): pin that a background click minimizes a confirmation (#202)
- chore: update libs
- fix(merge-folder-into-file): order numbered notes and folders naturally (#208)
- feat(recent-suggestions): count a completed operation's target as clicked-on (#206)
- fix(name-transform): refuse a multi-line name and say why (#203)
- feat(modals): show the minimize button on every confirmation menu (#201)
- feat(confirm-dialog): rename the folder and each note from `Create folder with notes...` (#200)
- feat(confirm-dialog): make `Change target` work on every confirmation menu (#205, #199)
- feat(settings): split command blocking out of Exclude paths (#198)

## 5.7.0

- docs: narrow the overstated processFrontMatter claim to the flows it applies to
- feat(demo-vault): install Templater from the note that needs it
- feat(create-folder): make a template's own property writes survive the render (#197)
- fix(create-folder): declare TOKENS first, so it works in a note's frontmatter (#197)
- docs(demo-vault): show how to split a name into several aliases (#197)
- fix(prompt): show the empty-name error only after Create is clicked (#195)
- feat(name-transform): define your own replacements via a template (#196)
- feat(create-folder): resolve the palette's destination from Obsidian's setting (#194)

## 5.6.1

- chore(flatten): exempt the unreachable parent-less guard from coverage
- chore: update libs and adopt obsidian-integration-testing 10
- feat(flatten): protect excluded items and the configured attachment folder
- feat: add `Create folder with notes...` command (#191)

## 5.6.0

- fix: re #185
- docs: describe flatten as three commands, not a Flatten mode setting

## 5.5.0

- feat: re #188

## 5.4.0

- feat: re #184
- fix: re #186
- fix: re #187

## 5.3.1

- fix: build fresh command handler instances on every factory call
- chore: update libs
- fix(test): build the command handlers through the registered factory
- feat: re #183
- chore: update libs
- feat: show a progress and completion notice for every operation (#182)
- fix: re #181
- chore(vitest): adopt the shared Obsidian plugin vitest configuration
- feat: re #177
- feat: re #178
- fix: re #179
- refactor(prism): register the template language through ODU's SyntaxHighlightingComponent

## 5.3.0

- refactor(settings): move the settings tab onto the declarative settings API
- feat: re #175 re #176
- chore: update libs and clear the npm audit

## 5.2.0

- feat: re #174
- feat: re #173
- feat: re #172
- feat: re #170 re #171
- fix: re #168
- feat: re #167
- fix: re #166
- feat: re #165

## 5.1.0

- refactor: stop exporting the test-only trailing-dots regular expression
- docs: fix the demo vault download instructions
- fix(settings): report an invalid path regular expression instead of ignoring it (re #155)
- feat(attachments)!: configure real extensions instead of markdown sub-extensions
- test: drop the hand-seeded attachment-path surface now that the mocks model it
- fix(merge-folder): stop clamping folder headings at six levels (re #160)
- feat(merge): make attachments follow a merged note (re #161)
- feat(merge-folder): enhance Merge folder contents into a single file (re #160, re #161)
- docs: explain the path-string vs regular-expression forms of Include/Exclude paths (re #159)
- fix: offer the folder you are on first in the folder pickers (re #158)
- feat: per-direction jump-to-moved-content settings (re #144)
- feat: ask before flattening and moving folders (re #154)
- feat: split note by headings recursively (re #79)
- feat: predefine the note name for folder splits (re #153)
- feat: split headings automatically (re #79)

## 5.0.0

- fix: skip vanished backlink sources when fixing backlinks
- test: wait for the metadata cache before extracting between rules
- test: expect the Swap with selection button in the smart-cut notice
- chore: update libs
- feat: split into folder (re #79)
- feat: merge multiple selected files into one file (re #92)
- feat: merge folder contents into a single file (re #92)
- feat: add Rename heading command that updates nested-subpath links (re #111)
- fix: don't cycle the active leaf on folder merge (re #106)
- feat: add swap confirmation dialog (re #74)
- feat: gate split-by-headings menu items on the selected heading level (re #94)
- fix: move the cursor to the moved content for smart cut & paste (re #144)
- feat: block commands on excluded paths (re #93)
- feat: always-merge-excluded-items setting (re #150)
- feat: recent folders in the move-folder picker (re #149)
- feat: swap button in the smart cut & paste notice (re #148)
- feat: reorder nested headings (re #147)
- docs: demo folder commands, reorder and swap-selection in demo vault (re #105, #73, #103, #108)
- test: integration tests for folder commands and extract-heading (re #105, #73, #72, #143)

## 4.0.0

- chore: fix overexposed
- feat: re #103
- feat: re #108
- fix: re #95
- fix: re #102
- feat: re #73
- feat: re #105
- fix: re #72
- feat: re #89
- feat: re #143

## 3.35.0

- feat: re #113
- chore: update libs

## 3.34.9

- fix: re #114
- chore: update libs
- refactor: new endpoint

## 3.34.8

- chore: update libs

## 3.34.7

- docs: rewrite
- fix: re #142
- chore: update libs

## 3.34.6

- chore: update libs
- chore(demo-vault): drop committed Invocables placeholder
- fix(demo-vault): export invoke() from startup script; add Invocables folder

## 3.34.5

- docs: standardize demo-vault README
- docs: drop per-plugin demo-vault setup notes (bootstrap covered by ODU harness)
- docs: renumber demo-vault setup notes
- feat: number demo vault example notes
- docs: reconcile the demo vault helper description with T95
- feat: add demo vault

## 3.34.4

- fix: re #141

## 3.34.3

- fix: re #140
- docs: update

## 3.34.2

- feat: re #137

## 3.34.1

- fix: re #136
- feat: re #125
- docs: fix link
- docs: migrate to AGENTS.md

## 3.34.0

- refactor: reuse EMPTY hack
- fix: re #130
- feat: re #131
- feat: re #138
- feat: re #139
- docs: update

## 3.33.0

- chore: overexposed
- chore: update libs
- refactor: drop app2 hack, use inherited protected app
- refactor: consume dev-utils 85 resource-lock unlock + release-on-abort
- refactor: better API
- Merge branch 'issue-129'
- feat: `Smart cut & paste` UX improvements
- fix: re #126
- feat: re #127

## 3.32.0

- feat: move selection to another note re #97 #100

## 3.31.0

- feat: re #119

## 3.30.1

- docs: fix changelog wrong ref
- fix: re #124

## 3.30.0

- feat: re #121

## 3.29.0

- feat: re #123

## 3.28.0

- fix: re #122
- test: wire integration-testing vitest-setup into integration projects
- chore: update libs

## 3.27.0

- chore: lint
- docs: drop completed session-progress notes
- fix: preserve context when splitting/merging, even if the editor changed #120

## 3.26.12

- refactor: new template

## 3.26.11

- refactor: notices

## 3.26.10

- chore: update libs

## 3.26.9

- chore: unify tsconfig
- test: use real obsidian-dev-utils implementations in unit tests
- test: drive real obsidian-dev-utils base classes via test-mocks bridge
- fix: restrict merge-file command to markdown files
- chore: add integration tests

## 3.26.8

- chore: update template

## 3.26.7

- chore: add attestation
- chore: update version script

## 3.26.6

- chore: update libs

## 3.26.5

- chore: update libs

## 3.26.4

- chore: update template

## 3.26.3

- chore: update template

## 3.26.2

- fix: exclude root folder from merge/swap re #104

## 3.26.1

- fix: safe trash re #107
- chore: update libs
- refactor: getSelections

## 3.26.0

- feat: show confirms for split by heading commands
- chore: lint
- fix: correct button caption
- feat: remove new split file is cancelled
- feat: shouldAskBeforeSplitting re #77

## 3.25.0

- feat: shouldAddCommandsToSubmenu re #86

## 3.24.0

- feat: additional explanation for `Should allow split into unresolved path` re #85

## 3.23.0

- feat: additional explanation for `Should treat title as path` re #84

## 3.22.0

- feat: shouldOpenTargetNoteAfterSplit re #78

## 3.21.0

- refactor: path settings
- chore: lint
- refactor: extractHeading
- refactor: switch visibility
- refactor: init ctors
- refactor: extract editor
- refactor: move initialization
- refactor: modal result classes
- refactor: getInsertModeFromEvent
- refactor: switch to InsertMode enum
- refactor: rename insertMode
- refactor: extract item selectors
- refactor: remove composer arg from modals
- refactor: extract composer props
- refactor: move init composer to split
- refactor: move init composer to merge
- refactor: remove doNotAskAgain
- refactor: prepareForMergeFile
- refactor: rename SplitFileModal
- refactor: extract mergeFile
- refactor: remove action
- refactor: extract separate composers
- refactor: rename ComposerBase
- refactor: extract Composers
- refactor: rename insertMode
- refactor: move selectItem
- refactor: extract prepareForSplitFile
- refactor: add app arg
- refactor: extract AdvancedNoteComposerOptions
- refactor: remove animation
- refactor: remove context
- refactor: remove DynamicModal
- fix: don't confirm after clicking checkbox
- fix: wrong title
- feat: improve captions
- refactor: modals to promises
- refactor: rename ConfirmDialogModalResult
- refactor: traverseBookmarks
- feat: extract submenu
- refactor: promise of MergeFolderModal

## 3.20.0

- feat: restructure/reword settings re #82 #81
- chore: update libs

## 3.19.1

- chore: update libs

## 3.19.0

- feat: rewrite swap re #71
- fix: change setting title re #68

## 3.18.0

- chore: lint
- feat: allow excluding child/parent paths re #68
- refactor: link
- fix: improve subfolder merging re #70
- feat: check source path for ignored
- feat: swap command re #69

## 3.17.0

- feat: check source folder for ignores
- feat: filter excluded folders re #60
- chore: spellcheck
- chore: lint
- fix: change setting only on Merge click
- fix: mobile dialog
- feat: add links to folders
- feat: add warning re #61

## 3.16.0

- feat: rewrite recursive merge to preserve links / fix: carefully merge into sub/superfolder / re #64 #65 #62
- chore: update libs

## 3.15.2

- fix: clean UI re #67

## 3.15.1

- chore: spellcheck
- fix: exclude current recent folder re #66

## 3.15.0

- fix: merging with subfolders re #62

## 3.14.0

- feat: show recent folders first

## 3.13.1

- fix: don't merge non-md

## 3.13.0

- feat: implement merge folder re #25
- refactor: move Modals
- feat: add MergeFolderCommand
- chore: update libs

## 3.12.0

- feat: split frontmatter as text for KeepOriginalFrontmatter re #58

## 3.11.0

- feat: add frontmatterTitleMode setting re #56 #55

## 3.10.1

- feat: ignore `Keep original frontmatter` setting when splitting into a new file re #54 #53

## 3.10.0

- chore: spellcheck
- feat: add setting splitToExistingFileTemplate re #52 #51
- refactor: enum Action

## 3.9.0

- feat: add splitTemplate re #50
- feat: setting shouldKeepHeadingsWhenSplittingContent re #38
- fix: extracting content under Setext heading
- fix: extracting first symbol after heading

## 3.8.0

- feat: add merge modal hotkeys
- feat: delay before open re #32

## 3.7.0

- chore: format
- chore: update libs
- feat: add progress bar re #33

## 3.6.0

- feat: add source/target clickable links re #49
- feat: enable Templater re #37
- chore: update libs

## 3.5.7

- fix: disable files menu re #47

## 3.5.6

- chore: update libs
- fix: parse frontmatter safely re #48

## 3.5.5

- chore: update libs
- chore: update libs

## 3.5.4

- fix: remove recent paths duplicates
- fix: broke links to itself after merge
- fix: don't treat manual split as merge
  - re 39

## 3.5.3

- fix: change links message to Updated

## 3.5.2

- chore: lint
- fix: handle formats re #45
- feat: show links updates notice

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

- feat: add extra line

## 3.4.0

- fix: compilation
- feat: more readable merge dialog re #41
- chore: update libs

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

- chore: add missing lint files
- feat: add release notes
- fix: remove keys from correct frontmatter
- feat: add dropdown
- fix: key
- fix: cancel button
- fix: close dialog on merge
- refactor: inline translations
- refactor: add SuggestModalCommandBuilder
- feat: merge frontmatters
- feat: reorder dropdown options
- refactor: clean comments
- feat: remove dependency from core plugin
- fix: renamed fields
- chore: enable markdownlint
- chore: enable conventional commits
- refactor: commands
- chore: lint

## 2.2.1

- Exclude source file from selector (#23)

## 2.2.0

- Change/hide rendering of unresolved links (#22)

## 2.1.1

- Fix file parts (#21)
- Use split placeholder
- Ensure unresolved links filter shouldAllowOnlyCurrentFolder (#20)

## 2.1.0

- Add Extract before/after cursor (#19)

## 2.0.1

- Minor changes

## 2.0.0

- Add should merge headings

## 1.13.0

- Remove unused / restore used extracted footnotes (#18)

## 1.12.0

- Should hide core plugin menu items (#17)

## 1.11.2

- Fix empty filename failure (#16)

## 1.11.1

- Minor changes

## 1.11.0

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

- Fix link source (#10)

## 1.9.1

- Minor changes

## 1.9.0

- Add command to split heading content

## 1.8.2

- Minor changes

## 1.8.1

- Minor changes

## 1.8.0

- shouldOpenNoteAfterMerge

## 1.7.1

- Change links only for merges

## 1.7.0

- Ensure wikilinks are renamed
- Support links without subpath

## 1.6.0

- Skip update links. As it's already done earlier

## 1.5.0

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

- New template

## 1.4.0

- Add alias if duplicate created
- Add extract by headings

## 1.3.0

- Allow include frontmatter

## 1.2.0

- Update links in memory

## 1.1.0

- Fix backlinks

## 1.0.0

- Initial release
