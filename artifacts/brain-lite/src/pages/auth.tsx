import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, ArrowRight, Eye, EyeOff, Languages, Loader2, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { authErrorKey, nextParam, withNext } from '@/lib/auth-helpers';
import { btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/brand';

const loginSchema = z.object({
  email: z.string().trim().email('vEmail'),
  password: z.string().min(8, 'vPassword'),
});
const signupSchema = loginSchema.extend({
  name: z.string().trim().min(1, 'vName').max(100, 'vNameLong'),
});
type SignupValues = z.infer<typeof signupSchema>;

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="mt-1.5 text-xs font-medium text-danger-ink" data-testid={`error-${id}`}>{error}</p>
        : hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Toggles() {
  const { lang, setLang, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const order: ThemeChoice[] = ['light', 'dark', 'system'];
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} aria-label={t('language')} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:bg-gold-soft hover:text-gold" data-testid="button-auth-language">
        <Languages className="h-4 w-4" /><span dir="ltr"><span className={lang === 'en' ? 'font-bold text-gold underline underline-offset-4' : 'text-muted-foreground'}>EN</span><span aria-hidden="true"> / </span><span className={lang === 'ar' ? 'font-bold text-gold underline underline-offset-4' : 'text-muted-foreground'}>AR</span></span>
      </button>
      <button onClick={() => setTheme(order[(order.indexOf(theme) + 1) % 3])} aria-label={t('theme')} className="grid h-11 w-11 place-items-center rounded-xl transition hover:bg-gold-soft hover:text-gold" data-testid="button-auth-theme">
        <Icon className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { signIn, signUp } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const next = nextParam(search);
  const isSignup = mode === 'signup';
  usePageTitle(isSignup ? t('signUp') : t('signIn'));
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<TKey | null>(null);

  const form = useForm<SignupValues>({
    resolver: zodResolver(isSignup ? signupSchema : (loginSchema as unknown as typeof signupSchema)),
    defaultValues: { email: '', password: '', name: '' },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;
  const err = (k?: string) => (k ? t(k as TKey) : undefined);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const u = isSignup
        ? await signUp({ email: v.email.trim(), password: v.password, name: v.name.trim(), language: lang, theme })
        : await signIn(v.email.trim(), v.password);
      navigate(u.onboardingCompleted ? next : withNext('/onboarding', next), { replace: true });
    } catch (e) {
      setFormError(authErrorKey(e, mode));
      form.setValue('password', '');
    }
  });

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_1fr]">
      <aside className="pattern-star relative hidden overflow-hidden bg-[hsl(40_13%_5%)] p-12 text-[hsl(44_51%_91%)] lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -end-40 top-1/3 h-[34rem] w-[34rem] rotate-45 rounded-[5rem] border border-gold-400/20" aria-hidden />
        <div className="pointer-events-none absolute -end-24 top-[40%] h-[24rem] w-[24rem] rotate-45 rounded-[3.5rem] border border-gold-400/25" aria-hidden />
        <div className="breathe pointer-events-none absolute -end-10 top-[46%] h-60 w-60 rounded-full bg-gold-500/25 blur-3xl" aria-hidden />
        <div className="relative"><Wordmark name={t('appName')} size="lg" /></div>
        <h1 className="rise relative mt-auto max-w-lg font-display text-5xl leading-[1.08] xl:text-6xl" data-testid="text-auth-tagline">{t('authTagline')}</h1>
        <p className="rise relative mt-8 flex items-center gap-2 text-sm text-[hsl(44_15%_67%)]" style={{ animationDelay: '120ms' }} data-testid="text-auth-privacy">
          <ShieldCheck className="h-4 w-4 text-gold-400" strokeWidth={1.5} />{t('authPrivacy')}
        </p>
      </aside>

      <main className="flex flex-col px-5 py-5 sm:px-10">
        <div className="flex items-center justify-between">
          <span className="lg:invisible"><Wordmark name={t('appName')} size="sm" /></span>
          <Toggles />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <p className="rise mb-8 font-display text-2xl font-bold leading-tight lg:hidden">{t('authTagline')}</p>
          <h2 className="rise font-display text-3xl font-bold" data-testid="text-auth-title">{isSignup ? t('signupTitle') : t('loginTitle')}</h2>
          <p className="rise mt-2 text-muted-foreground">{isSignup ? t('signupLead') : t('loginLead')}</p>

          <form onSubmit={onSubmit} noValidate className="rise mt-8 space-y-4" style={{ animationDelay: '80ms' }}>
            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-danger-ink" data-testid="error-auth">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{t(formError)}
              </div>
            )}
            {isSignup && (
              <Field id="name" label={t('fName')} error={err(errors.name?.message)}>
                <input id="name" autoComplete="name" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-err' : undefined} {...register('name')} className={fieldCls} data-testid="input-name" />
              </Field>
            )}
            <Field id="email" label={t('fEmail')} error={err(errors.email?.message)}>
              <input id="email" type="email" dir="ltr" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} {...register('email')} className={cn(fieldCls, 'rtl:text-right')} data-testid="input-email" />
            </Field>
            <Field id="password" label={t('fPassword')} error={err(errors.password?.message)} hint={isSignup ? t('passwordHint') : undefined}>
              <div className="relative">
                <input id="password" type={show ? 'text' : 'password'} dir="ltr" autoComplete={isSignup ? 'new-password' : 'current-password'} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-err' : undefined} {...register('password')} className={cn(fieldCls, 'pe-11 rtl:text-right')} data-testid="input-password" />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('hidePassword') : t('showPassword')} aria-pressed={show} className="absolute end-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground" data-testid="button-toggle-password">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <button type="submit" disabled={isSubmitting} className={cn(btnPrimary, 'w-full py-3')} data-testid="button-submit-auth">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? (isSignup ? t('signingUp') : t('signingIn')) : (isSignup ? t('signUp') : t('signIn'))}
              {!isSubmitting && <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignup ? t('haveAccount') : t('noAccount')}{' '}
            <Link href={withNext(isSignup ? '/login' : '/signup', next)} className="font-semibold text-gold hover:underline" data-testid={isSignup ? 'link-to-login' : 'link-to-signup'}>
              {isSignup ? t('logInInstead') : t('createOne')}
            </Link>
          </p>
          <p className="mt-10 flex items-center justify-center gap-2 text-xs text-muted-foreground lg:hidden"><ShieldCheck className="h-3.5 w-3.5 text-gold" />{t('authPrivacy')}</p>
        </div>
      </main>
    </div>
  );
}
