import type {
  App,
  Editor
} from 'obsidian';
import type { NoteComposerPluginInstance } from 'obsidian-typings';

import type { ModalBase } from './SuggestModalBase.ts';

export type SplitFileSuggestModalConstructor = new (
  app: App,
  editor: Editor,
  noteComposerPluginInstance: NoteComposerPluginInstance,
  heading?: string
) => SplitFileSuggestModal;

interface SplitFileSuggestModal extends ModalBase {
}

export function extendSplitFileSuggestModal(OriginalSplitFileSuggestModal: SplitFileSuggestModalConstructor): SplitFileSuggestModalConstructor {
  return class PatchedSplitFileSuggestModal extends OriginalSplitFileSuggestModal {
  };
}
