import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type Design = 'classic' | 'alpine' | 'soft';
export type MenuPosition = 'left' | 'top';

const STORAGE_KEY = 'rpm.theme';
const DESIGN_KEY = 'rpm.design';
const MENU_KEY = 'rpm.menu';

export const designs: { id: Design; label: string; description: string }[] = [
  { id: 'classic', label: 'Classic', description: 'The original look: dark glass panels with a cyan accent.' },
  { id: 'alpine', label: 'Alpine', description: 'Light and editorial: calm greens, serif headings and hairline borders.' },
  { id: 'soft', label: 'Soft', description: 'Warm and friendly: rounded shapes and an orange accent.' },
];

function readStoredDesign(): Design {
  try {
    const v = localStorage.getItem(DESIGN_KEY);
    return designs.some((d) => d.id === v) ? (v as Design) : 'classic';
  } catch {
    return 'classic';
  }
}

function readStoredMenuPosition(): MenuPosition {
  try {
    return localStorage.getItem(MENU_KEY) === 'top' ? 'top' : 'left';
  } catch {
    return 'left';
  }
}

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  design: Design;
  setDesign: (design: Design) => void;
  menuPosition: MenuPosition;
  setMenuPosition: (position: MenuPosition) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? systemTheme());
  const [design, setDesign] = useState<Design>(readStoredDesign);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(readStoredMenuPosition);

  // Layout effects, so code that reads the theme's CSS variables in an effect sees them already switched.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.dataset.design = design;
  }, [design]);

  useLayoutEffect(() => {
    document.documentElement.dataset.menu = menuPosition;
  }, [menuPosition]);

  const persistDesign = useCallback((next: Design) => {
    setDesign(next);
    try {
      localStorage.setItem(DESIGN_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice just won't persist.
    }
  }, []);

  const persistMenuPosition = useCallback((next: MenuPosition) => {
    setMenuPosition(next);
    try {
      localStorage.setItem(MENU_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice just won't persist.
    }
  }, []);

  const persistTheme = useCallback((next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice just won't persist.
    }
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme: persistTheme,
      design,
      setDesign: persistDesign,
      menuPosition,
      setMenuPosition: persistMenuPosition,
    }),
    [theme, persistTheme, design, persistDesign, menuPosition, persistMenuPosition],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
