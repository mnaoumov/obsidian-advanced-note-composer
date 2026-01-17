# CHANGELOG

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
