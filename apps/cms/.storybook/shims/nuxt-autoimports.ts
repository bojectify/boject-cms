import { ref, type Ref } from 'vue';
import { $fetch as ofetchFn } from 'ofetch';

// Minimal Storybook-only shims for the Nuxt auto-imported helpers our
// components use. Real Nuxt composables live in the Nuxt runtime, which
// isn't loaded in the Storybook Vite bundle.

export const $fetch = ofetchFn;

export function useRequestHeaders(): Record<string, string> {
  return {};
}

export function useRequestFetch() {
  return ofetchFn;
}

export function useFetch<T = unknown>(
  url: string | (() => string | null),
  options?: Parameters<typeof ofetchFn>[1]
): {
  data: Ref<T | null>;
  pending: Ref<boolean>;
  error: Ref<Error | null>;
  status: Ref<'idle' | 'pending' | 'success' | 'error'>;
  refresh: () => Promise<void>;
  execute: () => Promise<void>;
} {
  const data = ref<T | null>(null) as Ref<T | null>;
  const pending = ref(true);
  const error = ref<Error | null>(null);
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('pending');

  const resolveUrl = typeof url === 'function' ? url() : url;
  if (resolveUrl == null) {
    pending.value = false;
    status.value = 'idle';
  } else {
    ofetchFn<T>(resolveUrl, options)
      .then((res) => {
        data.value = res;
        status.value = 'success';
      })
      .catch((err: Error) => {
        error.value = err;
        status.value = 'error';
      })
      .finally(() => {
        pending.value = false;
      });
  }

  return {
    data,
    pending,
    error,
    status,
    refresh: async () => {},
    execute: async () => {},
  };
}

// Minimal Nuxt UI toast shim. Captured to window so play functions can
// assert on toast output.
type Toast = { title?: string; description?: string; color?: string };

declare global {
  interface Window {
    __storybook_toasts__: Toast[];
  }
}

if (typeof window !== 'undefined') {
  window.__storybook_toasts__ = [];
}

export function useToast() {
  return {
    add: (toast: Toast) => {
      if (typeof window !== 'undefined') {
        window.__storybook_toasts__.push(toast);
      }
    },
    remove: () => {},
    clear: () => {
      if (typeof window !== 'undefined') {
        window.__storybook_toasts__ = [];
      }
    },
  };
}

// Stub navigation — we never actually navigate in Storybook.
export async function navigateTo() {}
