import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import type { Level } from './markdown-heading-document.ts';

import { CancelMoveCommandHandler } from './command-handlers/cancel-move-command-handler.ts';
import { CreateEmptyNoteAtCursorEditorCommandHandler } from './command-handlers/create-empty-note-at-cursor-editor-command-handler.ts';
import { CreateEmptyNoteInFolderCommandHandler } from './command-handlers/create-empty-note-in-folder-command-handler.ts';
import { CreateFolderWithNotesCommandHandler } from './command-handlers/create-folder-with-notes-command-handler.ts';
import { ExtractAfterCursorEditorCommandHandler } from './command-handlers/extract-after-cursor-editor-command-handler.ts';
import { ExtractBeforeCursorEditorCommandHandler } from './command-handlers/extract-before-cursor-editor-command-handler.ts';
import { ExtractBetweenHorizontalRulesEditorCommandHandler } from './command-handlers/extract-between-horizontal-rules-editor-command-handler.ts';
import { ExtractCurrentSelectionEditorCommandHandler } from './command-handlers/extract-current-selection-editor-command-handler.ts';
import { ExtractThisHeadingEditorCommandHandler } from './command-handlers/extract-this-heading-editor-command-handler.ts';
import { FlattenFolderCommandHandler } from './command-handlers/flatten-folder-command-handler.ts';
import { MarkHeadingToMoveEditorCommandHandler } from './command-handlers/mark-heading-to-move-editor-command-handler.ts';
import { MarkSelectionToMoveEditorCommandHandler } from './command-handlers/mark-selection-to-move-editor-command-handler.ts';
import { MarkSelectionToSwapEditorCommandHandler } from './command-handlers/mark-selection-to-swap-editor-command-handler.ts';
import { MergeFileCommandHandler } from './command-handlers/merge-file-command-handler.ts';
import { MergeFolderCommandHandler } from './command-handlers/merge-folder-command-handler.ts';
import { MergeFolderIntoFileCommandHandler } from './command-handlers/merge-folder-into-file-command-handler.ts';
import { MoveFolderCommandHandler } from './command-handlers/move-folder-command-handler.ts';
import { MoveMarkedSelectionHereEditorCommandHandler } from './command-handlers/move-marked-selection-here-editor-command-handler.ts';
import { MoveMarkedSelectionToEdgeEditorCommandHandler } from './command-handlers/move-marked-selection-to-edge-editor-command-handler.ts';
import { OpenSplitModalCommandHandler } from './command-handlers/open-split-modal-command-handler.ts';
import { RenameFolderCommandHandler } from './command-handlers/rename-folder-command-handler.ts';
import { RenameHeadingEditorCommandHandler } from './command-handlers/rename-heading-editor-command-handler.ts';
import { ReorderChildFoldersCommandHandler } from './command-handlers/reorder-child-folders-command-handler.ts';
import { ReorderHeadingsEditorCommandHandler } from './command-handlers/reorder-headings-editor-command-handler.ts';
import { ReorderSiblingFoldersCommandHandler } from './command-handlers/reorder-sibling-folders-command-handler.ts';
import { SplitHeadingRecursivelyEditorCommandHandler } from './command-handlers/split-heading-recursively-editor-command-handler.ts';
import { SplitNoteByHeadingsContentEditorCommandHandler } from './command-handlers/split-note-by-headings-content-editor-command-handler.ts';
import { SplitNoteByHeadingsEditorCommandHandler } from './command-handlers/split-note-by-headings-editor-command-handler.ts';
import { SplitNoteByHeadingsRecursivelyEditorCommandHandler } from './command-handlers/split-note-by-headings-recursively-editor-command-handler.ts';
import { SwapFileCommandHandler } from './command-handlers/swap-file-command-handler.ts';
import { SwapFolderCommandHandler } from './command-handlers/swap-folder-command-handler.ts';
import { SwapMarkedSelectionEditorCommandHandler } from './command-handlers/swap-marked-selection-editor-command-handler.ts';
import { SwapWithMarkedSelectionEditorCommandHandler } from './command-handlers/swap-with-marked-selection-editor-command-handler.ts';
import { InsertMode } from './insert-mode.ts';
import { MoveNoticeComponent } from './move-notice-component.ts';
import { MoveSelectionBuffer } from './move-selection-buffer.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { FlattenMode } from './plugin-settings.ts';
import { clearRecentTargets } from './recent-targets.ts';
import { ReleaseNotesComponent } from './release-notes-component.ts';
import { SelectionHighlightComponent } from './selection-highlight-component.ts';
import { SwapSelectionBuffer } from './swap-selection-buffer.ts';
import { TokenizedStringLanguageComponent } from './tokenized-string-language-component.ts';

