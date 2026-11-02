import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BarChart, niceScale } from './BarChart';

describe('niceScale', () => {
  it('rounds the axis up to clean whole-number steps', () => {
    expect(niceScale(0)).toEqual({ top: 4, step: 1 });
    expect(niceScale(3)).toEqual({ top: 3, step: 1 });
    expect(niceScale(7)).toEqual({ top: 8, step: 2 });
    expect(niceScale(23)).toEqual({ top: 30, step: 10 });
    expect(niceScale(870)).toEqual({ top: 1000, step: 500 });
  });
});

describe('BarChart', () => {
  const buckets = ['2026-10-01', '2026-10-02', '2026-10-03'];

  it('summarises the series for assistive technology', () => {
    render(<BarChart title="Routes created" buckets={buckets} values={[1, 5, 0]} bucket="day" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Routes created: 6 in total, highest 5');
  });

  it('reads a column with the arrow keys', async () => {
    render(<BarChart title="Routes created" buckets={buckets} values={[1, 5, 0]} bucket="day" />);
    screen.getByRole('img').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('status').textContent).toContain('5');
    expect(screen.getByRole('status').textContent).toMatch(/Oct.*2026|2026.*Oct/);
    expect(screen.getByRole('status').textContent).toMatch(/\b2\b/);
  });
});
