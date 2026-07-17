import { Notice } from 'obsidian';

const START_NOTE_PATH = '00 Start.md';

export async function invoke(app) {
  const message = 'Startup invoke';
  new Notice(message);
  console.log(message);

  const startNote = app.vault.getFileByPath(START_NOTE_PATH);
  if (startNote) {
    await app.workspace.getLeaf(false).openFile(startNote);
  }
}

export function cleanup() {
  const message = 'Startup cleanup';
  new Notice(message);
  console.log(message);
}
