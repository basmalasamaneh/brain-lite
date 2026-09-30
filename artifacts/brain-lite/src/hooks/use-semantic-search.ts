import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import { useSearchRelated, useGetSimilarMemories, useGetIndexingStatus, useReindexMemories, type Memory } from '@workspace/api-client-react';

export type RankedMemory = Memory & { relevance: number };
export type SearchFilters = { type?: string; date_from?: string; date_to?: string };
export type IndexStatus = { indexed: number; total: number; pending: number; failed: number; mode: string };

export function useRelatedMemories(q: string, filters: SearchFilters, enabled = true) {
  const { user } = useAuth();
  return useSearchRelated({ q, ...filters }, { query: {
    queryKey: ['/api/search/related', user?.id, q, filters],
    enabled: !!user && !!q && enabled, staleTime: 60_000,
  }, request: { credentials: 'include' } });
}

export function useSimilarMemories(id: number, enabled = true) {
  const { user } = useAuth();
  return useGetSimilarMemories(id, { query: {
    queryKey: [`/api/memories/${id}/similar`, user?.id],
    enabled: !!user && enabled, staleTime: 30_000,
  }, request: { credentials: 'include' } });
}

export function useIndexStatus() {
  const { user } = useAuth();
  return useGetIndexingStatus({ query: {
    queryKey: ['/api/indexing/status', user?.id],
    enabled: !!user, refetchInterval: 5_000,
  }, request: { credentials: 'include' } });
}

export function useReindex() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useReindexMemories({ mutation: {
    onSuccess: (status) => {
      qc.setQueryData(['/api/indexing/status', user?.id], status);
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes('/similar') || q.queryKey[0] === '/api/search/related' });
    },
  }, request: { credentials: 'include' } });
}