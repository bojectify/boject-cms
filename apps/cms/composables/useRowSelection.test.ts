import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useRowSelection } from './useRowSelection';

const rows = (...ids: string[]) => ref(ids.map((id) => ({ id })));

describe('useRowSelection', () => {
  it('click toggles a single row and sets the anchor', () => {
    const s = useRowSelection(rows('a', 'b', 'c'));
    s.toggle('b', 1, false);
    expect([...s.selected.value]).toEqual(['b']);
    expect(s.count.value).toBe(1);
    s.toggle('b', 1, false);
    expect(s.count.value).toBe(0);
  });

  it('shift+click turns ON the inclusive range from the anchor to the target', () => {
    const s = useRowSelection(rows('a', 'b', 'c', 'd', 'e'));
    s.toggle('b', 1, false); // anchor = 1
    s.toggle('d', 3, true); // range 1..3 → b,c,d ON
    expect([...s.selected.value].sort()).toEqual(['b', 'c', 'd']);
  });

  it('shift+click works upward (target above anchor) and never deselects', () => {
    const s = useRowSelection(rows('a', 'b', 'c', 'd', 'e'));
    s.toggle('d', 3, false); // anchor = 3
    s.toggle('a', 0, true); // range 0..3 → a,b,c,d ON
    expect([...s.selected.value].sort()).toEqual(['a', 'b', 'c', 'd']);
    s.toggle('e', 4, true); // re-range from the SAME anchor (3) → 3..4 adds d,e; existing stay
    expect([...s.selected.value].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('shift+click with no anchor behaves like a plain toggle', () => {
    const s = useRowSelection(rows('a', 'b', 'c'));
    s.toggle('b', 1, true);
    expect([...s.selected.value]).toEqual(['b']);
  });

  it('toggleAll selects all then clears; indeterminate reflects partial', () => {
    const s = useRowSelection(rows('a', 'b', 'c'));
    s.toggle('a', 0, false);
    expect(s.indeterminate.value).toBe(true);
    expect(s.allSelected.value).toBe(false);
    s.toggleAll();
    expect(s.allSelected.value).toBe(true);
    expect(s.indeterminate.value).toBe(false);
    s.toggleAll();
    expect(s.count.value).toBe(0);
  });

  it('clear empties the selection', () => {
    const s = useRowSelection(rows('a', 'b'));
    s.toggle('a', 0, false);
    s.clear();
    expect(s.count.value).toBe(0);
  });
});
