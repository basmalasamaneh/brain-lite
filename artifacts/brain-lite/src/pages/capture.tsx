import { useRef, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { Camera, FileText, ImageIcon, Loader2, Lock, UploadCloud, X } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useCreateMemory, useRequestUploadUrl, type UploadUrlRequestContentType } from '@workspace/api-client-react';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { ACCEPTED, MAX_BYTES, useInvalidateMemories } from '@/lib/memory';
import { useToast } from '@/hooks/use-toast';
import { PageHeader, SampleBanner, Surface, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';

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
  const { t } = useI18n();
  usePageTitle(t('captureTitle'));
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const invalidate = useInvalidateMemories();
  const create = useCreateMemory();
  const requestUrl = useRequestUploadUrl();

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'saving'>('idle');
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const busy = phase !== 'idle';

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
    if (busy) return;
    if (!isAuthenticated) { login(); return; }
    const raw = text.trim();
    if (!raw && !file) { setError('errNothing'); return; }
    if (title.trim().length > 200) { setError('errTitleLong'); return; }
    setError(null);
    let filePath: string | null = null;
    if (file) {
      setPhase('uploading');
      try {
        const contentType = resolveType(file) as UploadUrlRequestContentType;
        const { uploadURL, objectPath } = await requestUrl.mutateAsync({ data: { name: file.name.slice(0, 255), size: file.size, contentType } });
        const res = await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
        if (!res.ok) throw new Error(String(res.status));
        filePath = objectPath;
      } catch {
        setError('errUpload'); setPhase('idle'); return;
      }
    }
    setPhase('saving');
    const finalTitle = (title.trim() || (raw ? raw.split('\n').find((l) => l.trim())!.trim() : titleFromFile(file!.name))).slice(0, 200);
    create.mutate({ data: { raw_text: raw, title: finalTitle, file_path: filePath } }, {
      onSuccess: (m) => {
        invalidate(m.id);
        setTitle(''); setText(''); clearFile(); setPhase('idle');
        toast({ title: t('savedToast'), description: t('savedToastBody') });
        navigate(`/memories/${m.id}`);
      },
      onError: () => { setError('errSave'); setPhase('idle'); },
    });
  };

  const isPdf = file && resolveType(file) === 'application/pdf';

  return (
    <>
      <SampleBanner />
      <PageHeader title={t('captureTitle')} lead={t('captureLead')} />
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="rise grid gap-5 lg:grid-cols-[1.3fr_1fr]" style={{ animationDelay: '80ms' }} noValidate>
        <Surface className="space-y-5 p-5 sm:p-7">
          <label className="block">
            <span className="mb-1.5 flex flex-wrap items-baseline gap-2 text-sm font-medium">{t('titleLabel')}<span className="text-xs font-normal text-muted-foreground">{t('titleOptional')}</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={busy} className={fieldCls} data-testid="input-title" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">{t('textLabel')}</span>
            <textarea value={text} onChange={(e) => { setText(e.target.value); if (error === 'errNothing') setError(null); }} rows={9} maxLength={100000} disabled={busy}
              placeholder={t('textPlaceholder')} className={cn(fieldCls, 'resize-y leading-relaxed')} data-testid="input-text" />
          </label>
        </Surface>

        <div className="space-y-5">
          <Surface className="p-5 sm:p-6">
            <span className="mb-3 block text-sm font-medium">{t('fileLabel')}</span>
            {file ? (
              <div className="rise flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3" data-testid="file-selected">
                {preview ? <img src={preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  : <span className="grid h-16 w-16 place-items-center rounded-lg bg-lavender text-primary">{isPdf ? <FileText className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button type="button" onClick={clearFile} disabled={busy} className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={t('removeFile')} data-testid="button-remove-file"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
                className={cn('flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
                  dragging ? 'scale-[1.01] border-primary bg-lavender' : 'border-border')} data-testid="dropzone">
                <UploadCloud className={cn('h-8 w-8 transition', dragging ? '-translate-y-1 text-primary' : 'text-muted-foreground')} />
                <p className="text-sm">{t('dropHere')}{' '}
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="font-semibold text-primary underline-offset-4 hover:underline" data-testid="button-browse">{t('browse')}</button>
                </p>
                <p className="text-xs text-muted-foreground">{t('fileHint')}</p>
              </div>
            )}
            <input ref={fileInput} type="file" accept={ACCEPTED.join(',') + ',.heic'} className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="input-file" />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="input-camera" />
            <button type="button" onClick={() => cameraInput.current?.click()} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-lavender py-2.5 text-sm font-medium text-primary transition active:scale-95 md:hidden" data-testid="button-camera">
              <Camera className="h-4 w-4" />{t('takePhoto')}
            </button>
          </Surface>

          {error && <p role="alert" className="rise rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="text-error">{t(error)}</p>}

          {!authLoading && !isAuthenticated ? (
            <button type="button" onClick={login} className={cn(btnPrimary, 'w-full py-3')} data-testid="button-login-save"><Lock className="h-4 w-4" />{t('loginToSave')}</button>
          ) : (
            <button type="submit" disabled={busy || authLoading} className={cn(btnPrimary, 'w-full py-3')} data-testid="button-save">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {phase === 'uploading' ? t('uploading') : phase === 'saving' ? t('saving') : t('save')}
            </button>
          )}
          <Link href="/memories" className="block text-center text-sm text-muted-foreground hover:text-foreground" data-testid="link-to-memories">{t('navMemories')}</Link>
        </div>
      </form>
    </>
  );
}
