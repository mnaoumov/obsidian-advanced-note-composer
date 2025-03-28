import type { App } from 'obsidian';
import type { NoteComposerPluginInstance } from 'obsidian-typings/implementations';

import type { ModalBase } from './ModalBase.ts';

export type MergeFileModalConstructor = new (app: App, noteComposerPluginInstance: NoteComposerPluginInstance) => MergeFileModal;

interface MergeFileModal extends ModalBase {
  foo(): void;
}