/**
 * Every flatten variant, each of which is registered as its own command (issue #177). Spelled out rather
 * than derived from `Object.values`, so adding a {@link FlattenMode} member is a compile error here as well
 * as in the command definitions, instead of silently registering a command with no identity.
 */
const FLATTEN_MODES: readonly FlattenMode[] = [
  FlattenMode.AllChildren,
  FlattenMode.ChildFoldersOnly,
  FlattenMode.AllFoldersRecursively
];

export class Plugin extends PluginBase {
  protected override async onloadImpl(): Promise<void> {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;

    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab: new PluginSettingsTab({
          plugin: this,
          pluginId: this.manifest.id,
          pluginSettingsComponent
        })
      })
    );

    // The targets a completed operation recorded rank ahead of everything in the pickers (issue #206) and
    // Are deliberately session-only, so they are dropped on unload — a reload starts from Obsidian's own
    // Recency, never from the previous session's operations.
    this.register(clearRecentTargets);

    // eslint-disable-next-line no-magic-numbers -- Self-descriptive magic numbers.
    const HEADING_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];
    const resourceLockComponent = this.resourceLockComponent;

    const moveSelectionBuffer = new MoveSelectionBuffer();
    // Release any held source-note lock when the plugin unloads so a mark never leaks a lock.
    this.register(() => {
      moveSelectionBuffer.clear();
    });

    // Holds the first side of a pending selection swap (no lock is held while marked). Clear it on
    // Unload so a stale mark never survives a reload.
    const swapSelectionBuffer = new SwapSelectionBuffer();
    this.register(() => {
      swapSelectionBuffer.clear();
    });

    // Persistently highlights the captured selection of a pending smart-cut mark or split/extract setup
    // In its source note. The editor extension must be registered for the field to exist in every editor.
    const selectionHighlightComponent = this.addChild(new SelectionHighlightComponent({ app: this.app }));
    this.registerEditorExtension(selectionHighlightComponent.getEditorExtension());

    // The three move commands are created up front so the marked-selection notice can offer them as
    // Buttons (and reflect their availability) — see MoveNoticeComponent.
    // Every handler that both backs a notice button AND is registered as a command is built through a
    // Builder rather than shared. Since obsidian-dev-utils 90 a command handler instance cannot be
    // Registered twice, and the factory below runs once per menu surface, so handing it the same instance
    // Throws and the whole plugin fails to load. The notice keeps its own unregistered instance: it calls
    // The handler directly (canExecuteInActiveEditor / executeInActiveEditor / cancelMove), which reads
    // Constructor state only, exactly like the already-unregistered swapMarkedSelectionHandler below.
    const buildMoveAtCursorHandler = (isAdvanced: boolean): MoveMarkedSelectionHereEditorCommandHandler =>
      new MoveMarkedSelectionHereEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        isAdvanced,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      });
    const buildMoveToEdgeHandler = (insertMode: InsertMode): MoveMarkedSelectionToEdgeEditorCommandHandler =>
      new MoveMarkedSelectionToEdgeEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        insertMode,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      });
    const buildCancelMoveCommandHandler = (): CancelMoveCommandHandler =>
      new CancelMoveCommandHandler({
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent
      });
    // The two heading-only notice buttons drive these EXISTING commands (issues #228/#229) rather than
    // Reimplementing them, so they are built the same way: one unregistered instance for the notice, and a
    // Separate registered one below.
    const buildSplitHeadingRecursivelyEditorCommandHandler = (): SplitHeadingRecursivelyEditorCommandHandler =>
      new SplitHeadingRecursivelyEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      });
    const buildReorderHeadingsEditorCommandHandler = (): ReorderHeadingsEditorCommandHandler =>
      new ReorderHeadingsEditorCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      });

    const moveAtCursorHandler = buildMoveAtCursorHandler(false);
    const moveToTopHandler = buildMoveToEdgeHandler(InsertMode.Prepend);
    const moveToBottomHandler = buildMoveToEdgeHandler(InsertMode.Append);
    const cancelMoveCommandHandler = buildCancelMoveCommandHandler();

    // Backs the notice's `Swap with selection` button only (not registered as a command, so no hotkey
    // And no main-editor key interception).
    const swapMarkedSelectionHandler = new SwapMarkedSelectionEditorCommandHandler({
      app: this.app,
      moveSelectionBuffer,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent,
      resourceLockComponent
    });

    const moveNoticeComponent = this.addChild(
      new MoveNoticeComponent({
        app: this.app,
        cancelMoveCommandHandler,
        moveAtCursorHandler,
        moveSelectionBuffer,
        moveToBottomHandler,
        moveToTopHandler,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        reorderHeadingsHandler: buildReorderHeadingsEditorCommandHandler(),
        splitHeadingRecursivelyHandler: buildSplitHeadingRecursivelyEditorCommandHandler(),
        swapMarkedSelectionHandler
      })
    );

    const buildExtractCurrentSelectionEditorCommandHandler = (): ExtractCurrentSelectionEditorCommandHandler =>
      new ExtractCurrentSelectionEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        moveNoticeComponent,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        selectionHighlightComponent
      });
    const buildOpenSplitModalCommandHandler = (): OpenSplitModalCommandHandler =>
      new OpenSplitModalCommandHandler({
        app: this.app,
        extractCurrentSelectionEditorCommandHandler: buildExtractCurrentSelectionEditorCommandHandler(),
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent
      });

    moveNoticeComponent.setOpenSplitModalCommandHandler(buildOpenSplitModalCommandHandler());

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new MergeFileCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      buildExtractCurrentSelectionEditorCommandHandler(),
      new ExtractThisHeadingEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        moveNoticeComponent,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        selectionHighlightComponent
      }),
      new ExtractBeforeCursorEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        moveNoticeComponent,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        selectionHighlightComponent
      }),
      new ExtractAfterCursorEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        moveNoticeComponent,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        selectionHighlightComponent
      }),
      new CreateEmptyNoteAtCursorEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new CreateEmptyNoteInFolderCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new ExtractBetweenHorizontalRulesEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        moveNoticeComponent,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        selectionHighlightComponent
      }),
      new MarkSelectionToMoveEditorCommandHandler({
        app: this.app,
        moveNoticeComponent,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        selectionHighlightComponent
      }),
      // The same mark, scoped to the heading the cursor is in — heading line, body and everything nested
      // Under it (issue #229).
      new MarkHeadingToMoveEditorCommandHandler({
        app: this.app,
        moveNoticeComponent,
        moveSelectionBuffer,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        selectionHighlightComponent
      }),
      buildMoveAtCursorHandler(false),
      buildMoveAtCursorHandler(true),
      buildMoveToEdgeHandler(InsertMode.Prepend),
      buildMoveToEdgeHandler(InsertMode.Append),
      buildCancelMoveCommandHandler(),
      buildOpenSplitModalCommandHandler(),
      new MergeFolderCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new MergeFolderIntoFileCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new SwapFileCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new SwapFolderCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new MarkSelectionToSwapEditorCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        swapSelectionBuffer
      }),
      new SwapWithMarkedSelectionEditorCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        swapSelectionBuffer
      }),
      // One command per flatten variant, so the variant is chosen at invocation time from the folder menu
      // Rather than pre-committed in settings (issue #177). `AllChildren` keeps the original
      // `flatten-folder` id so existing hotkeys survive.
      ...FLATTEN_MODES.map((flattenMode) =>
        new FlattenFolderCommandHandler({
          app: this.app,
          flattenMode,
          pluginNoticeComponent: this.pluginNoticeComponent,
          pluginSettingsComponent,
          resourceLockComponent
        })
      ),
      new MoveFolderCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new CreateFolderWithNotesCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new RenameFolderCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new RenameHeadingEditorCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      buildReorderHeadingsEditorCommandHandler(),
      new ReorderSiblingFoldersCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new ReorderChildFoldersCommandHandler({
        app: this.app,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      }),
      new SplitNoteByHeadingsRecursivelyEditorCommandHandler({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      }),
      // The same recursion scoped to the heading the cursor is in, leaving the note's other headings
      // Intact (issue #228).
      buildSplitHeadingRecursivelyEditorCommandHandler(),
      ...HEADING_LEVELS.flatMap((headingLevel) => [
        new SplitNoteByHeadingsEditorCommandHandler({
          app: this.app,
          consoleDebugComponent: this.consoleDebugComponent,
          headingLevel,
          pluginNoticeComponent: this.pluginNoticeComponent,
          pluginSettingsComponent,
          resourceLockComponent
        }),
        new SplitNoteByHeadingsContentEditorCommandHandler({
          app: this.app,
          consoleDebugComponent: this.consoleDebugComponent,
          headingLevel,
          pluginNoticeComponent: this.pluginNoticeComponent,
          pluginSettingsComponent,
          resourceLockComponent
        })
      ])
    ]);

    this.addChild(new TokenizedStringLanguageComponent());
    this.addChild(
      new ReleaseNotesComponent({
        app: this.app,
        pluginSettingsComponent
      })
    );
  }
}
