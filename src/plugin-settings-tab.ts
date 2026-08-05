import type { SettingDefinitionItem } from 'obsidian';
import type { PluginSettingsTabBaseConstructorParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import { getDebugController } from 'obsidian-dev-utils/debug';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';
import { EMPTY } from 'obsidian-dev-utils/string';

import type { PluginSettings } from './plugin-settings.ts';

import {
  Action,
  EmptyFolderBehaviorAfterMergingFolder,
  FrontmatterMergeStrategy,
  FrontmatterTitleMode,
  MergeFolderIntoFileLocation,
  SmartCutAndPasteCompletionFeedback,
  TextAfterExtractionMode
} from './plugin-settings.ts';
import { TOKENIZED_STRING_LANGUAGE } from './tokenized-string-language-component.ts';

interface PluginSettingsTabConstructorParams extends PluginSettingsTabBaseConstructorParams<PluginSettings> {
  readonly pluginId: string;
}

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  private readonly pluginId: string;

  public constructor(params: PluginSettingsTabConstructorParams) {
    super(params);
    this.pluginId = params.pluginId;
  }

  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingGroupEx({
        heading: 'Common',
        items: [
          this.settingEx({
            desc: 'Default setting for whether to allow only current folder for destination file selector. Can be changed in the merge/split modal dialog.',
            name: 'Should allow only current folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAllowOnlyCurrentFolderByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to show console debug messages.',
            name: 'Should show console debug messages',
            render: (setting) => {
              setting.addToggle((toggle) => {
                const debugController = getDebugController();
                const isEnabled = debugController.get().includes(this.pluginId);
                toggle.setValue(isEnabled);
                toggle.onChange((value) => {
                  if (value) {
                    debugController.enable(this.pluginId);
                  } else {
                    debugController.disable(this.pluginId);
                  }
                });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Merge/split/extract strategies',
        items: [
          this.settingEx({
            desc: 'Default setting for whether to fix footnotes. Can be changed in the merge/split modal dialog.',
            name: 'Should fix footnotes',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldFixFootnotesByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to merge headings. Can be changed in the merge/split modal dialog.',
            name: 'Should merge headings',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldMergeHeadingsByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default frontmatter merge strategy to use when merging notes. Can be changed in the merge/split modal dialog.');
              f.createEl('br');
              f.appendText('When merging frontmatter values from note A to note B:');
              f.createEl('br');
              appendCodeBlock(f, 'Merge and prefer new values');
              f.appendText(' - copy values from A to B that were not in B yet, and overwrite existing values in B with values from A.');
              f.createEl('br');
              appendCodeBlock(f, 'Merge and prefer original values');
              f.appendText(' - copy values from A to B that were not in B yet, and keep existing values in B.');
              f.createEl('br');
              appendCodeBlock(f, 'Keep original frontmatter');
              f.appendText(' - keep existing values in B, and ignore values from A.');
              f.createEl('br');
              appendCodeBlock(f, 'Replace with new frontmatter');
              f.appendText(' - remove existing values in B, and copy values from A to B.');
              f.createEl('br');
              appendCodeBlock(f, 'Preserve both original and new frontmatter');
              f.appendText(' - copies new frontmatter from A into a separate frontmatter key in B.');
            }),
            name: 'Frontmatter merge strategy',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [FrontmatterMergeStrategy.MergeAndPreferNewValues]: 'Merge and prefer new values',
                  [FrontmatterMergeStrategy.MergeAndPreferOriginalValues]: 'Merge and prefer original values',
                  [FrontmatterMergeStrategy.KeepOriginalFrontmatter]: 'Keep original frontmatter',
                  [FrontmatterMergeStrategy.ReplaceWithNewFrontmatter]: 'Replace with new frontmatter',
                  [FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter]: 'Preserve both original and new frontmatter'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'defaultFrontmatterMergeStrategy', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When merging, if the destination note (note B) has no ');
              appendCodeBlock(f, 'title');
              f.appendText(' property, use the ');
              appendCodeBlock(f, 'title');
              f.appendText(' from the merged-in note (note A) instead of leaving it empty.');
              f.createEl('br');
              f.appendText('When the destination note already has a ');
              appendCodeBlock(f, 'title');
              f.appendText(', it is always kept.');
            }),
            name: 'Should use source title when destination has none',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldUseSourceTitleWhenTargetHasNoTitle', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to run ');
              f.createEl('a', { href: 'https://silentvoid13.github.io/Templater/', text: 'Templater' });
              f.appendText(' on the destination file after merging/splitting.');
            }),
            name: 'Should run templater on destination file',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldRunTemplaterOnDestinationFile', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Title',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to replace invalid characters in the title.');
              f.createEl('br');
              f.appendText('If disabled, the error will be shown for invalid titles.');
            }),
            name: 'Should replace invalid characters',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({
                  onChanged: () => {
                    // Only the replacement-string row reads this value, through its `disabled` predicate.
                    this.refreshDomState();
                  },
                  propertyName: 'shouldReplaceInvalidTitleCharacters',
                  valueComponent: toggle
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('String to replace invalid characters with.');
              f.createEl('br');
              f.appendText('Leave blank to remove invalid characters.');
            }),
            disabled: () => !this.pluginSettingsComponent.settings.shouldReplaceInvalidTitleCharacters,
            name: 'Replacement string',
            render: (setting) => {
              setting.addText((text) => {
                this.bind({
                  propertyName: 'replacement',
                  shouldResetSettingWhenComponentIsEmpty: false,
                  valueComponent: text
                });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to add invalid title to the note alias.',
            name: 'Should add invalid title to note aliases',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAddInvalidTitleToNoteAlias', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('How to handle the title property in the frontmatter.');
              f.createEl('br');
              appendCodeBlock(f, 'None');
              f.appendText(' - do not add the title property to the frontmatter.');
              f.createEl('br');
              appendCodeBlock(f, 'Use for invalid title only');
              f.appendText(' - add the title property to the frontmatter only if the title is cannot be used as a filename.');
              f.createEl('br');
              appendCodeBlock(f, 'Use always');
              f.appendText(' - add the title property to the frontmatter always.');
            }),
            name: 'Frontmatter title mode',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [FrontmatterTitleMode.None]: 'None',
                  [FrontmatterTitleMode.UseForInvalidTitleOnly]: 'Use for invalid title only',
                  [FrontmatterTitleMode.UseAlways]: 'Use always'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'frontmatterTitleMode', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default setting for whether to treat title as path. Can be changed in the merge/split modal dialog.');
              f.createEl('br');
              f.appendText('If enabled, the title ');
              appendCodeBlock(f, 'foo/bar/baz');
              f.appendText(' will be treated as ');
              appendCodeBlock(f, 'foo/bar/baz.md');
              f.appendText(' path.');
              f.createEl('br');
              f.appendText('If disabled, the title ');
              appendCodeBlock(f, 'foo/bar/baz');
              f.appendText(' will be treated as ');
              appendCodeBlock(f, 'foo_bar_baz.md');
              f.appendText(' path.');
              f.createEl('br');
              f.appendText('When using ');
              appendCodeBlock(f, 'Split note by headings/content');
              f.appendText(' commands, the setting will be treated as disabled.');
            }),
            name: 'Should treat title as path',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldTreatTitleAsPathByDefault', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Merge',
        items: [
          this.settingEx({
            desc: 'Whether to open the note after merge.',
            name: 'Should open note after merge',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldOpenNoteAfterMerge', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to ask before merging notes.',
            name: 'Should ask before merging',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeMerging', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'When merging a folder, also move and merge items whose path is excluded/ignored in the plugin settings, instead of skipping them. When off (the default), excluded items are skipped and reported in a notice.',
            name: 'Should always merge excluded items',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAlwaysMergeExcludedItems', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When ');
              appendCodeBlock(f, 'Merge current file with another file...');
              f.appendText(' merges a note away, whether the attachments that note owns follow into the destination note\'s attachment folder.');
              f.createEl('br');
              f.appendText('The destination honors your vault\'s attachment settings, including ');
              /**
              HACK: see the TSDoc for {@link EMPTY} for motivation.
              */
              f.createEl('a', { href: 'https://github.com/mnaoumov/obsidian-custom-attachment-location', text: `${EMPTY}Custom Attachment Location` });
              f.appendText(' when it is installed.');
              f.createEl('br');
              f.appendText(
                'An attachment moves when the merged note references it and no other note does, or when it sits in an attachment folder belonging to that note alone. A shared attachment stays where it is.'
              );
              f.createEl('br');
              f.appendText('Also applies to ');
              appendCodeBlock(f, 'Merge these files into one file...');
              f.appendText('.');
            }),
            name: 'Should move attachments when merging a file',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldMoveAttachmentsWhenMergingFile', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Template to use when merging notes.');
              f.createEl('br');
              addAvailableTokens(f);
            }),
            name: 'Merge template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({
                  propertyName: 'mergeTemplate',
                  shouldResetSettingWhenComponentIsEmpty: true,
                  shouldShowPlaceholderForDefaultValues: false,
                  valueComponent: codeHighlighter
                });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Split/extract',
        items: [
          this.settingEx({
            desc: 'Whether to ask before splitting notes.',
            name: 'Should ask before splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeSplitting', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to open the target note after splitting.');
              f.createEl('br');
              f.appendText('If enabled, the target note will be opened after splitting.');
              f.createEl('br');
              f.appendText('If disabled, the source note will stay opened after splitting.');
            }),
            name: 'Should open target note after split',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldOpenTargetNoteAfterSplit', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When a split or extract creates a new note, put it inside a brand-new folder named after the note, so the note lands at ');
              appendCodeBlock(f, '<folder>/<note>/<note>.md');
              f.appendText(' instead of ');
              appendCodeBlock(f, '<folder>/<note>.md');
              f.appendText('.');
              f.createEl('br');
              f.appendText('The folder name is de-duplicated if one already exists. Splitting or extracting into an existing note is unaffected.');
            }),
            name: 'Should split into folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSplitIntoFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The name to give the new note inside the folder created by ');
              appendCodeBlock(f, 'Should split into folder');
              f.appendText('. It has no effect while that setting is off.');
              f.createEl('br');
              f.appendText('Leave empty to name the note after its folder, e.g. ');
              appendCodeBlock(f, '<folder>/<note>/<note>.md');
              f.appendText('. Set it to ');
              appendCodeBlock(f, 'Overview');
              f.appendText(' to get ');
              appendCodeBlock(f, '<folder>/<note>/Overview.md');
              f.appendText(' for every split instead.');
              f.createEl('br');
              f.appendText('The name the note would have had is kept as an alias and/or a frontmatter title, as configured by ');
              appendCodeBlock(f, 'Should add invalid title to note alias');
              f.appendText(' and ');
              appendCodeBlock(f, 'Frontmatter title mode');
              f.appendText(', so links to it keep resolving.');
              f.createEl('br');
              f.appendText('Tokens are resolved against the new note before it is moved, so ');
              appendCodeBlock(f, '{{newTitle}}');
              f.appendText(' is the folder name.');
              f.createEl('br');
              addAvailableTokens(f, false);
            }),
            name: 'Split into folder note name',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'splitIntoFolderNoteNameTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether heading-driven splits run immediately, with no target picker and no confirmation.');
              f.createEl('br');
              f.appendText('This covers ');
              appendCodeBlock(f, 'Split note by headings - H1');
              f.appendText('…');
              appendCodeBlock(f, 'H6');
              f.appendText(', their ');
              appendCodeBlock(f, 'content');
              f.appendText(' variants, and ');
              appendCodeBlock(f, 'Extract this heading...');
              f.appendText('. Each new note is named after its heading.');
              f.createEl('br');
              f.appendText('Combine with ');
              appendCodeBlock(f, 'Should split into folder');
              f.appendText(' to put every heading into its own folder named after it.');
              f.createEl('br');
              f.appendText('When disabled, these commands keep asking, as configured by ');
              appendCodeBlock(f, 'Should ask before splitting');
              f.appendText('.');
            }),
            name: 'Should split headings automatically',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSplitHeadingsAutomatically', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether ');
              appendCodeBlock(f, 'Split note by headings recursively...');
              f.appendText(' creates its notes in Obsidian\'s ');
              appendCodeBlock(f, 'Default location for new notes');
              f.appendText(' instead of beside the note being split. It affects no other command.');
              f.createEl('br');
              f.appendText('Only the top of the produced tree moves there: a sub-heading\'s note still lands inside its parent\'s folder, so ');
              appendCodeBlock(f, '# A');
              f.appendText(' / ');
              appendCodeBlock(f, '## B');
              f.appendText(' yields ');
              appendCodeBlock(f, '<default folder>/A/A.md');
              f.appendText(' and ');
              appendCodeBlock(f, '<default folder>/A/B/B.md');
              f.appendText('. The folder tree is kept — redirecting every note would flatten it away.');
              f.createEl('br');
              f.appendText('The note being split is not moved; it stays where it is and links down into the new tree.');
              f.createEl('br');
              f.appendText('This has no effect while Obsidian\'s own setting is ');
              appendCodeBlock(f, 'Same folder as current file');
              f.appendText(', which resolves to the behavior this setting replaces.');
            }),
            name: 'Should split recursively into the default new note folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSplitRecursivelyIntoDefaultNewNoteFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'What to show in place of the selected text after extracting it.',
            name: 'Text after extraction',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [TextAfterExtractionMode.LinkToNewFile]: 'Link to new file',
                  [TextAfterExtractionMode.EmbedNewFile]: 'Embed new file',
                  [TextAfterExtractionMode.None]: 'None'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'textAfterExtractionMode', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to apply the ');
              appendCodeBlock(f, 'Text after extraction');
              f.appendText(' setting when moving a selection within the same note.');
              f.createEl('br');
              f.appendText('When disabled, moving within the same note leaves nothing in place of the moved text, since a self-link would be meaningless.');
              f.createEl('br');
              f.appendText('This can still be overridden per move in ');
              appendCodeBlock(f, 'Move marked selection here (advanced)...');
              f.appendText('.');
            }),
            name: 'Apply text after extraction to the same file',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldApplyTextAfterExtractionToSameFile', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When you run ');
              appendCodeBlock(f, 'Mark selection to move');
              f.appendText(
                ', whether to lock every note (blocking edits) until the move is completed or cancelled, so you must finish the extraction before editing anything.'
              );
              f.createEl('br');
              f.appendText('When disabled, only the source note is locked.');
            }),
            name: 'Should lock all notes when marking selection',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldLockAllNotesWhenMarkingSelection', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to include frontmatter when splitting. Can be changed in the split modal dialog.',
            name: 'Should include frontmatter when splitting',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeFrontmatterWhenSplittingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default setting for whether to allow split into unresolved path. Can be changed in the split modal dialog.');
              f.createEl('br');
              f.appendText('Unresolved path comes from links like ');
              appendCodeBlock(f, '[[non-existing note]]');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Some plugins also call them as ');
              appendCodeBlock(f, 'broken links');
              f.appendText('.');
            }),
            name: 'Should allow split into unresolved path',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAllowSplitIntoUnresolvedPathByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Template to use when splitting notes into a new file.');
              f.createEl('br');
              f.appendText('Leave empty to reuse ');
              appendCodeBlock(f, 'Merge template');
              f.appendText(' setting.');
              f.createEl('br');
              addAvailableTokens(f);
            }),
            name: 'Split template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'splitTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: 'Template to use when splitting notes to existing file.',
            name: 'Split to existing file template',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  [Action.Merge]: 'Merge',
                  [Action.Split]: 'Split'
                });
                this.bind({ propertyName: 'splitToExistingFileTemplate', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to keep headings when splitting content.',
            name: 'Should keep headings when splitting content',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldKeepHeadingsWhenSplittingContent', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Swap',
        items: [
          this.settingEx({
            desc: 'Whether to show a confirmation dialog before swapping files or folders.',
            name: 'Should ask before swapping',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeSwapping', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Smart cut & paste',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show the notice after you run ');
              appendCodeBlock(f, 'Mark selection to move');
              f.appendText('. The notice reminds you a selection is marked and offers buttons to move or cancel it.');
              f.createEl('br');
              f.appendText('When disabled, no notice is shown; you drive the move and cancel purely through the commands (and their hotkeys).');
            }),
            name: 'Should show smart cut & paste notice',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowSmartCutNotice', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show the ');
              appendCodeBlock(f, 'Move marked selection to top of file');
              f.appendText(' button in the smart cut & paste notice.');
              f.createEl('br');
              f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
            }),
            name: 'Should show move to top of file button',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowMoveToTopButton', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show the ');
              appendCodeBlock(f, 'Move marked selection to bottom of file');
              f.appendText(' button in the smart cut & paste notice.');
              f.createEl('br');
              f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
            }),
            name: 'Should show move to bottom of file button',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowMoveToBottomButton', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show the ');
              appendCodeBlock(f, 'Move marked selection at cursor');
              f.appendText(' button in the smart cut & paste notice.');
              f.createEl('br');
              f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
            }),
            /**
            HACK: see the TSDoc for {@link EMPTY} for motivation.
            */
            name: `${EMPTY}Should show move at cursor button`,
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowMoveAtCursorButton', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the cursor follows the marked selection after ');
              appendCodeBlock(f, 'Move marked selection to top of file');
              f.appendText(', landing on the moved text where it ends up. How that landing is shown is up to ');
              appendCodeBlock(f, 'Smart cut & paste completion feedback');
              f.appendText(' below.');
              f.createEl('br');
              f.appendText('When disabled, the cursor stays where the selection was cut from, so you can move text out of the way without losing your place.');
            }),
            name: 'Should jump to content moved to top of file',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldJumpToMovedContentToTop', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether the cursor follows the marked selection after ');
              appendCodeBlock(f, 'Move marked selection to bottom of file');
              f.appendText(', landing on the moved text where it ends up. How that landing is shown is up to ');
              appendCodeBlock(f, 'Smart cut & paste completion feedback');
              f.appendText(' below.');
              f.createEl('br');
              f.appendText('When disabled, the cursor stays where the selection was cut from, so you can move text out of the way without losing your place.');
              f.createEl('br');
              f.appendText(
                'There is no such setting for a move at the cursor: it always jumps, since inserting text at the cursor and then leaving the cursor elsewhere makes no sense.'
              );
            }),
            name: 'Should jump to content moved to bottom of file',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldJumpToMovedContentToBottom', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('How a finished smart cut & paste move tells you where the marked selection landed.');
              f.createEl('br');
              appendCodeBlock(f, 'Select moved content');
              f.appendText(' - select the moved text in the target note.');
              f.createEl('br');
              appendCodeBlock(f, 'Notice');
              f.appendText(' - put the cursor on the moved text without selecting it, and show a notice instead.');
              f.createEl('br');
              appendCodeBlock(f, 'Select moved content and notice');
              f.appendText(' - do both.');
              f.createEl('br');
              f.appendText(
                'A selection in the target note looks exactly like the highlight on a selection that is still marked and waiting to be moved, so the two states are hard to tell apart — especially while the notes are locked. The notice modes remove that ambiguity; the cursor still travels to the moved text either way.'
              );
              f.createEl('br');
              f.appendText('This applies only when the move jumps at all: with the jump turned off for the direction, neither the cursor nor a notice moves.');
            }),
            name: 'Smart cut & paste completion feedback',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [SmartCutAndPasteCompletionFeedback.SelectMovedContent]: 'Select moved content',
                  [SmartCutAndPasteCompletionFeedback.Notice]: 'Notice',
                  [SmartCutAndPasteCompletionFeedback.SelectMovedContentAndNotice]: 'Select moved content and notice'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'smartCutAndPasteCompletionFeedback', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Template to use when pasting a marked selection at the cursor (');
              appendCodeBlock(f, 'Move marked selection here');
              f.appendText(' and ');
              appendCodeBlock(f, 'at cursor');
              f.appendText(').');
              f.createEl('br');
              f.appendText('It is also used by ');
              appendCodeBlock(f, 'to top of file');
              f.appendText(' and ');
              appendCodeBlock(f, 'to bottom of file');
              f.appendText(', unless the direction has its own template below.');
              f.createEl('br');
              f.appendText('Leave empty to reuse ');
              appendCodeBlock(f, 'Split template');
              f.appendText(' setting.');
              f.createEl('br');
              addAvailableTokens(f);
            }),
            name: 'Smart cut & paste template',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'smartCutAndPasteTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Template to use when pasting a marked selection via ');
              appendCodeBlock(f, 'Move marked selection to top of file');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Leave empty to reuse ');
              appendCodeBlock(f, 'Smart cut & paste template');
              f.appendText(' setting.');
              f.createEl('br');
              addAvailableTokens(f);
            }),
            name: 'Smart cut & paste template (to top of file)',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'smartCutAndPasteToTopTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Template to use when pasting a marked selection via ');
              appendCodeBlock(f, 'Move marked selection to bottom of file');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Leave empty to reuse ');
              appendCodeBlock(f, 'Smart cut & paste template');
              f.appendText(' setting.');
              f.createEl('br');
              addAvailableTokens(f);
            }),
            name: 'Smart cut & paste template (to bottom of file)',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'smartCutAndPasteToBottomTemplate', valueComponent: codeHighlighter });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Include/exclude paths',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('In merge/split dialog include notes from the following paths');
              f.createEl('br');
              f.appendText('Insert each path on a new line');
              f.createEl('br');
              f.appendText('You can use path string or ');
              appendCodeBlock(f, '/regular expression/');
              f.createEl('br');
              appendPathFormsDesc(f);
              f.createEl('br');
              f.appendText('If the setting is empty, all notes are included');
            }),
            name: 'Include paths',
            render: (setting) => {
              setting.addMultipleText((multipleText) => {
                this.bind({ propertyName: 'includePaths', valueComponent: multipleText });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('In merge/split dialog exclude notes from the following paths');
              f.createEl('br');
              f.appendText('Insert each path on a new line');
              f.createEl('br');
              f.appendText('You can use path string or ');
              appendCodeBlock(f, '/regular expression/');
              f.createEl('br');
              appendPathFormsDesc(f);
              f.createEl('br');
              f.appendText('If the setting is empty, no notes are excluded');
            }),
            name: 'Exclude paths',
            render: (setting) => {
              setting.addMultipleText((multipleText) => {
                this.bind({ propertyName: 'excludePaths', valueComponent: multipleText });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText(
                'When enabled, Advanced Note Composer commands are hidden entirely (from the command palette and the editor/file/folder menus) on notes and folders whose path is excluded/ignored by the settings above.'
              );
              f.createEl('br');
              f.appendText(
                'When disabled (the default), the commands stay visible on excluded paths and show an "ignored in the plugin settings" notice when triggered instead.'
              );
            }),
            name: 'Should block commands on excluded paths',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldBlockCommandsOnExcludedPaths', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Merge folders',
        items: [
          this.settingEx({
            desc: 'Default setting for whether to include child folders into the merge folder modal. Can be changed in the merge folders modal dialog.',
            name: 'Should include child folders when merging folders',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeChildFoldersWhenMergingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to include parent folders into the merge folder modal. Can be changed in the merge folders modal dialog.',
            name: 'Should include parent folders when merging folders',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeParentFoldersWhenMergingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('What happens to the folders left empty once ');
              appendCodeBlock(f, 'Merge folder contents into a single file...');
              f.appendText(' has merged their notes away.');
              f.createEl('br');
              appendCodeBlock(f, 'Delete');
              f.appendText(' - remove the merged folder and each sub-folder that ended up empty. A folder still holding files is always kept.');
              f.createEl('br');
              appendCodeBlock(f, 'Delete sub-folders only');
              f.appendText(' - keep the merged folder itself, even once it is empty, and remove every emptied folder under it, however deep.');
              f.createEl('br');
              appendCodeBlock(f, 'Delete with empty parents');
              f.appendText(' - the same as ');
              appendCodeBlock(f, 'Delete');
              f.appendText(', and also remove any parent folder the deletion leaves empty.');
              f.createEl('br');
              appendCodeBlock(f, 'Keep');
              f.appendText(' - leave every folder in place.');
              f.createEl('br');
              f.appendText('Folders are removed after the merge is committed, so a cancelled merge never deletes anything.');
            }),
            name: 'Empty folders after merging a folder',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  [EmptyFolderBehaviorAfterMergingFolder.Delete]: 'Delete',
                  [EmptyFolderBehaviorAfterMergingFolder.DeleteSubFoldersOnly]: 'Delete sub-folders only',
                  [EmptyFolderBehaviorAfterMergingFolder.DeleteWithEmptyParents]: 'Delete with empty parents',
                  [EmptyFolderBehaviorAfterMergingFolder.Keep]: 'Keep'
                });
                this.bind({ propertyName: 'emptyFolderBehaviorAfterMergingFolder', valueComponent: dropdown });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When ');
              appendCodeBlock(f, 'Merge folder contents into a single file...');
              f.appendText(' merges the folder\'s notes away, whether their attachments follow into the merged note\'s attachment folder.');
              f.createEl('br');
              f.appendText('The destination honors your vault\'s attachment settings, including ');
              /**
              HACK: see the TSDoc for {@link EMPTY} for motivation.
              */
              f.createEl('a', { href: 'https://github.com/mnaoumov/obsidian-custom-attachment-location', text: `${EMPTY}Custom Attachment Location` });
              f.appendText(' when it is installed.');
              f.createEl('br');
              f.appendText('An attachment moves when one of the merged notes references it, or when it already sits where that note\'s attachments belong.');
              f.createEl('br');
              f.appendText('When disabled, attachments stay where they are, which also keeps their folders from being emptied.');
            }),
            name: 'Should move attachments when merging a folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldMoveAttachmentsWhenMergingFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Files whose name ends with one of these extensions are treated as attachments, not notes, so a merge never inlines their contents.');
              f.createEl('br');
              f.appendText('Insert one extension per line, written out in full including the leading dot. For example, ');
              appendCodeBlock(f, '.excalidraw.md');
              f.appendText(' covers ');
              appendCodeBlock(f, 'sketch.excalidraw.md');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Leave empty to treat every markdown file as a note.');
            }),
            name: 'Attachment extensions',
            render: (setting) => {
              setting.addMultipleText((multipleText) => {
                this.bind({ propertyName: 'attachmentExtensions', valueComponent: multipleText });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('When ');
              appendCodeBlock(f, 'Merge folder contents into a single file...');
              f.appendText(' pulls in notes from sub-folders, whether each sub-folder becomes a heading in the merged note.');
              f.createEl('br');
              f.appendText('The heading level is the sub-folder\'s depth below the merged folder: a direct sub-folder becomes ');
              appendCodeBlock(f, '# Name');
              f.appendText(', its own child ');
              appendCodeBlock(f, '## Name');
              f.appendText(', and so on. Notes directly inside the merged folder get no heading.');
              f.createEl('br');
              f.appendText(
                'Every sub-folder is headed, including a completely empty one, so the merged outline mirrors the whole tree. Two note-less cases are left out instead: a folder holding only attachments, and a folder whose notes are all excluded - nothing of either was merged, so neither gets a heading.'
              );
              f.createEl('br');
              f.appendText('Each merged note\'s own headings are demoted to match, so the merged outline stays well-formed. This is the exact opposite of ');
              appendCodeBlock(f, 'Split note by headings recursively...');
              f.appendText(', which turns a heading hierarchy into a folder tree.');
              f.createEl('br');
              f.appendText('Markdown defines only six heading levels. A folder deeper than six still gets its full level, e.g. ');
              appendCodeBlock(f, '####### Name');
              f.appendText(', which Obsidian shows as plain text rather than a heading — the depth stays readable, whereas stopping at ');
              appendCodeBlock(f, '######');
              f.appendText(' made a folder and its own descendants indistinguishable.');
            }),
            name: 'Should convert folders to headings when merging a folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldConvertFoldersToHeadingsWhenMergingFolder', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('The name to give the note created by ');
              appendCodeBlock(f, 'Merge folder contents into a single file...');
              f.appendText('.');
              f.createEl('br');
              f.appendText('Leave empty to name it after the merged folder, e.g. ');
              appendCodeBlock(f, 'Docs.md');
              f.appendText(' for the folder ');
              appendCodeBlock(f, 'Docs');
              f.appendText('. The note is always created next to the folder, and a colliding name is de-duplicated.');
              f.createEl('br');
              f.appendText('Available tokens:');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, '{{folderName}}');
              f.appendText(' / ');
              appendCodeBlock(f, '{{folderPath}}');
              f.appendText(' - the merged folder\'s name / path.');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, '{{parentFolder}}');
              f.appendText(' - the merged folder\'s parent folder name.');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, '{{date:FORMAT}}');
              f.appendText(', e.g. ');
              appendCodeBlock(f, '{{date:YYYY-MM-DD}}');
            }),
            name: 'Merge folder into file note name',
            render: (setting) => {
              setting.addCodeHighlighter((codeHighlighter) => {
                codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
                this.bind({ propertyName: 'mergeFolderIntoFileNoteNameTemplate', valueComponent: codeHighlighter });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Where the merged note is created.');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, 'Beside the folder');
              f.appendText(' - in the merged folder\'s own parent, next to the folder itself.');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, 'Inside the folder');
              f.appendText(' - in the merged folder itself, so the folder is left holding only the merged note.');
              f.createEl('br');
              f.appendText('- ');
              appendCodeBlock(f, 'Default location for new notes');
              f.appendText(' - wherever Obsidian would put a new note, per its own setting.');
              f.createEl('br');
              f.appendText('A colliding name is de-duplicated in every case.');
              f.createEl('br');
              f.appendText(
                'Note that with '
              );
              appendCodeBlock(f, 'Inside the folder');
              f.appendText(
                ' the merged folder is no longer empty afterwards, so it is not removed even when '
              );
              appendCodeBlock(f, 'Empty folder behavior after merging a folder');
              f.appendText(' would otherwise delete it. Its emptied sub-folders are still cleaned up.');
            }),
            name: 'Merge folder into file location',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions({
                  /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
                  [MergeFolderIntoFileLocation.BesideFolder]: 'Beside the folder',
                  [MergeFolderIntoFileLocation.InsideFolder]: 'Inside the folder',
                  [MergeFolderIntoFileLocation.DefaultNewNoteLocation]: 'Default location for new notes'
                  /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
                });
                this.bind({ propertyName: 'mergeFolderIntoFileLocation', valueComponent: dropdown });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Swap folders',
        items: [
          this.settingEx({
            desc: 'Default setting for whether to include child folders into the swap folder modal. Can be changed in the swap folders modal dialog.',
            name: 'Should include child folders when swapping folders',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeChildFoldersWhenSwappingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Default setting for whether to include parent folders into the swap folder modal. Can be changed in the swap folders modal dialog.',
            name: 'Should include parent folders when swapping folders',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldIncludeParentFoldersWhenSwappingByDefault', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Default setting for whether to swap entire folder structure. Can be changed in the swap folders modal dialog.');
              f.createEl('br');
              f.appendText('If enabled, the entire folder structure will be swapped.');
              f.createEl('br');
              f.appendText('If disabled, only the top-level files of the folders will be swapped.');
            }),
            name: 'Should swap entire folder structure',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldSwapEntireFolderStructureByDefault', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Move/flatten folders',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show a confirmation dialog before flattening a folder.');
              f.createEl('br');
              f.appendText('The dialog lists every child that will be moved up one level, including the de-duplicated name any colliding child will get.');
            }),
            name: 'Should ask before flattening a folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeFlattening', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: 'Whether to show a confirmation dialog before moving a folder into the folder picked in the suggester.',
            name: 'Should ask before moving a folder',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAskBeforeMovingFolder', valueComponent: toggle });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'UI',
        items: [
          this.settingEx({
            desc: 'Whether to add commands to the submenu.',
            name: 'Should add commands to submenu',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldAddCommandsToSubmenu', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether every operation reports itself: a notice while it runs, and a notice naming what it did once it finished.');
              f.createEl('br');
              f.appendText('Covers merging, splitting/extracting, swapping, moving, flattening, renaming a heading and reordering headings.');
              f.createEl('br');
              f.appendText('Refusals and errors are always shown, whatever this is set to.');
              f.createEl('br');
              f.appendText('The running notice is what carries the ');
              appendCodeBlock(f, 'Cancel');
              f.appendText(' button, so turning this off also hides it. An operation can still be cancelled by right-clicking the lock indicator and unlocking the note.');
            }),
            name: 'Should show operation notices',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowOperationNotices', valueComponent: toggle });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to show the instruction bar at the bottom of the merge/split/swap modal dialogs.');
              f.createEl('br');
              f.appendText('The instruction bar contains the checkboxes, dropdowns, and keyboard hints for toggling per-operation options.');
              f.createEl('br');
              f.appendText('When disabled, the modals use the configured default settings and the option-toggle keyboard shortcuts are unavailable.');
            }),
            name: 'Should show modal instructions',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({ propertyName: 'shouldShowModalInstructions', valueComponent: toggle });
              });
            }
          })
        ]
      })
    ];
  }
}

