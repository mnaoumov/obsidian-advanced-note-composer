import type { App } from 'obsidian';

import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { registerLinkHandlers } from 'obsidian-dev-utils/obsidian/markdown';

interface RenderLinkHandlersWarmupComponentConstructorParams {
  readonly app: App;
}

/**
 * Warms up the one-time cost of `obsidian-dev-utils`' link-handler registration at startup.
 *
 * The first time `registerLinkHandlers` (used by every confirmation-dialog internal link this plugin
 * renders) runs, it derives a DOM-events-handlers constructor from Obsidian's runtime by briefly
 * creating, activating, and detaching a workspace leaf. That one-time leaf dance transiently switches
 * the active tab, which the user perceives as a background "refresh" on their FIRST extract/split/merge
 * after launching Obsidian (issue #102).
 *
 * Paying that cost here, at layout-ready — and restoring the active leaf afterwards so the user's tab is
 * never left switched — moves the blip to startup, where it is expected and unobtrusive. Every later
 * confirmation-dialog link render then finds the cache warm and skips the leaf dance entirely.
 */
export class RenderLinkHandlersWarmupComponent extends LayoutReadyComponent {
  public constructor(params: RenderLinkHandlersWarmupComponentConstructorParams) {
    super(params.app);
  }

  /* v8 ignore start -- Warms an Obsidian-runtime cache that requires a running vault; verified via desktop integration. */
  protected override async onLayoutReady(): Promise<void> {
    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    await registerLinkHandlers({ app: this.app, el: createSpan() });
    if (activeLeaf) {
      this.app.workspace.setActiveLeaf(activeLeaf, { focus: true });
    }
  }
  /* v8 ignore stop */
}
