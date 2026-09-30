import { Link } from 'wouter';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { EmptyState, btnPrimary } from '@/components/kit';

export default function NotFound() {
  const { t } = useI18n();
  usePageTitle('404');
  return <div className="pt-10"><EmptyState title={t('notFoundPage')} action={<Link href="/" className={btnPrimary} data-testid="link-home">{t('goHome')}</Link>} /></div>;
}
