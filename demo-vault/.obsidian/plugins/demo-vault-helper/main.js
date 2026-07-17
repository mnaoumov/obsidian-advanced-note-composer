'use strict';

// Demo Vault Helper - a tiny bootstrap plugin shipped INSIDE the Advanced Note Composer
// demo vault. On first open (after you trust the vault) it installs and enables CodeScript
// Toolkit - which powers the "Run" buttons in the demo notes - and then opens "00 Start.md".
//
// It replicates the install flow of obsidian-dev-utils' installCommunityPlugin using only
// Obsidian's public runtime, because it cannot import obsidian-dev-utils itself: that module
// is only reachable through CodeScript Toolkit's require(), which is exactly what this plugin
// bootstraps. Everything is idempotent, so re-opening the vault is a no-op beyond opening the
// start note.

const { Plugin, Notice, requestUrl } = require('obsidian');

const CODESCRIPT_TOOLKIT_ID = 'fix-require-modules';
const START_NOTE_PATH = '00 Start.md';
const COMMUNITY_PLUGINS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json';

class DemoVaultHelperPlugin extends Plugin {
  async onload() {
    this.app.workspace.onLayoutReady(() => {
      void this.setUpDemoVault();
    });
  }

  async setUpDemoVault() {
    try {
      const wasInstalled = await this.ensureCodeScriptToolkit();
      if (wasInstalled) {
        new Notice('Demo Vault Helper: installed and enabled CodeScript Toolkit.');
      }
    } catch (error) {
      console.error('Demo Vault Helper: could not install CodeScript Toolkit', error);
      new Notice('Demo Vault Helper: could not auto-install CodeScript Toolkit. See the "CodeScript Toolkit prerequisite" note for manual steps.');
    }
    await this.openStartNote();
  }

  async ensureCodeScriptToolkit() {
    const { plugins } = this.app;
    if (plugins.manifests[CODESCRIPT_TOOLKIT_ID]) {
      if (!plugins.enabledPlugins.has(CODESCRIPT_TOOLKIT_ID)) {
        await plugins.enablePluginAndSave(CODESCRIPT_TOOLKIT_ID);
      }
      return false;
    }

    const entries = (await requestUrl(COMMUNITY_PLUGINS_URL)).json;
    const entry = entries.find((candidate) => candidate.id === CODESCRIPT_TOOLKIT_ID);
    if (!entry) {
      throw new Error('CodeScript Toolkit was not found in the Obsidian community plugins registry.');
    }

    const release = (await requestUrl(`https://api.github.com/repos/${entry.repo}/releases/latest`)).json;
    const version = release.tag_name;
    const manifest = (await requestUrl(`https://github.com/${entry.repo}/releases/download/${version}/manifest.json`)).json;
    await plugins.installPlugin(entry.repo, version, manifest);
    await plugins.enablePluginAndSave(CODESCRIPT_TOOLKIT_ID);
    return true;
  }

  async openStartNote() {
    const startNote = this.app.vault.getFileByPath(START_NOTE_PATH);
    if (startNote) {
      await this.app.workspace.getLeaf(false).openFile(startNote);
    }
  }
}

module.exports = DemoVaultHelperPlugin;
