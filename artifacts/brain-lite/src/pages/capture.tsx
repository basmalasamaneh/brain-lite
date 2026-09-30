import { useRef, useState, type DragEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Camera, Check, FileText, ImageIcon, Loader2, Lock, PenLine, ShieldCheck, UploadCloud, X } from 'lucide-react';
import { InfoTip } from '@/components/kit';
import { IconCircle } from '@/components/brand';
import { SuccessCheck } from '@/components/motion';
import { useAuth } from '@workspace/replit-auth-web';
import { useCreateMemory, useRequestUploadUrl, type UploadUrlRequestContentType } from '@workspace/api-client-react';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { ACCEPTED, MAX_BYTES, useInvalidateMemories } from '@/lib/memory';
import { useToast } from '@/hooks/use-toast';
import { PageHeader, SampleBanner, Surface, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';
import { UnderstandingSkeleton } from '@/components/extraction';
import { VoiceCapture } from '@/components/voice-capture';
import { voiceText } from '@/lib/i18n-voice';
import { useSpace } from '@/hooks/use-spaces';
import { SpaceIcon } from '@/components/spaces';
import { spaceText } from '@/lib/i18n-spaces';
import { ErrorState, Skeleton } from '@/components/kit';

function resolveType(f: File): string {
  if (f.type) return f.type === 'image/jpg' ? 'image/jpeg' : f.type;
  const ext = f.name.split('.').pop()?.toLowerCase();
  return ext === 'heic' || ext === 'heif' ? 'image/heic' : ext === 'pdf' ? 'application/pdf' : '';
}

function titleFromFile(name: string) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return (base || name).slice(0, 200);
}

