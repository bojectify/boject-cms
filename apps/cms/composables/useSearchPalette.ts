import type { SearchQuery, QueryContentType } from '~/utils/queryBuilder/types';
import { planNavigation } from '~/utils/queryBuilder/navigation';

/** Global palette open-state + the single navigation authority for run/broaden/edit. */
export function useSearchPalette() {
  const isOpen = useState('search-palette-open', () => false);
  const router = useRouter();

  function open() {
    isOpen.value = true;
  }
  function close() {
    isOpen.value = false;
  }

  /** Compile a query to a route and push it (used by run, broaden, and the chip-summary bar). */
  async function navigate(
    query: SearchQuery,
    contentTypes: QueryContentType[]
  ) {
    const plan = planNavigation(query, contentTypes);
    close();
    await router.push({ path: plan.path, query: plan.query });
  }

  return { isOpen, open, close, navigate };
}
