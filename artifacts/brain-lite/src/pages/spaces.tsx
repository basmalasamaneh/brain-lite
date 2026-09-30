import { useState } from 'react';
import { useLocation } from 'wouter';
import { Plus } from 'lucide-react';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { spaceText } from '@/lib/i18n-spaces';
import { useSpaces } from '@/hooks/use-spaces';
import { SpaceCard, SpaceEditor, SpaceSuggestions } from '@/components/spaces';
import { EmptyState, ErrorState, PageHeader, Skeleton, btnGhost, btnPrimary } from '@/components/kit';
import { cn } from '@/lib/utils';

export default function SpacesPage() {
  const { lang } = useI18n();
  usePageTitle(spaceText(lang, 'spaces'));
  const [, navigate] = useLocation();
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const query = useSpaces(archived);
  return <>
    <PageHeader title={spaceText(lang, 'spaces')} lead={spaceText(lang, 'lead')} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2">{[false, true].map((value) => <button data-testid={`button-spaces-${value ? 'archived' : 'active'}`} key={String(value)} aria-pressed={archived === value} onClick={() => setArchived(value)} className={cn(btnGhost, archived === value && 'border-gold-400 bg-gold-soft text-gold')}>{spaceText(lang, value ? 'archived' : 'active')}</button>)}</div>
      <button onClick={() => setOpen(true)} className={btnPrimary} data-testid="button-new-space"><Plus className="h-4 w-4" />{spaceText(lang, 'new')}</button>
    </div>
    {query.isLoading ? <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      : query.isError ? <ErrorState onRetry={() => query.refetch()} />
      : !query.data?.spaces.length ? <EmptyState title={spaceText(lang, archived ? 'noSpaces' : 'empty')} />
      : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{query.data.spaces.map((space) => <SpaceCard key={space.id} space={space} />)}</div>}
    {!archived && <SpaceSuggestions />}
    <SpaceEditor open={open} onOpenChange={setOpen} onSaved={(space) => navigate(`/spaces/${space.id}`)} />
  </>;
}