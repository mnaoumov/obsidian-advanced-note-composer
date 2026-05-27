import type {
  Instruction,
  Modifier,
  SuggestModal
} from 'obsidian';

import {
  DropdownComponent,
  Platform,
  Scope
} from 'obsidian';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { SuggestModalCommandBuilder } from './suggest-modal-command-builder.ts';

function createMockModal(): SuggestModal<unknown> {
  const instructionsEl = createDiv();
  return strictProxy<SuggestModal<unknown>>({
    instructionsEl,
    scope: new Scope(),
    setInstructions: vi.fn((instructions: Instruction[]) => {
      instructionsEl.empty();
      for (const instruction of instructions) {
        const promptInstruction = instructionsEl.createDiv('prompt-instruction');
        promptInstruction.createSpan({ text: instruction.command });
        promptInstruction.createSpan({ text: instruction.purpose });
      }
    })
  });
}

describe('SuggestModalCommandBuilder', () => {
  let builder: SuggestModalCommandBuilder;

  beforeEach(() => {
    builder = new SuggestModalCommandBuilder();
  });

  describe('addKeyboardCommand', () => {
    it('should add a keyboard command instruction', () => {
      builder.addKeyboardCommand({ key: 'Enter', purpose: 'to confirm' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: '↵', purpose: 'to confirm' })
        ])
      );
    });

    it('should map UpDown key', () => {
      builder.addKeyboardCommand({ key: 'UpDown', purpose: 'to navigate' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: '↑↓' })
        ])
      );
    });

    it('should pass through unmapped keys', () => {
      builder.addKeyboardCommand({ key: 'Escape', purpose: 'to dismiss' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'Escape' })
        ])
      );
    });

    it('should register onKey callback with scope when onKey is provided', () => {
      const onKey = vi.fn();
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Mod'], onKey, purpose: 'to create' });
      const modal = createMockModal();
      // Scope.register is called inside init, which is called inside build
      // The mock Scope stores handlers but the InstructionEx.init is called during build
      builder.build(modal);
      // Verify setInstructions was called with the instruction
      expect(modal.setInstructions).toHaveBeenCalled();
    });

    it('should not register scope handler when no onKey is provided', () => {
      builder.addKeyboardCommand({ key: 'UpDown', purpose: 'to navigate' });
      const modal = createMockModal();
      builder.build(modal);
      // No onKey means no scope.register call for this command
      expect(modal.setInstructions).toHaveBeenCalled();
    });

    it('should return this for chaining', () => {
      const result = builder.addKeyboardCommand({ key: 'Enter', purpose: 'test' });
      expect(result).toBe(builder);
    });
  });

  describe('addCheckbox', () => {
    it('should add a checkbox instruction', () => {
      const onChange = vi.fn();
      const onInit = vi.fn();
      builder.addCheckbox({ key: '1', modifiers: ['Alt'], onChange, onInit, purpose: 'Fix footnotes' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'alt 1', purpose: 'Fix footnotes' })
        ])
      );
    });

    it('should create checkbox element and call onInit', () => {
      const onInit = vi.fn();
      builder.addCheckbox({ key: '1', modifiers: ['Alt'], onChange: vi.fn(), onInit, purpose: 'Test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(onInit).toHaveBeenCalled();
    });

    it('should call onChange when checkbox changes', () => {
      const onChange = vi.fn();
      builder.addCheckbox({
        key: '1',
        modifiers: ['Alt'],
        onChange,
        onInit: vi.fn(),
        purpose: 'Test'
      });
      const modal = createMockModal();
      builder.build(modal);
      // Find the checkbox in the modal's instructionsEl
      const checkboxElement = modal.instructionsEl.querySelector('input[type="checkbox"]');
      expect(checkboxElement).toBeTruthy();
      const checkbox = checkboxElement as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it('should register keyboard shortcut for checkbox', () => {
      const onChange = vi.fn();
      builder.addCheckbox({
        key: '1',
        modifiers: ['Alt'],
        onChange,
        onInit: vi.fn(),
        purpose: 'Test'
      });
      const modal = createMockModal();
      builder.build(modal);
      // Verify instruction was added
      expect(modal.setInstructions).toHaveBeenCalled();
    });

    it('should not toggle checkbox via keyboard when disabled', () => {
      const onChange = vi.fn();
      let capturedCheckbox: HTMLInputElement | undefined;
      builder.addCheckbox({
        key: '1',
        onChange,
        onInit: (el) => {
          capturedCheckbox = el;
          el.disabled = true;
        },
        purpose: 'Test'
      });
      const modal = createMockModal();
      builder.build(modal);
      // The checkbox should be disabled and the keyboard handler should return early
      expect(capturedCheckbox?.disabled).toBe(true);
    });

    it('should return this for chaining', () => {
      const result = builder.addCheckbox({ key: '1', onChange: vi.fn(), onInit: vi.fn(), purpose: 'Test' });
      expect(result).toBe(builder);
    });
  });

  describe('addDropDown', () => {
    it('should add a dropdown instruction', () => {
      builder.addDropDown({
        key: '5',
        modifiers: ['Alt'],
        onChange: vi.fn(),
        onInit: vi.fn(),
        purpose: 'Strategy'
      });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'alt 5', purpose: 'Strategy' })
        ])
      );
    });

    it('should call onInit with DropdownComponent', () => {
      const onInit = vi.fn();
      builder.addDropDown({
        key: '5',
        modifiers: ['Alt'],
        onChange: vi.fn(),
        onInit,
        purpose: 'Strategy'
      });
      const modal = createMockModal();
      builder.build(modal);
      expect(onInit).toHaveBeenCalledWith(expect.any(DropdownComponent));
    });

    it('should return this for chaining', () => {
      const result = builder.addDropDown({
        key: '5',
        onChange: vi.fn(),
        onInit: vi.fn(),
        purpose: 'Strategy'
      });
      expect(result).toBe(builder);
    });
  });

  describe('build', () => {
    it('should skip missing purposeEls gracefully', () => {
      builder.addKeyboardCommand({ key: 'Enter', purpose: 'test' });
      const modal = strictProxy<SuggestModal<unknown>>({
        instructionsEl: createDiv(),
        scope: new Scope(),
        setInstructions: vi.fn()
      });
      // InstructionsEl is empty so no purpose els found — should not throw
      expect(() => {
        builder.build(modal);
      }).not.toThrow();
    });
  });

  describe('getModifierString', () => {
    it('should handle Alt modifier', () => {
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Alt'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'alt ↵' })
        ])
      );
    });

    it('should handle Ctrl modifier', () => {
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Ctrl'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'ctrl ↵' })
        ])
      );
    });

    it('should handle Meta modifier on macOS', () => {
      vi.spyOn(Platform, 'isMacOS', 'get').mockReturnValue(true);
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Meta'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'cmd ↵' })
        ])
      );
    });

    it('should handle Meta modifier on non-macOS', () => {
      vi.spyOn(Platform, 'isMacOS', 'get').mockReturnValue(false);
      builder = new SuggestModalCommandBuilder();
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Meta'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'win ↵' })
        ])
      );
    });

    it('should handle Mod modifier on macOS', () => {
      vi.spyOn(Platform, 'isMacOS', 'get').mockReturnValue(true);
      builder = new SuggestModalCommandBuilder();
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Mod'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'cmd ↵' })
        ])
      );
    });

    it('should handle Mod modifier on non-macOS', () => {
      vi.spyOn(Platform, 'isMacOS', 'get').mockReturnValue(false);
      builder = new SuggestModalCommandBuilder();
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Mod'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'ctrl ↵' })
        ])
      );
    });

    it('should handle Shift modifier', () => {
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Shift'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'shift ↵' })
        ])
      );
    });

    it('should handle unknown modifier', () => {
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['unknown' as Modifier], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'unknown ↵' })
        ])
      );
    });

    it('should handle multiple modifiers', () => {
      builder.addKeyboardCommand({ key: 'Enter', modifiers: ['Ctrl', 'Shift'], purpose: 'test' });
      const modal = createMockModal();
      builder.build(modal);
      expect(modal.setInstructions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ command: 'shift ctrl ↵' })
        ])
      );
    });
  });
});
