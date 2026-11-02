import { beforeEach, describe, expect, it } from 'vitest';
import { useSectionStore } from './store';

const s = () => useSectionStore.getState();

describe('section store', () => {
  beforeEach(() => s().clear());

  it('orders a range given backwards', () => {
    s().setRange(900, 300);
    expect([s().from, s().to]).toEqual([300, 900]);
  });

  it('completes a section with the second of two picks, in either order', () => {
    s().pick(800);
    expect(s().pending).toBe(800);
    expect(s().from).toBeNull();
    s().pick(200);
    expect([s().from, s().to, s().pending]).toEqual([200, 800, null]);
  });

  it('starts a new pick after a finished section', () => {
    s().setRange(100, 200);
    s().pick(500);
    expect([s().from, s().to, s().pending]).toEqual([null, null, 500]);
  });

  it('keeps the ends in order while one is adjusted', () => {
    s().setRange(300, 600);
    s().setFrom(900);
    expect([s().from, s().to]).toEqual([600, 600]);
    s().setTo(100);
    expect([s().from, s().to]).toEqual([600, 600]);
  });

  it('ignores end adjustments when nothing is selected', () => {
    s().setFrom(100);
    s().setTo(200);
    expect([s().from, s().to]).toEqual([null, null]);
  });

  it('clears both a section and a half-made pick', () => {
    s().pick(10);
    s().clear();
    expect(s().pending).toBeNull();
  });
});
