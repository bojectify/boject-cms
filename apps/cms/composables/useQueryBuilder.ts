import { ref, computed, type Ref } from 'vue';
import {
  initState,
  reduce,
  type BuilderState,
  type Action,
  type InitOptions,
} from '~/utils/queryBuilder/machine';

export function useQueryBuilder(opts: InitOptions) {
  const state: Ref<BuilderState> = ref(initState(opts));
  function dispatch(action: Action) {
    state.value = reduce(state.value, action);
    return state.value.intent; // host reads run/broaden intents
  }
  return { state, dispatch, query: computed(() => state.value.query) };
}
