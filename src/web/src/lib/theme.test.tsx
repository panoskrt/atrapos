import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './theme';

function Probe() {
  const { design, setDesign } = useTheme();
  return (
    <button type="button" onClick={() => setDesign('soft')}>
      {design}
    </button>
  );
}

describe('ThemeProvider designs', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.design;
  });

  it('starts on the classic design and marks the page with it', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('classic');
    expect(document.documentElement.dataset.design).toBe('classic');
  });

  it('remembers a chosen design for the next visit', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole('button').click());
    expect(document.documentElement.dataset.design).toBe('soft');
    expect(localStorage.getItem('rpm.design')).toBe('soft');
  });

  it('ignores a stored design it does not know', () => {
    localStorage.setItem('rpm.design', 'neon');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('classic');
  });
});
