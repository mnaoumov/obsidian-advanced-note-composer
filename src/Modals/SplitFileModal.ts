import type {
  App,
  Editor
} from 'obsidian';
import type { NoteComposerPluginInstance } from 'obsidian-typings';

import type { ModalBase } from './ModalBase.ts';

export type SplitFileModalConstructor = new (
  app: App,
  editor: Editor,
  noteComposerPluginInstance: NoteComposerPluginInstance,
  heading?: string
) => SplitFileModal;

interface SplitFileModal extends ModalBase {
  foo(): void;
}
