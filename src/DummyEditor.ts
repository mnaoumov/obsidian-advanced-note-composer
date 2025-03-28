import type {
  EditorPosition,
  EditorRange,
  EditorSelection
} from 'obsidian';

import { Editor } from 'obsidian';
import { noop } from 'obsidian-dev-utils/Function';

export class DummyEditor extends Editor {
  public override blur(): void {
    noop();
  }

  public override exec(): void {
    noop();
  }

  public override focus(): void {
    noop();
  }

  public override getCursor(): EditorPosition {
    return {
      ch: 0,
      line: 0
    };
  }

  public override getLine(): string {
    return '';
  }

  public override getRange(): string {
    return '';
  }

  public override getScrollInfo(): { left: number; top: number } {
    return {
      left: 0,
      top: 0
    };
  }

  public override getSelection(): string {
    return '';
  }

  public override getValue(): string {
    return '';
  }

  public override hasFocus(): boolean {
    return false;
  }

  public override lastLine(): number {
    return 0;
  }

  public override lineCount(): number {
    return 0;
  }

  public override listSelections(): EditorSelection[] {
    return [];
  }

  public override offsetToPos(): EditorPosition {
    return {
      ch: 0,
      line: 0
    };
  }

  public override posToOffset(): number {
    return 0;
  }

  public override redo(): void {
    noop();
  }

  public override refresh(): void {
    noop();
  }

  public override replaceRange(): void {
    noop();
  }

  public override replaceSelection(): void {
    noop();
  }

  public override scrollIntoView(): void {
    noop();
  }

  public override scrollTo(): void {
    noop();
  }

  public override setSelection(): void {
    noop();
  }

  public override setSelections(): void {
    noop();
  }

  public override setValue(): void {
    noop();
  }

  public override somethingSelected(): boolean {
    return true;
  }

  public override transaction(): void {
    noop();
  }

  public override undo(): void {
    noop();
  }

  public override wordAt(): EditorRange | null {
    return null;
  }
}
