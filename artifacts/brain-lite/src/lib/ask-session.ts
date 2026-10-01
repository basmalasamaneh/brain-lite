import { useSyncExternalStore } from 'react';
import type { Memory } from '@workspace/api-client-react';

// In-memory chat for this tab only. Never persisted. Cleared on identity change or data deletion.
export type ChatTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; sources: (Memory & { relevance?: number })[] }
  | { id: string; role: 'error'; question: string; message: 'generic' | 'auth' | 'config' };

let owner: string | null = null;
let scope = '';
let revision = 0;
let turns: ChatTurn[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const askSession = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  get: () => turns,
  setOwner(id: string | null) { if (id !== owner) { owner = id; turns = []; revision++; emit(); } },
  setScope(key: string) { if (key !== scope) { scope = key; turns = []; revision++; emit(); } },
  token: () => revision,
  pushForSession(id: string | null, key: string, token: number, t: ChatTurn) {
    if (id === owner && key === scope && token === revision) { turns = [...turns, t]; emit(); }
  },
  push(t: ChatTurn) { turns = [...turns, t]; emit(); },
  pushForOwner(id: string | null, t: ChatTurn) { if (id === owner) { turns = [...turns, t]; emit(); } },
  removeById(id: string) { turns = turns.filter((t) => t.id !== id); emit(); },
  clear() { turns = []; revision++; emit(); },
};

const emptyTurns: ChatTurn[] = [];
export function useAskTurns(key?: string) {
  return useSyncExternalStore(askSession.subscribe, () => key === undefined || key === scope ? askSession.get() : emptyTurns);
}

export function parseAskScope(search: string) {
  const params = new URLSearchParams(search);
  const raw = params.get('memory_ids');
  if (raw === null) return { key: '', memoryIds: undefined, label: '', invalid: false };
  const parts = raw.split(',');
  const invalid = params.getAll('memory_ids').length !== 1 || parts.length < 1 || parts.length > 300 ||
    parts.some((part) => !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)) || Number(part) > 2147483647);
  const memoryIds = invalid ? undefined : [...new Set(parts.map(Number))].sort((a, b) => a - b);
  const label = (params.get('scope_label') ?? '').trim().slice(0, 160);
  return { key: invalid ? `invalid:${raw}` : `memories:${memoryIds!.join(',')}`, memoryIds, label, invalid };
}

export const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
