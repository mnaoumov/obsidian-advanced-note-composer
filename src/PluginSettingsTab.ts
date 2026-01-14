import { getDebugController } from 'obsidian-dev-utils/Debug';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';
import { SettingGroupEx } from 'obsidian-dev-utils/obsidian/SettingGroupEx';

import type { PluginTypes } from './PluginTypes.ts';

import {
  Action,
  FrontmatterMergeStrategy,
  FrontmatterTitleMode,
  TextAfterExtractionMode
} from './PluginSettings.ts';
import { TOKENIZED_STRING_LANGUAGE } from './PrismComponent.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
    this.containerEl.empty();

    new SettingGroupEx(this.containerEl)
      .setHeading('Common')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should allow only current folder')
          .setDesc('Default setting for whether to allow only current folder for destination file selector. Can be changed in the merge/split modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldAllowOnlyCurrentFolderByDefault');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should show console debug messages')
          .setDesc('Whether to show console debug messages.')
          .addToggle((toggle) => {
            const debugController = getDebugController();
            const isEnabled = debugController.get().includes(this.plugin.manifest.id);
            toggle.setValue(isEnabled);
            toggle.onChange((value) => {
              if (value) {
                debugController.enable(this.plugin.manifest.id);
              } else {
                debugController.disable(this.plugin.manifest.id);
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
            this.bind(toggle, 'shouldFixFootnotesByDefault');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should merge headings')
          .setDesc('Default setting for whether to merge headings. Can be changed in the merge/split modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldMergeHeadingsByDefault');
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
            this.bind(dropdown, 'defaultFrontmatterMergeStrategy');
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
            this.bind(toggle, 'shouldRunTemplaterOnDestinationFile');
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
            this.bind(toggle, 'shouldReplaceInvalidTitleCharacters', {
              onChanged: () => {
                this.display();
              }
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
            this.bind(text, 'replacement', {
              shouldResetSettingWhenComponentIsEmpty: false
            });
            text.setDisabled(!this.plugin.settings.shouldReplaceInvalidTitleCharacters);
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should add invalid title to note aliases')
          .setDesc('Whether to add invalid title to the note alias.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldAddInvalidTitleToNoteAlias');
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
            this.bind(dropdown, 'frontmatterTitleMode');
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
          }))
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldTreatTitleAsPathByDefault');
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Merge')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should open note after merge')
          .setDesc('Whether to open the note after merge.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldOpenNoteAfterMerge');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should ask before merging')
          .setDesc('Whether to ask before merging notes.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldAskBeforeMerging');
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
            this.bind(codeHighlighter, 'mergeTemplate', {
              shouldResetSettingWhenComponentIsEmpty: true,
              shouldShowPlaceholderForDefaultValues: false
            });
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Split/extract')
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
            this.bind(dropdown, 'textAfterExtractionMode');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include frontmatter when splitting')
          .setDesc('Default setting for whether to include frontmatter when splitting. Can be changed in the split modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldIncludeFrontmatterWhenSplittingByDefault');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should allow split into unresolved path')
          .setDesc('Default setting for whether to allow split into unresolved path. Can be changed in the split modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldAllowSplitIntoUnresolvedPathByDefault');
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
            this.bind(codeHighlighter, 'splitTemplate');
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
            this.bind(dropdown, 'splitToExistingFileTemplate');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should keep headings when splitting content')
          .setDesc('Whether to keep headings when splitting content.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldKeepHeadingsWhenSplittingContent');
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
            this.bind(multipleText, 'includePaths');
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
            this.bind(multipleText, 'excludePaths');
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Merge folders')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include child folders when merging folders')
          .setDesc('Default setting for whether to include child folders into the merge folder modal. Can be changed in the merge folders modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldIncludeChildFoldersWhenMergingByDefault');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include parent folders when merging folders')
          .setDesc('Default setting for whether to include parent folders into the merge folder modal. Can be changed in the merge folders modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldIncludeParentFoldersWhenMergingByDefault');
          });
      });

    new SettingGroupEx(this.containerEl)
      .setHeading('Swap folders')
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include child folders when swapping folders')
          .setDesc('Default setting for whether to include child folders into the swap folder modal. Can be changed in the swap folders modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldIncludeChildFoldersWhenSwappingByDefault');
          });
      })
      .addSettingEx((setting: SettingEx) => {
        setting
          .setName('Should include parent folders when swapping folders')
          .setDesc('Default setting for whether to include parent folders into the swap folder modal. Can be changed in the swap folders modal dialog.')
          .addToggle((toggle) => {
            this.bind(toggle, 'shouldIncludeParentFoldersWhenSwappingByDefault');
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
            this.bind(toggle, 'shouldSwapEntireFolderStructureByDefault');
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
