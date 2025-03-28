import type {
  Modal,
  TFile
} from 'obsidian';

export interface ModalBase extends Modal {
  setCurrentFile(file: TFile): void;
}
