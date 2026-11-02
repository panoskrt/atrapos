import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSelection } from './useSelection';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('useSelection', () => {
  it('toggles items and reports tri-state', () => {
    const { result } = renderHook(() => useSelection(ids));
    act(() => result.current.toggle('b'));
    expect(result.current.ids).toEqual(['b']);
    expect(result.current.stateOf()).toBe('some');
    expect(result.current.stateOf(['b'])).toBe('all');
    act(() => result.current.toggle('b'));
    expect(result.current.stateOf()).toBe('none');
  });

  it('shift selects a range from the last toggled item, in either direction', () => {
    const { result } = renderHook(() => useSelection(ids));
    act(() => result.current.toggle('d'));
    act(() => result.current.toggle('b', true));
    expect(result.current.ids).toEqual(['b', 'c', 'd']);
    // The range takes the anchor's state: shift-clicking from a deselected item deselects.
    act(() => result.current.toggle('c'));
    act(() => result.current.toggle('e', true));
    expect(result.current.ids).toEqual(['b']);
  });

  it('select all selects everything shown, then clears it', () => {
    const { result } = renderHook(() => useSelection(ids));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(5);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
  });

  it('never reports items that are no longer shown', () => {
    const { result, rerender } = renderHook(({ visible }) => useSelection(visible), { initialProps: { visible: ids } });
    act(() => result.current.toggleAll());
    rerender({ visible: ['a', 'c'] });
    expect(result.current.ids).toEqual(['a', 'c']);
    expect(result.current.stateOf()).toBe('all');
  });
});
