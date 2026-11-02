import { create } from 'zustand';

interface Task {
  id: number;
  label: string;
}

const useStore = create<{ tasks: Task[] }>()(() => ({ tasks: [] }));
let nextId = 1;

/** Runs a call that reaches Suunto's servers and shows it in the app-wide activity indicator until it settles. */
export async function withSuunto<T>(label: string, call: () => Promise<T>): Promise<T> {
  const task = { id: nextId++, label };
  useStore.setState((s) => ({ tasks: [...s.tasks, task] }));
  try {
    return await call();
  } finally {
    useStore.setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) }));
  }
}

/** What the app is currently doing with Suunto (the latest call), or null when idle. */
export function useSuuntoActivity(): string | null {
  return useStore((s) => s.tasks.at(-1)?.label ?? null);
}
