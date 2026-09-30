import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import {
  useGetConnectionSuggestions, useGetMemoryConnections, useGetConnectionSettings,
  useConfirmConnection, useDismissConnection, useRemoveConnection, useCreateMemoryConnection,
  useMergeConnection, useUpdateConnectionSettings, useDiscoverConnections,
} from '@workspace/api-client-react';
export type { Connection, RelationType } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n';
import { connectionText, type ConnectionTextKey } from '@/lib/i18n-connections';
import { clearDeferredConnections, deferredConnectionsKey, readDeferredConnections, saveDeferredConnection } from '@/lib/deferred-connections';

type ConnectionAction =
  | { action: 'confirm' | 'dismiss' | 'remove'; id: number }
  | { action: 'link'; memoryId: number; otherId: number }
  | { action: 'merge'; id: number; keepId: number }
  | { action: 'settings'; automatic: boolean }
  | { action: 'discover' };

export function useConnectionSuggestions() {
  const { user } = useAuth();
  return useGetConnectionSuggestions({ query: {
    queryKey: ['/api/connections/suggestions', user?.id], enabled: !!user,
    staleTime: 15_000, refetchInterval: 30_000,
  }, request: { credentials: 'include' } });
}

export function useMemoryConnections(id: number) {
  const { user } = useAuth();
  return useGetMemoryConnections(id, { query: {
    queryKey: [`/api/memories/${id}/connections`, user?.id], enabled: !!user && id > 0,
    staleTime: 15_000, refetchInterval: 30_000,
  }, request: { credentials: 'include' } });
}

export function useConnectionSettings() {
  const { user } = useAuth();
  return useGetConnectionSettings({ query: {
    queryKey: ['/api/connections/settings', user?.id], enabled: !!user,
    staleTime: 15_000, refetchInterval: 30_000,
  }, request: { credentials: 'include' } });
}

export function useConnectionAction() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { lang } = useI18n();
  const options = { request: { credentials: 'include' as const } };
  const confirm = useConfirmConnection(options);
  const dismiss = useDismissConnection(options);
  const remove = useRemoveConnection(options);
  const link = useCreateMemoryConnection(options);
  const merge = useMergeConnection(options);
  const settings = useUpdateConnectionSettings(options);
  const discover = useDiscoverConnections(options);
  const messages: Record<ConnectionAction['action'], ConnectionTextKey> = {
    confirm: 'linked', dismiss: 'dismissed', remove: 'removed', link: 'linked', merge: 'merged', settings: 'saved', discover: 'queued',
  };
  return useMutation({
    mutationFn: async (input: ConnectionAction) => {
      if (!user) throw new Error('Authentication required');
      switch (input.action) {
        case 'confirm': return confirm.mutateAsync({ id: input.id });
        case 'dismiss': return dismiss.mutateAsync({ id: input.id });
        case 'remove': return remove.mutateAsync({ id: input.id });
        case 'link':
          if (input.memoryId === input.otherId) throw new Error(connectionText(lang, 'self'));
          return link.mutateAsync({ id: input.memoryId, data: { other_id: input.otherId } });
        case 'merge': return merge.mutateAsync({ id: input.id, data: { keep_memory_id: input.keepId, confirm: true } });
        case 'settings': return settings.mutateAsync({ data: { automatic: input.automatic } });
        case 'discover': return discover.mutateAsync();
      }
    },
    onSuccess: (_, input) => {
      qc.invalidateQueries({ predicate: (q) => {
        const key = String(q.queryKey[0] ?? '');
        return ['/api/connections', '/api/memories', '/api/brain', '/api/search', '/api/indexing'].some((prefix) => key.startsWith(prefix));
      } });
      toast({ title: connectionText(lang, messages[input.action]), ...(input.action === 'discover' ? { description: connectionText(lang, 'queuedBody') } : {}) });
    },
    onError: (error) => toast({ variant: 'destructive', title: connectionText(lang, 'error'), description: error.message }),
  });
}

// Browser-local, owner-scoped deferral. Later never sends a dismiss request.
export function useDeferredConnections() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lang } = useI18n();
  const owner = user?.id;
  const key = ['/local/connections/deferred', owner];
  const load = () => {
    try { return { ids: owner ? readDeferredConnections(owner) : [], error: false }; }
    catch { return { ids: [] as number[], error: true }; }
  };
  const query = useQuery({
    queryKey: key, queryFn: load, initialData: load,
    enabled: false, staleTime: Infinity, gcTime: Infinity,
  });
  const persistenceError = () => toast({
    variant: 'destructive', title: connectionText(lang, 'laterError'),
    description: connectionText(lang, 'laterErrorBody'),
  });
  useEffect(() => {
    if (query.data.error) persistenceError();
  }, [query.data.error, lang]);
  useEffect(() => {
    if (!owner) return;
    // Rehydrate on remount too: another tab may have changed storage while this
    // deck was not mounted and its query cache was still retained.
    qc.setQueryData(['/local/connections/deferred', owner], load());
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key === deferredConnectionsKey(owner)) {
        qc.setQueryData(['/local/connections/deferred', owner], load());
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [owner, qc]);
  const update = (id?: number) => {
    if (!owner) { persistenceError(); return false; }
    try {
      const ids = id === undefined ? (clearDeferredConnections(owner), []) : saveDeferredConnection(owner, id);
      qc.setQueryData(key, { ids, error: false });
      return true;
    } catch {
      persistenceError();
      return false;
    }
  };
  return {
    ids: owner ? query.data.ids : [],
    defer: (id: number) => update(id),
    reset: () => update(),
  };
}