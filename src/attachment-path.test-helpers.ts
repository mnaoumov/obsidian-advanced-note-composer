import type { App } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { TFolder } from 'obsidian-test-mocks/obsidian';

/**
 * Parameters for {@link seedAttachmentPathSurface}.
 */
export interface SeedAttachmentPathSurfaceParams {
  /**
   * The mock app whose vault is seeded.
   */
  readonly app: App;

  /**
   * The vault's `attachmentFolderPath` setting. Obsidian's own default is `/` (the vault root); `./`
   * means "same folder as the note", `./sub` a sub-folder of it, and anything else a fixed folder.
   */
  readonly attachmentFolderPath?: string;
}

interface AttachmentPathSurface {
  getAvailablePath(basePath: string, extension: string): string;
  getAvailablePathForAttachments: unknown;
  getConfig(key: string): unknown;
}

interface ParentPrefixProvider {
  getParentPrefix(this: TFolder): string;
}

/*
 * `obsidian-test-mocks`' TFolder does not implement Obsidian's one-line `getParentPrefix()`, which the
 * attachment-path resolution calls on every folder it touches. Folders are created by the vault as each
 * fixture is built, so the seed goes on the prototype rather than on individual instances.
 */
castTo<ParentPrefixProvider>(TFolder.prototype).getParentPrefix = function getParentPrefix(this: TFolder): string {
  return this.isRoot() ? '' : `${this.path}/`;
};

/**
 * Seeds the Vault members Obsidian's attachment-path resolution reads, which `obsidian-test-mocks` does
 * not implement — assign-first being the strict proxy's documented escape hatch. The resolution itself is
 * NOT restated here: `obsidian-dev-utils` computes the path from `attachmentFolderPath` and only reaches
 * back for de-duplication.
 *
 * - `getConfig` — the one setting the resolution reads.
 * - `getAvailablePath` — Obsidian's de-duplicator (the plain name, then ` 1`, ` 2`, …).
 * - `getAvailablePathForAttachments` — only ever read for its `extended` member, which an
 *   attachment-location plugin (e.g. Custom Attachment Location) installs. Without it `obsidian-dev-utils`
 *   uses its own resolution, so the function itself must never be called; it throws to say so out loud.
 *
 * The resulting paths for every mode were confirmed against a real Obsidian 1.13.4 over CDP, and the
 * desktop integration suite covers the real resolution end to end.
 *
 * @param params - The app to seed and the attachment folder setting to report.
 */
export function seedAttachmentPathSurface(params: SeedAttachmentPathSurfaceParams): void {
  const { app, attachmentFolderPath = '/' } = params;
  const vault = castTo<AttachmentPathSurface>(app.vault);

  vault.getConfig = (key: string): unknown => key === 'attachmentFolderPath' ? attachmentFolderPath : undefined;

  vault.getAvailablePath = (basePath: string, extension: string): string => {
    if (!app.vault.getAbstractFileByPath(`${basePath}.${extension}`)) {
      return `${basePath}.${extension}`;
    }
    let index = 1;
    for (;;) {
      const candidatePath = `${basePath} ${index.toString()}.${extension}`;
      if (!app.vault.getAbstractFileByPath(candidatePath)) {
        return candidatePath;
      }
      index++;
    }
  };

  vault.getAvailablePathForAttachments = (): never => {
    throw new Error('getAvailablePathForAttachments should not be called without an extended override.');
  };
}
