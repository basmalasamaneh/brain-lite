import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import {
  useListSpaces, useGetSpace, useListSpaceMemories, useListMemorySpaces, useListMemorySpaceSuggestions, useListSpaceSuggestions,
  useCreateSpace, useUpdateSpace, useDeleteSpace, useAddSpaceMemory, useDismissSpaceMemory,
  useConfirmSpaceSuggestion, useDismissSpaceSuggestion, useHideSpaceProfileItem,
  getListSpacesQueryKey, getGetSpaceQueryKey, getListSpaceMemoriesQueryKey, getListMemorySpacesQueryKey,
  getListMemorySpaceSuggestionsQueryKey, getListSpaceSuggestionsQueryKey,
  type Space, type SpaceInput, type SpaceUpdate, type SpaceDetail, type SpaceCreationSuggestion, type ListSpaceMemoriesFilter,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { spaceText } from '@/lib/i18n-spaces';
import { useToast } from '@/hooks/use-toast';

export type { Space, SpaceDetail };
export type SpaceDraft = Pick<Space, 'kind' | 'name' | 'description' | 'icon' | 'color'>;
export type SpaceFilter = ListSpaceMemoriesFilter;
export type SpaceSuggestion = SpaceCreationSuggestion;

function useOwnedOptions(key: readonly unknown[], enabled = true) {
  const { user } = useAuth();
  return {
    query: { queryKey: [...key, user?.id], enabled: !!user && enabled, staleTime: 15_000, refetchInterval: 30_000 },
    request: { credentials: 'include' as const },
  };
}
export function useSpaces(archived = false) {
  const params = { archived };
  return useListSpaces(params, useOwnedOptions(getListSpacesQueryKey(params)));
}
export function useSpace(id: string) {
  return useGetSpace(id, useOwnedOptions(getGetSpaceQueryKey(id), !!id));
}
export function useSpaceMemories(id: string, filter: SpaceFilter) {
  const params = { filter };
  return useListSpaceMemories(id, params, useOwnedOptions(getListSpaceMemoriesQueryKey(id, params), !!id));
}
export function useMemorySpaces(id: number) {
  return useListMemorySpaces(id, useOwnedOptions(getListMemorySpacesQueryKey(id), id > 0));
}
export function useMemorySpaceSuggestions(id: number) {
  return useListMemorySpaceSuggestions(id, useOwnedOptions(getListMemorySpaceSuggestionsQueryKey(id), id > 0));
}
export function useSpaceSuggestions() {
  return useListSpaceSuggestions(useOwnedOptions(getListSpaceSuggestionsQueryKey()));
}

type SpaceAction =
  | { action: 'create'; data: SpaceInput }
  | { action: 'update'; id: string; data: SpaceUpdate }
  | { action: 'delete' | 'confirmSuggestion' | 'dismissSuggestion'; id: string }
  | { action: 'addMemory' | 'dismissMemory'; id: string; memoryId: number }
  | { action: 'hideProfileItem'; id: string; itemId: string };

export function useSpaceAction() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lang } = useI18n();
  const options = { request: { credentials: 'include' as const } };
  const create = useCreateSpace(options);
  const update = useUpdateSpace(options);
  const remove = useDeleteSpace(options);
  const add = useAddSpaceMemory(options);
  const dismissMemory = useDismissSpaceMemory(options);
  const confirmSuggestion = useConfirmSpaceSuggestion(options);
  const dismissSuggestion = useDismissSpaceSuggestion(options);
  const hideProfileItem = useHideSpaceProfileItem(options);
  return useMutation({
    mutationFn: async (input: SpaceAction) => {
      if (!user) throw new Error('Authentication required');
      switch (input.action) {
        case 'create': return create.mutateAsync({ data: input.data });
        case 'update': return update.mutateAsync({ id: input.id, data: input.data });
        case 'delete': return remove.mutateAsync({ id: input.id });
        case 'addMemory': return add.mutateAsync({ id: input.id, data: { memory_id: input.memoryId } });
        case 'dismissMemory': return dismissMemory.mutateAsync({ id: input.id, memoryId: input.memoryId });
        case 'confirmSuggestion': return confirmSuggestion.mutateAsync({ id: input.id });
        case 'dismissSuggestion': return dismissSuggestion.mutateAsync({ id: input.id });
        case 'hideProfileItem': return hideProfileItem.mutateAsync({ id: input.id, itemId: input.itemId });
      }
    },
    onSuccess: async (_, input) => {
      const deletedPath = input.action === 'delete' ? `/api/spaces/${input.id}` : null;
      const isDeletedSpaceQuery = (path: string) => deletedPath !== null && (path === deletedPath || path.startsWith(`${deletedPath}/`));
      // Do not refetch the still-mounted detail/members after successful deletion.
      // The caller navigates away after this callback, while all surviving lists refresh.
      if (deletedPath) {
        const predicate = (q: { queryKey: readonly unknown[] }) => isDeletedSpaceQuery(String(q.queryKey[0] ?? ''));
        await qc.cancelQueries({ predicate });
        qc.invalidateQueries({ predicate, refetchType: 'none' });
      }
      qc.invalidateQueries({ predicate: (q) => {
        const path = String(q.queryKey[0] ?? '');
        if (isDeletedSpaceQuery(path)) return false;
        return path.startsWith('/api/graph') || path.startsWith('/api/spaces') || path.startsWith('/api/memories') || path.startsWith('/api/search') || path.startsWith('/api/brain');
      } });
      if (deletedPath) qc.removeQueries({ type: 'inactive', predicate: (q) => isDeletedSpaceQuery(String(q.queryKey[0] ?? '')) });
      toast({ title: spaceText(lang, 'saved') });
    },
    onError: (error) => toast({ variant: 'destructive', title: spaceText(lang, 'error'), description: error instanceof Error ? error.message : undefined }),
  });
}