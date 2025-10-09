import type {
  Instruction,
  KeymapContext,
  Modifier,
  SuggestModal
} from 'obsidian';

import {
  Platform,
  Scope
} from 'obsidian';

const KEYS_MAP: Record<string, string> = {
  Enter: '↵',
  UpDown: '↑↓'
};

interface CheckboxCommand {
  key: string;
  modifiers?: Modifier[];
  onChange(value: boolean): void;
  onInit(checkboxEl: HTMLInputElement): void;
  purpose: string;
}

interface InstructionEx extends Instruction {
  init?: (purposeEl: HTMLSpanElement, scope: Scope) => void;
}

interface KeyboardCommand {
  key: string;
  modifiers?: Modifier[];
  onKey?(evt: KeyboardEvent, ctx: KeymapContext): boolean;
  purpose: string;
}

export class SuggestModalCommandBuilder {
  private readonly instructions: InstructionEx[] = [];

  public addCheckbox(command: CheckboxCommand): this {
    this.instructions.push({
      command: this.buildCommand(command),
      init: (purposeEl, scope) => {
        const checkboxEl = purposeEl.createEl('input', { type: 'checkbox' });
        command.onInit(checkboxEl);
        checkboxEl.addEventListener('change', () => {
          command.onChange(checkboxEl.checked);
        });

        scope.register(command.modifiers ?? [], command.key, () => {
          if (checkboxEl.disabled) {
            return;
          }
          checkboxEl.checked = !checkboxEl.checked;
          checkboxEl.trigger('change');
        });
      },
      purpose: command.purpose
    });
    return this;
  }

  public addKeyboardCommand(command: KeyboardCommand): this {
    this.instructions.push({
      command: this.buildCommand(command),
      init: (_purposeEl, scope) => {
        if (command.onKey) {
          scope.register(command.modifiers ?? [], command.key, command.onKey.bind(command));
        }
      },
      purpose: command.purpose
    });
    return this;
  }

  public build(modal: SuggestModal<unknown>): void {
    modal.setInstructions(this.instructions);
    const purposeEls = Array.from(modal.instructionsEl.findAll('.prompt-instruction > span:nth-child(2)')) as HTMLSpanElement[];
    for (let i = 0; i < purposeEls.length; i++) {
      const purposeEl = purposeEls[i];
      if (!purposeEl) {
        continue;
      }

      this.instructions[i]?.init?.(purposeEl, modal.scope);
    }
  }

  private buildCommand(entry: KeyboardCommand): string {
    let command = KEYS_MAP[entry.key] ?? entry.key;

    for (const modifier of entry.modifiers ?? []) {
      command = `${this.getModifierString(modifier)} ${command}`;
    }

    return command;
  }

  private getModifierString(modifier: Modifier): string {
    switch (modifier) {
      case 'Alt':
        return 'alt';
      case 'Ctrl':
        return 'ctrl';
      case 'Meta':
        return Platform.isMacOS ? 'cmd' : 'win';
      case 'Mod':
        return Platform.isMacOS ? 'cmd' : 'ctrl';
      case 'Shift':
        return 'shift';
      default:
        return modifier;
    }
  }
}
