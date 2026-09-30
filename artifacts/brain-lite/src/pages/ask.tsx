import { Link } from 'wouter';
import { MessageCircleQuestion, Search } from 'lucide-react';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { Surface, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';

export default function AskPage() {
  const { t } = useI18n();
  usePageTitle(t('askTitle'));
  return (
    <div className="mx-auto max-w-2xl pt-4 md:pt-10">
      <Surface className="rise relative overflow-hidden p-8 text-center sm:p-12">
        <div className="breathe pointer-events-none absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-lavender text-primary"><MessageCircleQuestion className="h-7 w-7" /></div>
        <h1 className="relative font-display text-2xl font-bold sm:text-3xl" data-testid="text-page-title">{t('askHeading')}</h1>
        <p className="relative mx-auto mt-4 max-w-md leading-relaxed text-muted-foreground">{t('askBody')}</p>
        <div className="relative mx-auto mt-8 max-w-md" aria-disabled>
          <input disabled placeholder={t('askPlaceholder')} className={cn(fieldCls, 'cursor-not-allowed pe-20 opacity-60')} data-testid="input-ask-disabled" />
          <span className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg bg-amber/15 px-2 py-1 text-xs font-semibold text-amber">{t('later')}</span>
        </div>
        <p className="relative mt-8 text-sm text-muted-foreground">{t('askMeanwhile')}</p>
        <Link href="/memories" className={cn(btnPrimary, 'relative mt-4')} data-testid="link-ask-search"><Search className="h-4 w-4" />{t('askSearch')}</Link>
      </Surface>
    </div>
  );
}