function addAvailableTokens(f: DocumentFragment, shouldIncludeContentToken = true): void {
  f.appendText('Available tokens:');
  f.createEl('br');
  if (shouldIncludeContentToken) {
    f.appendText('- ');
    appendCodeBlock(f, '{{content}}');
    f.createEl('br');
  }
  f.appendText('- ');
  appendCodeBlock(f, '{{fromTitle}}');
  f.createEl('br');
  f.appendText('- ');
  appendCodeBlock(f, '{{fromPath}}');
  f.createEl('br');
  f.appendText('- ');
  appendCodeBlock(f, '{{newTitle}}');
  f.createEl('br');
  f.appendText('- ');
  appendCodeBlock(f, '{{newPath}}');
  f.createEl('br');
  f.appendText('- ');
  appendCodeBlock(f, '{{fromParentFolder}}');
  f.appendText(' / ');
  appendCodeBlock(f, '{{newParentFolder}}');
  f.appendText(' - the source / destination note\'s parent folder name (');
  appendCodeBlock(f, '{{parentFolder}}');
  f.appendText(' is an alias for ');
  appendCodeBlock(f, '{{newParentFolder}}');
  f.appendText(').');
  f.createEl('br');
  f.appendText('- ');
  appendCodeBlock(f, '{{date:FORMAT}}');
  f.appendText(', e.g. ');
  appendCodeBlock(f, '{{date:YYYY-MM-DD}}');
}

function appendPathFormsDesc(f: DocumentFragment): void {
  f.appendText('A path string matches that note or folder and everything inside it, so ');
  appendCodeBlock(f, 'Inbox');
  f.appendText(' covers ');
  appendCodeBlock(f, 'Inbox');
  f.appendText(', ');
  appendCodeBlock(f, 'Inbox/note.md');
  f.appendText(' and ');
  appendCodeBlock(f, 'Inbox/sub/deep.md');
  f.appendText('.');
  f.createEl('br');
  f.appendText('A regular expression is tested against the path exactly as written, which is how you match a folder without its contents: ');
  appendCodeBlock(f, '/^Inbox$/');
  f.appendText(' matches only the ');
  appendCodeBlock(f, 'Inbox');
  f.appendText(' folder itself.');
  f.createEl('br');
  f.appendText('If any line is not a valid regular expression, the whole list is ignored until you fix it.');
}
