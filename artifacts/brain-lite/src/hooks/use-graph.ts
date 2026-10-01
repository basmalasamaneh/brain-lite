import { useEffect, useState } from 'react';
import { useAuth } from '@workspace/replit-auth-web';
import { getGetGraphQueryKey, getGetMemoryQueryKey, useGetGraph, useGetMemory } from '@workspace/api-client-react';
import { filtersToParams, type GraphFilters } from '@/lib/graph-model';

/** Owner-scoped graph query. Key starts with /api/graph so every mutation's central invalidation refreshes it. */
export function useLifeGraph(filters: GraphFilters, enabled = true) {
  const { user } = useAuth();
  const params = filtersToParams(filters);
  return useGetGraph(params, {
    query: { queryKey: [...getGetGraphQueryKey(params), user?.id], enabled: !!user && enabled, staleTime: 20_000, refetchInterval: 30_000 },
    request: { credentials: 'include' },
  });
}

/** Lazy summary for the node sheet. */
export function useGraphMemoryDetail(id: number | null) {
  const { user } = useAuth();
  return useGetMemory(id ?? 0, {
    query: { queryKey: [...getGetMemoryQueryKey(id ?? 0), user?.id], enabled: !!user && !!id, staleTime: 30_000 },
    request: { credentials: 'include' },
  });
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}
