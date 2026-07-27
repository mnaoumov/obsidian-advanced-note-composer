import type { PluginSettingsTabBaseConstructorParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import { getDebugController } from 'obsidian-dev-utils/debug';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';
import { SettingEx } from 'obsidian-dev-utils/obsidian/setting-ex';
import { SettingGroupEx } from 'obsidian-dev-utils/obsidian/setting-group-ex';
import { EMPTY } from 'obsidian-dev-utils/string';

import type { PluginSettings } from './plugin-settings.ts';

import {
  Action,
  FrontmatterMergeStrategy,
  FrontmatterTitleMode,
  TextAfterExtractionMode
} from './plugin-settings.ts';
import { TOKENIZED_STRING_LANGUAGE } from './prism-component.ts';

interface PluginSettingsTabConstructorParams extends PluginSettingsTabBaseConstructorParams<PluginSettings> {
  readonly pluginId: string;
}

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  private readonly pluginId: string;

  public constructor(params: PluginSettingsTabConstructorParams) {
    super(params);
    this.pluginId = params.pluginId;
  }

  public override displayLegacy(): void {
    super.displayLegacy();

    new SettingGroupEx(this.containerEl)
      .setHeading('Common')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should allow only current folder')
          .setDesc('Default setting for whether to allow only current folder for destination file selector. Can be changed in the merge/split modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAllowOnlyCurrentFolderByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should show console debug messages')
          .setDesc('Whether to show console debug messages.')
          .addToggle((toggle) => {
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
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Merge/split/extract strategies')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should fix footnotes')
          .setDesc('Default setting for whether to fix footnotes. Can be changed in the merge/split modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldFixFootnotesByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should merge headings')
          .setDesc('Default setting for whether to merge headings. Can be changed in the merge/split modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldMergeHeadingsByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Frontmatter merge strategy')
          .setDesc(createFragment((f) => {
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
          }))
          .addDropdown((dropdown) => {
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
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should use source title when destination has none')
          .setDesc(createFragment((f) => {
            f.appendText('When merging, if the destination note (note B) has no ');
            appendCodeBlock(f, 'title');
            f.appendText(' property, use the ');
            appendCodeBlock(f, 'title');
            f.appendText(' from the merged-in note (note A) instead of leaving it empty.');
            f.createEl('br');
            f.appendText('When the destination note already has a ');
            appendCodeBlock(f, 'title');
            f.appendText(', it is always kept.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldUseSourceTitleWhenTargetHasNoTitle', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should run templater on destination file')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to run ');
            f.createEl('a', { href: 'https://silentvoid13.github.io/Templater/', text: 'Templater' });
            f.appendText(' on the destination file after merging/splitting.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldRunTemplaterOnDestinationFile', valueComponent: toggle });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Title')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should replace invalid characters')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to replace invalid characters in the title.');
            f.createEl('br');
            f.appendText('If disabled, the error will be shown for invalid titles.');
          }))
          .addToggle((toggle) => {
            this.bind({
              onChanged: () => {
                this.displayLegacy();
              },
              propertyName: 'shouldReplaceInvalidTitleCharacters',
              valueComponent: toggle
            });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Replacement string')
          .setDesc(createFragment((f) => {
            f.appendText('String to replace invalid characters with.');
            f.createEl('br');
            f.appendText('Leave blank to remove invalid characters.');
          }))
          .addText((text) => {
            this.bind({
              propertyName: 'replacement',
              shouldResetSettingWhenComponentIsEmpty: false,
              valueComponent: text
            });
            text.setDisabled(!this.pluginSettingsComponent.settings.shouldReplaceInvalidTitleCharacters);
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should add invalid title to note aliases')
          .setDesc('Whether to add invalid title to the note alias.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAddInvalidTitleToNoteAlias', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Frontmatter title mode')
          .setDesc(createFragment((f) => {
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
          }))
          .addDropdown((dropdown) => {
            dropdown.addOptions({
              /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
              [FrontmatterTitleMode.None]: 'None',
              [FrontmatterTitleMode.UseForInvalidTitleOnly]: 'Use for invalid title only',
              [FrontmatterTitleMode.UseAlways]: 'Use always'
              /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
            });
            this.bind({ propertyName: 'frontmatterTitleMode', valueComponent: dropdown });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should treat title as path')
          .setDesc(createFragment((f) => {
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
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldTreatTitleAsPathByDefault', valueComponent: toggle });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Merge')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should open note after merge')
          .setDesc('Whether to open the note after merge.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldOpenNoteAfterMerge', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should ask before merging')
          .setDesc('Whether to ask before merging notes.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAskBeforeMerging', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should always merge excluded items')
          .setDesc(
            'When merging a folder, also move and merge items whose path is excluded/ignored in the plugin settings, instead of skipping them. When off (the default), excluded items are skipped and reported in a notice.'
          )
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAlwaysMergeExcludedItems', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Merge template')
          .setDesc(createFragment((f) => {
            f.appendText('Template to use when merging notes.');
            f.createEl('br');
            addAvailableTokens(f);
          }))
          .addCodeHighlighter((codeHighlighter) => {
            codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
            this.bind({
              propertyName: 'mergeTemplate',
              shouldResetSettingWhenComponentIsEmpty: true,
              shouldShowPlaceholderForDefaultValues: false,
              valueComponent: codeHighlighter
            });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Split/extract')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should ask before splitting')
          .setDesc('Whether to ask before splitting notes.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAskBeforeSplitting', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should open target note after split')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to open the target note after splitting.');
            f.createEl('br');
            f.appendText('If enabled, the target note will be opened after splitting.');
            f.createEl('br');
            f.appendText('If disabled, the source note will stay opened after splitting.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldOpenTargetNoteAfterSplit', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should split into folder')
          .setDesc(createFragment((f) => {
            f.appendText('When a split or extract creates a new note, put it inside a brand-new folder named after the note, so the note lands at ');
            appendCodeBlock(f, '<folder>/<note>/<note>.md');
            f.appendText(' instead of ');
            appendCodeBlock(f, '<folder>/<note>.md');
            f.appendText('.');
            f.createEl('br');
            f.appendText('The folder name is de-duplicated if one already exists. Splitting or extracting into an existing note is unaffected.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldSplitIntoFolder', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Split into folder note name')
          .setDesc(createFragment((f) => {
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
          }))
          .addCodeHighlighter((codeHighlighter) => {
            codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
            this.bind({ propertyName: 'splitIntoFolderNoteNameTemplate', valueComponent: codeHighlighter });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should split headings automatically')
          .setDesc(createFragment((f) => {
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
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldSplitHeadingsAutomatically', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Text after extraction')
          .setDesc('What to show in place of the selected text after extracting it.')
          .addDropdown((dropdown) => {
            dropdown.addOptions({
              /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
              [TextAfterExtractionMode.LinkToNewFile]: 'Link to new file',
              [TextAfterExtractionMode.EmbedNewFile]: 'Embed new file',
              [TextAfterExtractionMode.None]: 'None'
              /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
            });
            this.bind({ propertyName: 'textAfterExtractionMode', valueComponent: dropdown });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Apply text after extraction to the same file')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to apply the ');
            appendCodeBlock(f, 'Text after extraction');
            f.appendText(' setting when moving a selection within the same note.');
            f.createEl('br');
            f.appendText('When disabled, moving within the same note leaves nothing in place of the moved text, since a self-link would be meaningless.');
            f.createEl('br');
            f.appendText('This can still be overridden per move in ');
            appendCodeBlock(f, 'Move marked selection here (advanced)...');
            f.appendText('.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldApplyTextAfterExtractionToSameFile', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should lock all notes when marking selection')
          .setDesc(createFragment((f) => {
            f.appendText('When you run ');
            appendCodeBlock(f, 'Mark selection to move');
            f.appendText(', whether to lock every note (blocking edits) until the move is completed or cancelled, so you must finish the extraction before editing anything.');
            f.createEl('br');
            f.appendText('When disabled, only the source note is locked.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldLockAllNotesWhenMarkingSelection', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include frontmatter when splitting')
          .setDesc('Default setting for whether to include frontmatter when splitting. Can be changed in the split modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeFrontmatterWhenSplittingByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should allow split into unresolved path')
          .setDesc(createFragment((f) => {
            f.appendText('Default setting for whether to allow split into unresolved path. Can be changed in the split modal dialog.');
            f.createEl('br');
            f.appendText('Unresolved path comes from links like ');
            appendCodeBlock(f, '[[non-existing note]]');
            f.appendText('.');
            f.createEl('br');
            f.appendText('Some plugins also call them as ');
            appendCodeBlock(f, 'broken links');
            f.appendText('.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAllowSplitIntoUnresolvedPathByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Split template')
          .setDesc(createFragment((f) => {
            f.appendText('Template to use when splitting notes into a new file.');
            f.createEl('br');
            f.appendText('Leave empty to reuse ');
            appendCodeBlock(f, 'Merge template');
            f.appendText(' setting.');
            f.createEl('br');
            addAvailableTokens(f);
          }))
          .addCodeHighlighter((codeHighlighter) => {
            codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
            this.bind({ propertyName: 'splitTemplate', valueComponent: codeHighlighter });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Split to existing file template')
          .setDesc('Template to use when splitting notes to existing file.')
          .addDropdown((dropdown) => {
            dropdown.addOptions({
              [Action.Merge]: 'Merge',
              [Action.Split]: 'Split'
            });
            this.bind({ propertyName: 'splitToExistingFileTemplate', valueComponent: dropdown });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should keep headings when splitting content')
          .setDesc('Whether to keep headings when splitting content.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldKeepHeadingsWhenSplittingContent', valueComponent: toggle });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Swap')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should ask before swapping')
          .setDesc('Whether to show a confirmation dialog before swapping files or folders.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAskBeforeSwapping', valueComponent: toggle });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Smart cut & paste')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should show smart cut & paste notice')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to show the notice after you run ');
            appendCodeBlock(f, 'Mark selection to move');
            f.appendText('. The notice reminds you a selection is marked and offers buttons to move or cancel it.');
            f.createEl('br');
            f.appendText('When disabled, no notice is shown; you drive the move and cancel purely through the commands (and their hotkeys).');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldShowSmartCutNotice', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should show move to top of file button')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to show the ');
            appendCodeBlock(f, 'Move marked selection to top of file');
            f.appendText(' button in the smart cut & paste notice.');
            f.createEl('br');
            f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldShowMoveToTopButton', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should show move to bottom of file button')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to show the ');
            appendCodeBlock(f, 'Move marked selection to bottom of file');
            f.appendText(' button in the smart cut & paste notice.');
            f.createEl('br');
            f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldShowMoveToBottomButton', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          /** HACK: see the TSDoc for {@link EMPTY} for motivation. */
          .setName(`${EMPTY}Should show move at cursor button`)
          .setDesc(createFragment((f) => {
            f.appendText('Whether to show the ');
            appendCodeBlock(f, 'Move marked selection at cursor');
            f.appendText(' button in the smart cut & paste notice.');
            f.createEl('br');
            f.appendText('The command stays available regardless, so any hotkey you assigned to it keeps working.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldShowMoveAtCursorButton', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Smart cut & paste template')
          .setDesc(createFragment((f) => {
            f.appendText('Template to use when pasting a marked selection via smart cut & paste (');
            appendCodeBlock(f, 'Move marked selection here');
            f.appendText(', ');
            appendCodeBlock(f, 'at cursor');
            f.appendText(', ');
            appendCodeBlock(f, 'to top of file');
            f.appendText(', or ');
            appendCodeBlock(f, 'to bottom of file');
            f.appendText(').');
            f.createEl('br');
            f.appendText('Leave empty to reuse ');
            appendCodeBlock(f, 'Split template');
            f.appendText(' setting.');
            f.createEl('br');
            addAvailableTokens(f);
          }))
          .addCodeHighlighter((codeHighlighter) => {
            codeHighlighter.setLanguage(TOKENIZED_STRING_LANGUAGE);
            this.bind({ propertyName: 'smartCutAndPasteTemplate', valueComponent: codeHighlighter });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Include/exclude paths')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Include paths')
          .setDesc(createFragment((f) => {
            f.appendText('In merge/split dialog include notes from the following paths');
            f.createEl('br');
            f.appendText('Insert each path on a new line');
            f.createEl('br');
            f.appendText('You can use path string or ');
            appendCodeBlock(f, '/regular expression/');
            f.createEl('br');
            f.appendText('If the setting is empty, all notes are included');
          }))
          .addMultipleText((multipleText) => {
            this.bind({ propertyName: 'includePaths', valueComponent: multipleText });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Exclude paths')
          .setDesc(createFragment((f) => {
            f.appendText('In merge/split dialog exclude notes from the following paths');
            f.createEl('br');
            f.appendText('Insert each path on a new line');
            f.createEl('br');
            f.appendText('You can use path string or ');
            appendCodeBlock(f, '/regular expression/');
            f.createEl('br');
            f.appendText('If the setting is empty, no notes are excluded');
          }))
          .addMultipleText((multipleText) => {
            this.bind({ propertyName: 'excludePaths', valueComponent: multipleText });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should block commands on excluded paths')
          .setDesc(createFragment((f) => {
            f.appendText('When enabled, Advanced Note Composer commands are hidden entirely (from the command palette and the editor/file/folder menus) on notes and folders whose path is excluded/ignored by the settings above.');
            f.createEl('br');
            f.appendText('When disabled (the default), the commands stay visible on excluded paths and show an "ignored in the plugin settings" notice when triggered instead.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldBlockCommandsOnExcludedPaths', valueComponent: toggle });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Merge folders')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include child folders when merging folders')
          .setDesc('Default setting for whether to include child folders into the merge folder modal. Can be changed in the merge folders modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeChildFoldersWhenMergingByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include parent folders when merging folders')
          .setDesc('Default setting for whether to include parent folders into the merge folder modal. Can be changed in the merge folders modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeParentFoldersWhenMergingByDefault', valueComponent: toggle });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Swap folders')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include child folders when swapping folders')
          .setDesc('Default setting for whether to include child folders into the swap folder modal. Can be changed in the swap folders modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeChildFoldersWhenSwappingByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include parent folders when swapping folders')
          .setDesc('Default setting for whether to include parent folders into the swap folder modal. Can be changed in the swap folders modal dialog.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeParentFoldersWhenSwappingByDefault', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should swap entire folder structure')
          .setDesc(createFragment((f) => {
            f.appendText('Default setting for whether to swap entire folder structure. Can be changed in the swap folders modal dialog.');
            f.createEl('br');
            f.appendText('If enabled, the entire folder structure will be swapped.');
            f.createEl('br');
            f.appendText('If disabled, only the top-level files of the folders will be swapped.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldSwapEntireFolderStructureByDefault', valueComponent: toggle });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('UI')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should add commands to submenu')
          .setDesc('Whether to add commands to the submenu.')
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldAddCommandsToSubmenu', valueComponent: toggle });
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should show modal instructions')
          .setDesc(createFragment((f) => {
            f.appendText('Whether to show the instruction bar at the bottom of the merge/split/swap modal dialogs.');
            f.createEl('br');
            f.appendText('The instruction bar contains the checkboxes, dropdowns, and keyboard hints for toggling per-operation options.');
            f.createEl('br');
            f.appendText('When disabled, the modals use the configured default settings and the option-toggle keyboard shortcuts are unavailable.');
          }))
          .addToggle((toggle) => {
            this.bind({ propertyName: 'shouldShowModalInstructions', valueComponent: toggle });
          });
      });
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