export default function CapturePage() {
  const { t, lang } = useI18n();
  usePageTitle(t('captureTitle'));
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const invalidate = useInvalidateMemories();
  const create = useCreateMemory();
  const requestUrl = useRequestUploadUrl();
  const search = useSearch();
  const spaceId = new URLSearchParams(search).get('space_id') || undefined;
  const selectedSpace = useSpace(spaceId ?? '');
  const spaceUnavailable = !!spaceId && !selectedSpace.data;

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'saving' | 'saved'>('idle');
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const busy = phase !== 'idle';
  const inFlight = useRef(false);
  const uploaded = useRef<{ file: File; path: string } | null>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const type = resolveType(f);
    if (!(ACCEPTED as readonly string[]).includes(type)) { setError('errType'); return; }
    if (f.size > MAX_BYTES) { setError('errSize'); return; }
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(type.startsWith('image/') && type !== 'image/heic' ? URL.createObjectURL(f) : null);
    setFile(f);
  };

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null); setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (!busy) pick(e.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    if (busy || inFlight.current || spaceUnavailable) return;
    if (!isAuthenticated) { login(); return; }
    const raw = text.trim();
    if (!raw && !file) { setError('errNothing'); return; }
    if (title.trim().length > 200) { setError('errTitleLong'); return; }
    setError(null);
    inFlight.current = true;
    let filePath: string | null = null;
    if (file && uploaded.current?.file === file) filePath = uploaded.current.path;
    else if (file) {
      setPhase('uploading');
      try {
        const contentType = resolveType(file) as UploadUrlRequestContentType;
        const { uploadURL, objectPath } = await requestUrl.mutateAsync({ data: { name: file.name.slice(0, 255), size: file.size, contentType } });
        const res = await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
        if (!res.ok) throw new Error(String(res.status));
        filePath = objectPath;
        uploaded.current = { file, path: objectPath };
      } catch {
        setError('errUpload'); setPhase('idle'); inFlight.current = false; return;
      }
    }
    setPhase('saving');
    const finalTitle = (title.trim() || (raw ? raw.split('\n').find((l) => l.trim())!.trim() : titleFromFile(file!.name))).slice(0, 200);
    let timezone: string | undefined;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 100) || undefined; } catch { timezone = undefined; }
    const data = { raw_text: raw, title: finalTitle, file_path: filePath, language: lang, timezone, ...(spaceId ? { space_id: spaceId } : {}) };
    create.mutate({ data }, {
      onSuccess: (m) => {
        invalidate(m.id);
        uploaded.current = null;
        setTitle(''); setText(''); clearFile(); setPhase('saved'); inFlight.current = false;
        toast({ title: <span className="flex items-center gap-2.5"><SuccessCheck className="h-7 w-7 shrink-0" />{t('savedPlain')}</span> });
        navigate(`/memories/${m.id}`);
      },
      onError: () => { setError('errSave'); setPhase('idle'); inFlight.current = false; },
    });
  };

  const isPdf = file && resolveType(file) === 'application/pdf';
  const stepIdx = phase === 'uploading' ? 0 : phase === 'saving' ? 1 : phase === 'saved' ? 2 : -1;
  const steps: TKey[] = ['stepCapture', 'stepUnderstanding', 'stepSaved'];
  const options: { k: TKey; hint: TKey; icon: typeof PenLine; onClick: () => void; id: string }[] = [
    { k: 'optWrite', hint: 'optWriteHint', icon: PenLine, onClick: () => textRef.current?.focus(), id: 'write' },
    { k: 'optPhoto', hint: 'optPhotoHint', icon: Camera, onClick: () => cameraInput.current?.click(), id: 'photo' },
    { k: 'optFile', hint: 'optFileHint', icon: FileText, onClick: () => fileInput.current?.click(), id: 'file' },
  ];

  return (
    <>
      <SampleBanner />
      <PageHeader eyebrow={t('captureEyebrow')} title={t('captureTitle')} lead={t('captureLead')} />
      {spaceId && <div className="mb-5">
        {selectedSpace.isLoading ? <Skeleton className="h-16 rounded-2xl" /> : selectedSpace.isError ? <ErrorState onRetry={() => selectedSpace.refetch()} /> : selectedSpace.data && <Surface className="flex items-center gap-3 border-gold-400/40 p-3" data-testid="badge-capture-space"><SpaceIcon space={selectedSpace.data.space} /><div className="min-w-0"><p className="text-xs text-muted-foreground">{spaceText(lang, 'storedIn')}</p><Link href={`/spaces/${spaceId}`} className="block truncate font-medium text-gold">{selectedSpace.data.space.name}</Link></div></Surface>}
      </div>}

      <div className="rise grid grid-cols-4 gap-2 sm:gap-4" role="group" aria-label={t('captureTitle')}>
        {options.map(({ k, hint, icon, onClick, id }) => (
          <button key={id} type="button" onClick={onClick} disabled={busy} data-testid={`button-option-${id}`}
            className="lift group flex min-h-24 min-w-0 flex-col items-center gap-2 rounded-2xl border border-card-border bg-card p-3 text-center soft-shadow hover:border-gold-400/60 active:scale-[0.97] disabled:opacity-50 sm:flex-row sm:p-4 sm:text-start">
            <IconCircle icon={icon} className="transition group-hover:scale-105" />
            <span className="min-w-0">
              <span className="block font-display text-lg leading-tight">{t(k)}</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:block">{t(hint)}</span>
            </span>
          </button>
        ))}
        <VoiceCapture disabled={busy || authLoading || spaceUnavailable} needsLogin={!authLoading && !isAuthenticated} onLogin={login} spaceId={spaceId} spaceName={selectedSpace.data?.space.name} />
      </div>
      <p className="mb-6 mt-2 text-center text-xs leading-relaxed text-muted-foreground">{voiceText(lang, 'privacyDefault')}</p>

      {stepIdx >= 0 && (
        <ol className="rise mb-5 flex items-center gap-2 rounded-2xl border border-gold-400/40 bg-gold-soft/60 p-3 sm:p-4" aria-label={t('progressLabel')} aria-live="polite" data-testid="capture-steps">
          {steps.map((k, i) => {
            const done = i < stepIdx || phase === 'saved';
            const active = i === stepIdx && phase !== 'saved';
            return (
              <li key={k} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ring-1',
                  done ? 'bg-success text-[hsl(44_60%_97%)] ring-success' : active ? 'gold-gradient text-gold-ink ring-gold-400' : 'bg-card text-muted-foreground ring-border')}>
                  {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : i + 1}
                </span>
                <span className={cn('truncate text-xs font-medium sm:text-sm', active ? 'text-foreground' : 'text-muted-foreground')}>{t(k)}</span>
                {i < 2 && <span className={cn('hidden h-px flex-1 sm:block', done ? 'bg-success/60' : 'bg-gold-400/40')} aria-hidden />}
              </li>
            );
          })}
        </ol>
      )}
      {phase === 'saving' && <div className="mb-5"><UnderstandingSkeleton /></div>}

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="rise grid gap-5 lg:grid-cols-[1.3fr_1fr]" style={{ animationDelay: '80ms' }} noValidate>
        <Surface className="min-w-0 space-y-5 p-5 sm:p-7">
          <label className="block">
            <span className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium">{t('titleLabel')}<span className="text-xs font-normal text-muted-foreground">{t('titleOptional')}</span><InfoTip text={t('tipTitleOptional')} /></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={busy} className={fieldCls} data-testid="input-title" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">{t('textLabel')}</span>
            <textarea ref={textRef} value={text} onChange={(e) => { setText(e.target.value); if (error === 'errNothing') setError(null); }} rows={9} maxLength={100000} disabled={busy}
              placeholder={t('textPlaceholder')} className={cn(fieldCls, 'resize-y leading-relaxed')} data-testid="input-text" />
          </label>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-gold-400" aria-hidden />{t('captureHint')}</p>
        </Surface>

        <div className="min-w-0 space-y-5">
          <Surface className="p-5 sm:p-6">
            <span className="mb-3 block text-sm font-medium">{t('fileLabel')}</span>
            {file ? (
              <div className="rise flex min-w-0 items-center gap-3 rounded-xl border border-gold-400/40 bg-gold-soft/40 p-3" data-testid="file-selected">
                {preview ? <img src={preview} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                  : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-gold-soft text-gold">{isPdf ? <FileText className="h-6 w-6" strokeWidth={1.5} /> : <ImageIcon className="h-6 w-6" strokeWidth={1.5} />}</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button type="button" onClick={clearFile} disabled={busy} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-gold-soft hover:text-foreground" aria-label={t('removeFile')} data-testid="button-remove-file"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
                className={cn('pattern-star flex flex-col items-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
                  dragging ? 'scale-[1.01] border-gold-500 bg-gold-soft' : 'border-gold-400/40')} data-testid="dropzone">
                <UploadCloud className={cn('h-8 w-8 transition', dragging ? '-translate-y-1 text-gold' : 'text-gold/70')} strokeWidth={1.5} />
                <p className="text-sm">{dragging ? t('dropRelease') : t('dropHere')}{' '}
                  {!dragging && <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="inline-flex min-h-11 items-center font-semibold text-gold underline-offset-4 hover:underline" data-testid="button-browse">{t('browse')}</button>}
                </p>
                <p className="text-xs text-muted-foreground">{t('fileHint')}</p>
              </div>
            )}
            <input ref={fileInput} type="file" accept={ACCEPTED.join(',') + ',.heic'} className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="input-file" />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="input-camera" />
          </Surface>

          {error && <p role="alert" className="rise rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-danger-ink" data-testid="text-error">{t(error)}</p>}

          <div className="sticky bottom-24 z-20 -mx-1 rounded-2xl bg-background/90 p-1 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
            {!authLoading && !isAuthenticated ? (
              <button type="button" onClick={login} className={cn(btnPrimary, 'w-full py-3')} data-testid="button-login-save"><Lock className="h-4 w-4" />{t('loginToSave')}</button>
            ) : (
              <button type="submit" disabled={busy || authLoading || spaceUnavailable} className={cn(btnPrimary, 'w-full py-3')} data-testid="button-save">
                {busy && phase !== 'saved' && <Loader2 className="h-4 w-4 animate-spin" />}
                {phase === 'uploading' ? t('uploading') : phase === 'saving' ? t('understanding') : phase === 'saved' ? t('savedPlain') : t('save')}
              </button>
            )}
          </div>
          <p className="flex items-start gap-2 rounded-xl bg-surface-alt px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground" data-testid="text-ai-notice"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" strokeWidth={1.5} />{t('aiNotice')}</p>
          <Link href="/memories" className="flex min-h-11 items-center justify-center text-sm text-muted-foreground hover:text-foreground" data-testid="link-to-memories">{t('navMemories')}</Link>
        </div>
      </form>
    </>
  );
}
