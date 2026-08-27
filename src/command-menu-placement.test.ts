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
  checkShouldAddCommandToViewportMenu,
  isMenuIncludedInPlacement,
  MenuKind,
  withMenuIncludedInPlacement
} from './command-menu-placement.ts';
import {
  CommandMenuPlacement,
  PluginSettings
} from './plugin-settings.ts';

const OTHER_COMMAND_ID = 'swap-with-marked-selection';
const PREVIEW_MODE = 'preview';
const RECURSIVE_SPLIT_COMMAND_ID = 'split-note-by-headings-recursively';
const SOURCE_MODE = 'source';

function createComponent(commandMenuPlacement?: CommandMenuPlacement): PluginSettingsComponent {
  const settings = new PluginSettings();
  if (commandMenuPlacement) {
    settings.commandMenuPlacements.set(RECURSIVE_SPLIT_COMMAND_ID, commandMenuPlacement);
  }
  return strictProxy<PluginSettingsComponent>({ settings });
}

describe('checkShouldAddCommandToEditorMenu', () => {
  it('should add to the editor menu by default, so nothing changes for a user who has not asked', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      pluginSettingsComponent: createComponent()
    })).toBe(true);
  });

  it('should add to the editor menu when the command is placed in both menus', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Both)
    })).toBe(true);
  });

  it('should not add to the editor menu when the command is placed on the margin only', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.ViewportMenu)
    })).toBe(false);
  });

  it('should not add to the editor menu when the command is placed in neither menu', () => {
    expect(checkShouldAddCommandToEditorMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Neither)
    })).toBe(false);
  });

  /*
   * Issue #254: this used to answer per CATEGORY, so demoting the recursive split to the margin took every
   * other split and extract with it. Its sibling in the same category is what proves the granularity, not
   * a command from somewhere else.
   */
  it('should answer per command, so moving one leaves its own category siblings where they were', () => {
    const pluginSettingsComponent = createComponent(CommandMenuPlacement.ViewportMenu);
    expect(checkShouldAddCommandToEditorMenu({ commandId: 'extract-current-selection', pluginSettingsComponent })).toBe(true);
    expect(checkShouldAddCommandToEditorMenu({ commandId: OTHER_COMMAND_ID, pluginSettingsComponent })).toBe(true);
  });

  // A `data.json` hand-edited to an unknown placement bypasses the type system. `PluginSettings` answers
  // The default for it rather than letting it reach the `assertNever` guard inside a menu handler.
  it('should fall back to the editor menu for a placement that is not a known member', () => {
    const pluginSettingsComponent = createComponent(castTo<CommandMenuPlacement>('bogus'));
    expect(checkShouldAddCommandToEditorMenu({ commandId: RECURSIVE_SPLIT_COMMAND_ID, pluginSettingsComponent })).toBe(true);
  });
});

describe('checkShouldAddCommandToViewportMenu', () => {
  it('should not add to the margin menu by default', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent()
    })).toBe(false);
  });

  it('should add to the margin menu when the command is placed there', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.ViewportMenu)
    })).toBe(true);
  });

  it('should add to the margin menu when the command is placed in both menus', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Both)
    })).toBe(true);
  });

  it('should not add to the margin menu when the command is placed in neither menu', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      mode: SOURCE_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.Neither)
    })).toBe(false);
  });

  // Obsidian raises the same menu over a note being read, where there is nothing for these commands to edit.
  it('should never add to the margin menu in reading mode, even when the command is placed there', () => {
    expect(checkShouldAddCommandToViewportMenu({
      commandId: RECURSIVE_SPLIT_COMMAND_ID,
      mode: PREVIEW_MODE,
      pluginSettingsComponent: createComponent(CommandMenuPlacement.ViewportMenu)
    })).toBe(false);
  });

  it('should answer per command, so moving one does not drag its category siblings onto the margin', () => {
    const pluginSettingsComponent = createComponent(CommandMenuPlacement.ViewportMenu);
    expect(checkShouldAddCommandToViewportMenu({ commandId: 'extract-current-selection', mode: SOURCE_MODE, pluginSettingsComponent })).toBe(false);
  });

  it('should fall back to the editor menu for a placement that is not a known member', () => {
    const pluginSettingsComponent = createComponent(castTo<CommandMenuPlacement>('bogus'));
    expect(checkShouldAddCommandToViewportMenu({ commandId: RECURSIVE_SPLIT_COMMAND_ID, mode: SOURCE_MODE, pluginSettingsComponent })).toBe(false);
  });
});

/*
 * The pair that lets the stored value stay the four-member enum while the settings UI is two toggles
 * (issue #254). Round-tripping every combination is what proves they are the same thing — a mismatch here
 * would show up as a toggle that will not stay switched.
 */
describe('isMenuIncludedInPlacement / withMenuIncludedInPlacement', () => {
  const CASES: readonly (readonly [CommandMenuPlacement, boolean, boolean])[] = [
    [CommandMenuPlacement.Both, true, true],
    [CommandMenuPlacement.EditorMenu, true, false],
    [CommandMenuPlacement.ViewportMenu, false, true],
    [CommandMenuPlacement.Neither, false, false]
  ];

  it('should read each placement as its pair of menus', () => {
    for (const [commandMenuPlacement, isEditorMenuIncluded, isViewportMenuIncluded] of CASES) {
      expect(isMenuIncludedInPlacement(commandMenuPlacement, MenuKind.EditorMenu)).toBe(isEditorMenuIncluded);
      expect(isMenuIncludedInPlacement(commandMenuPlacement, MenuKind.ViewportMenu)).toBe(isViewportMenuIncluded);
    }
  });

  it('should rebuild every placement from flipping one menu of another', () => {
    for (const [commandMenuPlacement] of CASES) {
      for (const menuKind of [MenuKind.EditorMenu, MenuKind.ViewportMenu]) {
        for (const isIncluded of [true, false]) {
          const result = withMenuIncludedInPlacement(commandMenuPlacement, menuKind, isIncluded);
          expect(isMenuIncludedInPlacement(result, menuKind)).toBe(isIncluded);
          const otherMenuKind = menuKind === MenuKind.EditorMenu ? MenuKind.ViewportMenu : MenuKind.EditorMenu;
          expect(isMenuIncludedInPlacement(result, otherMenuKind)).toBe(isMenuIncludedInPlacement(commandMenuPlacement, otherMenuKind));
        }
      }
    }
  });
});
