import { useSyncExternalStore } from 'react';
import type { Memory } from '@workspace/api-client-react';

// In-memory chat for this tab only. Never persisted. Cleared on identity change or data deletion.
export type ChatTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; sources: Memory[] }
  | { id: string; role: 'error'; question: string; message: 'generic' | 'auth' | 'config' };

let owner: string | null = null;
let turns: ChatTurn[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const askSession = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  get: () => turns,
  setOwner(id: string | null) { if (id !== owner) { owner = id; turns = []; emit(); } },
  push(t: ChatTurn) { turns = [...turns, t]; emit(); },
  removeById(id: string) { turns = turns.filter((t) => t.id !== id); emit(); },
  clear() { turns = []; emit(); },
};

export function useAskTurns() { return useSyncExternalStore(askSession.subscribe, askSession.get); }

export const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
