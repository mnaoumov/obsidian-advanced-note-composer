import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from './command-menu-placement.ts';
import {
  CommandCategory,
  CommandMenuPlacement,
  PluginSettings
} from './plugin-settings.ts';

const PREVIEW_MODE = 'preview';
const SOURCE_MODE = 'source';

function createComponent(splitCommandMenuPlacement?: CommandMenuPlacement): PluginSettingsComponent {
  const settings = new PluginSettings();
  if (splitCommandMenuPlacement) {
    settings.splitCommandMenuPlacement = splitCommandMenuPlacement;
  }
  return strictProxy<PluginSettingsComponent>({ settings });
}

describe('checkShouldAddCommandToEditorMenu', () => {
  it('should add to the editor menu by default, so nothing changes for a user who has not asked', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      pluginSettingsComponent: createComponent()
    })).toBe(true);
  });

  it('should add to the editor menu when the category is placed in both menus', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Both)
    })).toBe(true);
  });

  it('should not add to the editor menu when the category is placed on the margin only', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.ViewportMenu)
    })).toBe(false);
  });

  it('should not add to the editor menu when the category is placed in neither menu', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Neither)
    })).toBe(false);
  });

  it('should answer per category, so moving one category leaves the others where they were', () => {
    const pluginSettingsComponent = createComponent(CommandMenuPlacement.ViewportMenu);
    expect(checkShouldAddCommandToEditorMenu({ commandCategory: CommandCategory.Swap, pluginSettingsComponent })).toBe(true);
  });

  // A `data.json` hand-edited to an unknown placement bypasses the type system, so the runtime guard stands.
  it('should throw on a placement that is not a known member', () => {
    const pluginSettingsComponent = createComponent(castTo<CommandMenuPlacement>('bogus'));
    expect(() => checkShouldAddCommandToEditorMenu({ commandCategory: CommandCategory.SplitAndExtract, pluginSettingsComponent })).toThrow();
  });
});

describe('checkShouldAddCommandToViewportMenu', () => {
  it('should not add to the margin menu by default', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent()
    })).toBe(false);
  });

  it('should add to the margin menu when the category is placed there', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.ViewportMenu)
    })).toBe(true);
  });

  it('should add to the margin menu when the category is placed in both menus', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Both)
    })).toBe(true);
  });

  it('should not add to the margin menu when the category is placed in neither menu', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Neither)
    })).toBe(false);
  });

  // Obsidian raises the same menu over a note being read, where there is nothing for these commands to edit.
  it('should never add to the margin menu in reading mode, even when the category is placed there', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      mode: PREVIEW_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.ViewportMenu)
    })).toBe(false);
  });

  it('should answer per category, so moving one category does not drag the others onto the margin', () => {
    const pluginSettingsComponent = createComponent(CommandMenuPlacement.ViewportMenu);
    expect(checkShouldAddCommandToViewportMenu({ commandCategory: CommandCategory.Swap, mode: SOURCE_MODE, pluginSettingsComponent })).toBe(false);
  });

  // A `data.json` hand-edited to an unknown placement bypasses the type system, so the runtime guard stands.
  it('should throw on a placement that is not a known member', () => {
    const pluginSettingsComponent = createComponent(castTo<CommandMenuPlacement>('bogus'));
    expect(() => checkShouldAddCommandToViewportMenu({ commandCategory: CommandCategory.SplitAndExtract, mode: SOURCE_MODE, pluginSettingsComponent })).toThrow();
  });
});
