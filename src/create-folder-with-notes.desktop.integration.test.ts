import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the flow is driven through a real modal (the name prompt), and since issue #194 the
// Palette's destination comes from Obsidian's own `newFileLocation` / `newFileFolderPath`, which are
// Modeled by neither `obsidian-typings` nor `obsidian-test-mocks` — so the resolution can only be
// Exercised here.
// Isolation: `npx vitest run --project integration-tests:desktop src/create-folder-with-notes.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: CreateFolderSettings;
}

interface CreateFolderSettings {
  newFolderContentTemplate: string;
  newFolderNameTemplate: string;
  shouldAskBeforeCreatingFolder: boolean;
  shouldOpenNoteAfterCreatingFolder: boolean;
  shouldRunTemplaterOnDestinationFile: boolean;
  shouldTitleCaseCreatedFolderName: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: CreateFolderSettings) => void): Promise<void>;
  settings: CreateFolderSettings;
}

describe('create folder with notes... (issues #191, #194, #195, #219)', () => {
  it('creates in Obsidian\'s default new-note location, normalizes the typed name, numbers it after its siblings, and fills the folder from the template', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const PARENT_PATH = 'create-parent';
        // Exercises every normalization rule at once: the surrounding and repeated whitespace collapse, `api`
        // Is capitalized, the all-caps `TEST` survives as an acronym, and `*` is replaced.
        const TYPED_NAME = '  api   TEST  x*y ';
        // The two spellings the whole design turns on: the folder carries the index, the note named after it
        // Does not.
        const EXPECTED_SAFE_NAME = 'Api TEST X_y';
        const EXPECTED_FOLDER_NAME = `2. ${EXPECTED_SAFE_NAME}`;
        const EXPECTED_FOLDER_PATH = `${PARENT_PATH}/${EXPECTED_FOLDER_NAME}`;

        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };
        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        const originalNewFileFolderPath = app.vault.getConfig('newFileFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.newFolderNameTemplate = '{{index}}. {{safeFolderName}}';
            settings.newFolderContentTemplate = [
              '{{file}} !.md',
              '---',
              'title: "{{folderName}}"',
              'aliases:',
              '  - {{safeFolderName}}',
              '---',
              '',
              '- [ ] refine',
              '{{file}} {{safeFolderName}}.md',
              '# {{folderName}}'
            ].join('\n');
            settings.shouldAskBeforeCreatingFolder = false;
            settings.shouldOpenNoteAfterCreatingFolder = true;
            settings.shouldTitleCaseCreatedFolderName = true;
            // Templater is not installed in the test vault; leaving this on would only add a warning notice.
            settings.shouldRunTemplaterOnDestinationFile = false;
          });

          await trashIfExists(PARENT_PATH);
          await app.vault.createFolder(PARENT_PATH);
          // The sibling the numbering has to continue from — `1.` means the new folder must become `2.`.
          await app.vault.createFolder(`${PARENT_PATH}/1. Existing`);

          // The whole point of issue #194: the palette is given NO folder, and the destination comes from
          // Obsidian's own setting. `folder` is the mode that pins it somewhere specific, so the folder
          // Landing in `PARENT_PATH` is only explicable by this resolution having run.
          app.vault.setConfig('newFileLocation', 'folder');
          app.vault.setConfig('newFileFolderPath', PARENT_PATH);

          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          // The name prompt is now the FIRST and ONLY modal — there is no folder picker any more.
          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          /*
           * The `waitUntil` above is what actually pins the ORDER — a reintroduced picker would open
           * first, nothing here would drive it, and the wait would time out. This is the cheaper
           * secondary check that no suggester is open ALONGSIDE the prompt: the removed picker was a
           * `FuzzySuggestModal`, whose input is the one element the name prompt does not have.
           */
          const wasSuggesterOpen = document.querySelector('.prompt-input') !== null;

          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          nameInput.value = TYPED_NAME;
          // The modal tracks its value through the component's change handler, so a bare `value` assignment
          // Would be accepted and then submitted as an empty name.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));

          // The prompt validates ASYNCHRONOUSLY and refuses to submit while the input is invalid. It opens
          // Empty, so it starts out invalid — clicking before the validation settles is silently ignored.
          await waitUntil({
            message: 'the typed folder name never became valid',
            predicate: () => nameInput.checkValidity()
          });

          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No folder name prompt OK button.');
          }
          okButton.click();

          // A throwing wait would discard everything observed so far, so give up quietly and let the
          // Assertions outside Obsidian report what actually happened.
          try {
            await waitUntil({
              message: 'the folder and its notes were not created',
              predicate: () => app.vault.getAbstractFileByPath(`${EXPECTED_FOLDER_PATH}/${EXPECTED_SAFE_NAME}.md`) !== null
            });
          } catch {
            // Diagnostics are returned below.
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const folderNoteFile = app.vault.getFileByPath(`${EXPECTED_FOLDER_PATH}/!.md`);
          const namedNoteFile = app.vault.getFileByPath(`${EXPECTED_FOLDER_PATH}/${EXPECTED_SAFE_NAME}.md`);

          return {
            activeFilePath: app.workspace.getActiveFile()?.path ?? null,
            // The parent's whole content: proves the numbering continued rather than colliding, and that
            // Nothing else was created along the way.
            actualChildren: app.vault.getFolderByPath(PARENT_PATH)?.children.map((child) => child.path).sort() ?? [],
            folderExists: app.vault.getFolderByPath(EXPECTED_FOLDER_PATH) !== null,
            folderNoteContent: folderNoteFile ? await app.vault.read(folderNoteFile) : null,
            namedNoteContent: namedNoteFile ? await app.vault.read(namedNoteFile) : null,
            // The `1.` sibling is untouched, so the new folder continued the sequence rather than colliding.
            siblingUntouched: app.vault.getFolderByPath(`${PARENT_PATH}/1. Existing`) !== null,
            wasSuggesterOpen
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          app.vault.setConfig('newFileFolderPath', originalNewFileFolderPath);
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.newFolderNameTemplate === 'string';
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID }
    });

    // Asserted first, because it is the assertion that says what happened when the rest fail: the typed
    // `api TEST x*y` became `2. Api TEST X_y` — capitalized, acronym intact, `*` replaced, numbered after
    // The `1.` sibling — and nothing else appeared beside it.
    expect(result.actualChildren).toEqual(['create-parent/1. Existing', 'create-parent/2. Api TEST X_y']);
    expect(result.folderExists).toBe(true);
    // Issue #194: the folder landed in the folder `newFileFolderPath` names, and the name prompt was the
    // Only modal in the flow.
    expect(result.wasSuggesterOpen).toBe(false);
    expect(result.siblingUntouched).toBe(true);
    // `{{folderName}}` carries the index, `{{safeFolderName}}` does not — the distinction the
    // Reporter's own output depends on.
    expect(result.folderNoteContent).toBe('---\ntitle: "2. Api TEST X_y"\naliases:\n  - Api TEST X_y\n---\n\n- [ ] refine\n');
    expect(result.namedNoteContent).toBe('# 2. Api TEST X_y\n');
    // The FIRST note declared is the one that opens.
    expect(result.activeFilePath).toBe('create-parent/2. Api TEST X_y/!.md');
  });

  it('reports the empty-name error only once the prompt is touched, never on open (issue #195)', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Already normalized, so a folder appearing under this exact name is unambiguous evidence that
        // Cancel did not create anything.
        const TYPED_NAME = 'Prompt Validity Probe';

        /*
         * The native validation bubble lives outside the DOM, so it cannot be queried — the observable
         * Is the `reportValidity()` call that raises it. The prototype is wrapped BEFORE the command
         * Runs because the call under test is the one the modal makes while opening, long before the
         * Input element is reachable from here.
         */
        const originalReportValidity = HTMLInputElement.prototype.reportValidity;
        let reportValidityCallCount = 0;
        HTMLInputElement.prototype.reportValidity = checkValidityAndCountReport;

        try {
          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          // The modal validates on open through `invokeAsyncSafely`, so the count only means anything
          // Once that has had a chance to run — reading it synchronously would pass even unfixed.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const callCountOnOpen = reportValidityCallCount;

          // The reporter's whole complaint is the error arriving before this click; here is where it belongs.
          requirePromptElement('.ok-button').click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const callCountAfterEmptySubmit = reportValidityCallCount;
          const isStillOpenAfterEmptySubmit = document.querySelector('.prompt-modal .text-box') !== null;

          const nameInput = requirePromptInput();
          nameInput.value = TYPED_NAME;
          // The modal tracks its value through the component's change handler, so a bare `value`
          // Assignment would never reach the validator.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the typed folder name never became valid',
            predicate: () => nameInput.checkValidity()
          });
          const callCountAfterTyping = reportValidityCallCount;

          requirePromptElement('.cancel-button').click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            callCountAfterEmptySubmit,
            callCountAfterTyping,
            callCountOnOpen,
            isPromptClosedAfterCancel: document.querySelector('.prompt-modal .text-box') === null,
            isStillOpenAfterEmptySubmit,
            matchingFolderPaths: app.vault.getAllFolders().filter((folder) => folder.name === TYPED_NAME).map((folder) => folder.path)
          };
        } finally {
          restoreReportValidity();
        }

        function checkValidityAndCountReport(this: HTMLInputElement): boolean {
          reportValidityCallCount++;
          return originalReportValidity.call(this);
        }

        function requirePromptElement(selector: string): HTMLElement {
          const element = document.querySelector(`.prompt-modal ${selector}`);
          if (!(element instanceof HTMLElement)) {
            throw new TypeError(`No folder name prompt element matching ${selector}.`);
          }
          return element;
        }

        function requirePromptInput(): HTMLInputElement {
          const element = requirePromptElement('.text-box');
          if (!element.instanceOf(HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          return element;
        }

        function restoreReportValidity(): void {
          HTMLInputElement.prototype.reportValidity = originalReportValidity;
        }
      },
      input: { pluginId: PLUGIN_ID }
    });

    // Issue #195: opening the prompt reports nothing — this is the assertion the whole item is about.
    expect(result.callCountOnOpen).toBe(0);
    // ...but the rule itself is unchanged, so submitting empty still refuses AND still says why.
    expect(result.callCountAfterEmptySubmit).toBeGreaterThan(0);
    expect(result.isStillOpenAfterEmptySubmit).toBe(true);
    // Typing reports too — the message must follow the input, not wait for another submit.
    expect(result.callCountAfterTyping).toBeGreaterThan(result.callCountAfterEmptySubmit);
    expect(result.isPromptClosedAfterCancel).toBe(true);
    // Cancel after a VALID name: the prompt is the only thing this test is allowed to have touched.
    expect(result.matchingFolderPaths).toEqual([]);
  });

  it('paints the red invalid outline only once Create is clicked on an empty name, never on open (issue #219)', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Already normalized, so a folder appearing under this exact name is unambiguous evidence that
        // Cancel did not create anything.
        const TYPED_NAME = 'Prompt Outline Probe';

        try {
          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });

          const nameInput = requirePromptInput();
          /*
           * The modal opens INVALID by design: it validates the empty value on open, so that OK refuses.
           * Waiting for that computed error is what makes an outline-free reading meaningful.
           * A wait for the input element alone would only prove that the reading was taken too early.
           */
          await waitUntil({
            message: 'the empty folder name never became invalid',
            predicate: () => nameInput.validity.customError
          });

          // The box shadow is transitioned, so a single reading can catch an interpolated color.
          // Two equal consecutive readings mean the transition has settled.
          let previousBoxShadow = '';
          await waitUntil({
            message: 'the input box shadow never settled after the prompt opened',
            predicate: () => {
              const currentBoxShadow = getBoxShadow();
              const isSettled = currentBoxShadow === previousBoxShadow;
              previousBoxShadow = currentBoxShadow;
              return isSettled;
            }
          });

          const errorColor = getErrorColor();
          const boxShadowOnOpen = getBoxShadow();

          // The reporter's whole complaint is the red arriving before this click; here is where it belongs.
          requirePromptElement('.ok-button').click();
          // A throwing wait would discard the on-open reading, which is the one the issue is about.
          try {
            await waitUntil({
              message: 'the invalid outline never appeared after an empty Create',
              predicate: () => getBoxShadow().includes(errorColor)
            });
          } catch {
            // Diagnostics are returned below.
          }
          const boxShadowAfterEmptySubmit = getBoxShadow();
          const isStillOpenAfterEmptySubmit = document.querySelector('.prompt-modal .text-box') !== null;

          // Typing a valid name clears it again, so the outline tracks the value rather than latching on.
          nameInput.value = TYPED_NAME;
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the typed folder name never became valid',
            predicate: () => nameInput.checkValidity()
          });
          let previousValidBoxShadow = '';
          await waitUntil({
            message: 'the input box shadow never settled after a valid name was typed',
            predicate: () => {
              const currentBoxShadow = getBoxShadow();
              const isSettled = currentBoxShadow === previousValidBoxShadow;
              previousValidBoxShadow = currentBoxShadow;
              return isSettled;
            }
          });
          const boxShadowAfterValidName = getBoxShadow();

          requirePromptElement('.cancel-button').click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            boxShadowAfterEmptySubmit,
            boxShadowAfterValidName,
            boxShadowOnOpen,
            errorColor,
            isPromptClosedAfterCancel: document.querySelector('.prompt-modal .text-box') === null,
            isStillOpenAfterEmptySubmit,
            matchingFolderPaths: app.vault.getAllFolders().filter((folder) => folder.name === TYPED_NAME).map((folder) => folder.path)
          };
        } finally {
          closePromptIfOpen();
        }

        function closePromptIfOpen(): void {
          const cancelButton = document.querySelector('.prompt-modal .cancel-button');
          if (cancelButton instanceof HTMLElement) {
            cancelButton.click();
          }
        }

        function getBoxShadow(): string {
          const nameInput = requirePromptInput();
          return nameInput.win.getComputedStyle(nameInput).boxShadow;
        }

        function getErrorColor(): string {
          /*
           * The stylesheet paints `var(--text-error)` while a computed box shadow carries a resolved color.
           * A throwaway probe resolves the variable in the same document, in the same serialization.
           */
          const nameInput = requirePromptInput();
          const probeEl = nameInput.doc.body.createDiv();
          probeEl.setCssProps({ color: 'var(--text-error)' });
          const errorColor = nameInput.win.getComputedStyle(probeEl).color;
          probeEl.remove();
          return errorColor;
        }

        function requirePromptElement(selector: string): HTMLElement {
          const element = document.querySelector(`.prompt-modal ${selector}`);
          if (!(element instanceof HTMLElement)) {
            throw new TypeError(`No folder name prompt element matching ${selector}.`);
          }
          return element;
        }

        function requirePromptInput(): HTMLInputElement {
          const element = requirePromptElement('.text-box');
          if (!element.instanceOf(HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          return element;
        }
      },
      input: { pluginId: PLUGIN_ID }
    });

    // The probe resolved something, so the assertions below are comparing against a real color.
    expect(result.errorColor).not.toBe('');
    // Issue #219: opening the prompt paints no red — this is the assertion the whole item is about.
    // `not.toBe('none')` would be wrong: the input is focused on open, so the theme paints its own ring.
    expect(result.boxShadowOnOpen).not.toContain(result.errorColor);
    // ...but the rule itself is unchanged, so an empty Create still refuses AND still says so in red.
    expect(result.boxShadowAfterEmptySubmit).toContain(result.errorColor);
    expect(result.isStillOpenAfterEmptySubmit).toBe(true);
    // The outline follows the value rather than latching on once shown.
    expect(result.boxShadowAfterValidName).not.toContain(result.errorColor);
    expect(result.isPromptClosedAfterCancel).toBe(true);
    // Cancel after a VALID name: the prompt is the only thing this test is allowed to have touched.
    expect(result.matchingFolderPaths).toEqual([]);
  });
});
