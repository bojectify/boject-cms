import {
  onBeforeUnmount,
  onMounted,
  ref,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute('disabled'))
    .filter((el) => el.tabIndex !== -1)
    .filter((el) => {
      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      return (
        !!style && style.visibility !== 'hidden' && style.display !== 'none'
      );
    });
}

export type UseDialogA11yOptions = {
  /** Whether the dialog is currently the active/topmost dialog. */
  active: MaybeRefOrGetter<boolean>;
  /** Called when Escape is pressed while the dialog is active. */
  onEscape: () => void;
};

/**
 * Wires WAI-ARIA dialog behaviour onto a content element ref:
 *  - Escape-to-close
 *  - Tab/Shift+Tab focus trap inside the content element
 *  - Initial focus on activation
 *  - Focus restoration to the previously focused element on deactivation
 *
 * Bind the returned `contentRef` to the pane's content container.
 */
export function useDialogA11y(opts: UseDialogA11yOptions): {
  contentRef: Ref<HTMLElement | null>;
} {
  const contentRef = ref<HTMLElement | null>(null);
  let previouslyFocused: HTMLElement | null = null;
  let listenerAttached = false;

  function isActive(): boolean {
    const a = opts.active;
    return typeof a === 'function' ? (a as () => boolean)() : !!a;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isActive()) return;
    const root = contentRef.value;
    if (!root) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      opts.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(root);
    if (focusable.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = root.ownerDocument.activeElement as HTMLElement | null;
    const inside = !!active && root.contains(active);
    if (!inside) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function attachListener() {
    if (listenerAttached) return;
    const doc = contentRef.value?.ownerDocument ?? document;
    doc.addEventListener('keydown', handleKeydown, true);
    listenerAttached = true;
  }

  function detachListener() {
    if (!listenerAttached) return;
    const doc = contentRef.value?.ownerDocument ?? document;
    doc.removeEventListener('keydown', handleKeydown, true);
    listenerAttached = false;
  }

  function captureFocus() {
    const root = contentRef.value;
    if (!root) return;
    previouslyFocused =
      (root.ownerDocument.activeElement as HTMLElement | null) ?? null;
    queueMicrotask(() => {
      if (!contentRef.value) return;
      const focusable = getFocusable(contentRef.value);
      if (focusable.length > 0) {
        focusable[0]!.focus();
      } else {
        contentRef.value.focus();
      }
    });
  }

  function restoreFocus() {
    if (previouslyFocused && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
  }

  // Listener is attached for the lifetime of the host component. The
  // handler itself short-circuits when not active. This avoids tricky
  // ordering between `immediate` watchers and template-ref population.
  onMounted(() => {
    attachListener();
    if (isActive()) captureFocus();
  });

  // We deliberately don't react to active toggling at runtime:
  // - Going inactive (child pane mounts on top): the child's captureFocus
  //   has already moved focus. Doing nothing leaves it there.
  // - Becoming active again (child pane closes): the child's restoreFocus
  //   has already returned focus to the card that opened it. Re-capturing
  //   here would steal that focus to our first focusable instead.
  // Restoration happens only on unmount (the dialog actually closing).

  onBeforeUnmount(() => {
    detachListener();
    restoreFocus();
  });

  return { contentRef };
}
