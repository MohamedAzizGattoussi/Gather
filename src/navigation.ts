import type { State } from './types.ts';

// Route names and collection names differ for Library; keep their mapping explicit.
export function navigationFor(state: State) {
  return [
    { key: 'library', label: 'Library', count: state.items.length },
    { key: 'boards', label: 'Boards', count: state.boards.length },
    { key: 'projects', label: 'Projects', count: state.projects.length },
  ] as const;
}
