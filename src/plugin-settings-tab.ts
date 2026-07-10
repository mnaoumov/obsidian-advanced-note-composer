import type { PluginSettingsTabBaseConstructorParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import { getDebugController } from 'obsidian-dev-utils/debug';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';
import { SettingEx } from 'obsidian-dev-utils/obsidian/setting-ex';
import { SettingGroupEx } from 'obsidian-dev-utils/obsidian/setting-group-ex';

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

function addAvailableTokens(f: DocumentFragment): void {
  f.appendText('Available tokens:');
  f.createEl('br');
  f.appendText('- ');
  appendCodeBlock(f, '{{content}}');
  f.createEl('br');
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
  appendCodeBlock(f, '{{date:FORMAT}}');
  f.appendText(', e.g. ');
  appendCodeBlock(f, '{{date:YYYY-MM-DD}}');
}
