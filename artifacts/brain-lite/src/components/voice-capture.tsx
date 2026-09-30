import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Check, Loader2, Mic, RotateCcw, Square, Volume2 } from 'lucide-react';
import type { Memory } from '@workspace/api-client-react';
import { useUpdateMemory } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { voiceText, type VoiceKey } from '@/lib/i18n-voice';
import { useVoiceRecorder, voiceUploadIssue } from '@/hooks/use-voice-recorder';
import { useInvalidateMemories, formatDateTime } from '@/lib/memory';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ConfidenceMeter } from '@/components/extraction';
import { GoogleCalendarButton } from '@/components/google-calendar';
import { PulseStar } from '@/components/motion';
import { TypeChip, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';
import { spaceText } from '@/lib/i18n-spaces';

type VoiceResponse = { transcript: string; memories: Memory[] };

function Waveform({ analyser }: { analyser: AnalyserNode | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!analyser || !canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = () => {
      analyser.getByteTimeDomainData(data);
      const width = ctx.canvas.width, height = ctx.canvas.height;
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = '#bb9141';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = i / (data.length - 1) * width;
        const y = (data[i] / 255) * height;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (!reduce) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser]);
  return analyser ? <canvas ref={canvas} width={320} height={96} className="mx-auto h-24 w-full max-w-xs" aria-hidden="true" /> : <Volume2 className="mx-auto h-16 w-16 text-gold" aria-hidden="true" />;
}

function encodeAudio(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') { reject(new Error('read')); return; }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function postVoice(url: string, data: object, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { transcript?: string; code?: string };
    const error = new Error(`Voice request failed: ${res.status}`) as Error & { status: number; transcript?: string; code?: string };
    error.status = res.status;
    error.transcript = body.transcript;
    error.code = body.code;
    throw error;
  }
  return res.json();
}

export function VoiceCapture({ disabled = false, needsLogin = false, onLogin, spaceId, spaceName }: { disabled?: boolean; needsLogin?: boolean; onLogin: () => void; spaceId?: string; spaceName?: string }) {
  const { lang } = useI18n();
  const v = (key: VoiceKey) => voiceText(lang, key);
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [plainSaving, setPlainSaving] = useState(false);
  const [plainText, setPlainText] = useState('');
  const [showPlain, setShowPlain] = useState(false);
  const [requestError, setRequestError] = useState<VoiceKey | null>(null);
  const [result, setResult] = useState<VoiceResponse | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [confirmError, setConfirmError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const recorder = useVoiceRecorder();
  const update = useUpdateMemory();
  const invalidate = useInvalidateMemories();
  useEffect(() => () => request.current?.abort(), []);
  const close = () => {
    request.current?.abort();
    request.current = null;
    recorder.cancel();
    setOpen(false); setKeep(false); setProcessing(false); setResult(null); setRequestError(null);
    setPlainText(''); setShowPlain(false); setConfirmError(false);
  };
  const openSheet = () => {
    if (needsLogin) { onLogin(); return; }
    if (disabled) return;
    setOpen(true);
  };
  const timezone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  };
  const submit = async () => {
    if (!recorder.audio || processing || plainSaving) return;
    const issue = voiceUploadIssue(recorder.audio, navigator.onLine);
    if (issue) { setRequestError(issue); return; }
    const controller = new AbortController();
    request.current = controller;
    setProcessing(true); setRequestError(null);
    try {
      const audio_base64 = await encodeAudio(recorder.audio);
      if (controller.signal.aborted) return;
      const response = await postVoice('/api/capture/voice', {
        audio_base64, mime_type: recorder.audio.type.split(';')[0], language: lang, timezone: timezone(), keep_recording: keep,
        ...(spaceId ? { space_id: spaceId } : {}),
      }, controller.signal) as VoiceResponse;
      if (!Array.isArray(response.memories) || !response.memories.length) throw new Error('noItems');
      invalidate();
      setResult(response);
      setPlainText(response.transcript || '');
    } catch (e) {
      if (controller.signal.aborted) return;
      const { status, transcript, code } = e as { status?: number; transcript?: string; code?: string };
      if (transcript?.trim()) { setPlainText(transcript); setShowPlain(true); }
      setRequestError(!navigator.onLine ? 'offline' : status === 429 ? 'rate' :
        status === 413 ? code === 'audio_too_long' ? 'tooLong' : 'size' : code === 'invalid_extraction' || code === 'no_speech' ? 'transcriptError' :
          status === 503 || status === 502 ? 'unavailable' :
            status === 422 ? 'transcriptError' : (e as Error).message === 'noItems' ? 'noItems' : 'uploadError');
    } finally {
      if (request.current === controller) { request.current = null; setProcessing(false); }
    }
  };
  const savePlain = async () => {
    if (plainSaving || !plainText.trim()) { setRequestError('plainEmpty'); return; }
    const controller = new AbortController();
    request.current = controller;
    setPlainSaving(true); setRequestError(null);
    try {
      const memory = await postVoice('/api/capture/voice/plain', { transcript: plainText.trim(), language: lang, ...(spaceId ? { space_id: spaceId } : {}) }, controller.signal) as Memory;
      if (!memory?.id) throw new Error('Invalid memory response');
      invalidate(memory.id);
      setResult({ transcript: plainText.trim(), memories: [memory] });
    } catch (e) {
      if (!controller.signal.aborted) setRequestError(!navigator.onLine ? 'offline' : (e as { status?: number }).status === 429 ? 'rate' : 'uploadError');
    } finally {
      if (request.current === controller) { request.current = null; setPlainSaving(false); }
    }
  };
  const confirmOne = async (m: Memory) => {
    if (confirming !== null) return;
    setConfirming(m.id); setConfirmError(false);
    try {
      const confirmed = await update.mutateAsync({ id: m.id, data: { status: 'confirmed' } });
      setResult((prev) => prev ? { ...prev, memories: prev.memories.map((item) => item.id === m.id ? confirmed : item) } : prev);
      invalidate(m.id);
    } catch { setConfirmError(true); }
    finally { setConfirming(null); }
  };
  const confirmAll = async () => {
    if (!result || confirming !== null) return;
    setConfirming(-1); setConfirmError(false);
    try {
      for (const m of result.memories.filter((item) => item.status !== 'confirmed')) {
        const confirmed = await update.mutateAsync({ id: m.id, data: { status: 'confirmed' } });
        setResult((prev) => prev ? { ...prev, memories: prev.memories.map((item) => item.id === m.id ? confirmed : item) } : prev);
        invalidate(m.id);
      }
    } catch { setConfirmError(true); }
    finally { setConfirming(null); }
  };
  const rerecord = () => {
    recorder.cancel(); setRequestError(null); setShowPlain(false); setPlainText('');
  };
  const min = String(Math.floor(recorder.seconds / 60)).padStart(2, '0');
  const sec = String(recorder.seconds % 60).padStart(2, '0');
  return (
    <>
      <button type="button" onClick={openSheet} disabled={disabled && !needsLogin} data-testid="button-option-voice"
        className="lift group flex min-h-24 min-w-0 flex-col items-center gap-1 rounded-2xl border border-gold-400/60 bg-gold-soft p-2 text-center soft-shadow active:scale-[0.97] sm:flex-row sm:gap-3 sm:p-4">
        <span className="gold-gradient grid h-16 w-16 shrink-0 place-items-center rounded-full text-gold-ink shadow-md"><Mic className="h-7 w-7" aria-hidden /></span>
        <span className="min-w-0"><span className="block font-display text-base leading-tight sm:text-lg">{v('voice')}</span><span className="hidden text-xs text-muted-foreground sm:block">{v('voiceHint')}</span></span>
      </button>
      <Sheet open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <SheetContent side="bottom" onEscapeKeyDown={() => close()} onInteractOutside={(e) => e.preventDefault()}
          className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-y-auto rounded-none border-gold-400/40 px-5 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>button]:top-[max(1rem,env(safe-area-inset-top))] [&>button]:grid [&>button]:h-11 [&>button]:w-11 [&>button]:place-items-center rtl:[&>button]:left-4 rtl:[&>button]:right-auto sm:mx-auto sm:max-w-xl sm:rounded-t-3xl">
          <SheetHeader className="text-start">
            <SheetTitle className="font-display text-2xl">{result ? v('result') : recorder.phase === 'recording' ? v('recording') : processing ? v('processing') : recorder.phase === 'preview' ? v('preview') : v('permissionTitle')}</SheetTitle>
            <SheetDescription>{result ? v('saved') : processing ? v('wait') : recorder.phase === 'intro' ? v('permission') : keep ? v('privacyKept') : v('privacy')}</SheetDescription>
          </SheetHeader>
          {spaceName && <p className="mt-3 break-words rounded-xl border border-gold-400/40 bg-gold-soft p-3 text-sm text-gold">{spaceText(lang, 'storedIn')}: {spaceName}</p>}
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 py-5">
            {result ? (
              <div className="space-y-4 overflow-y-auto">
                {result.transcript && <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer font-medium">{v('transcript')}</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{result.transcript}</p></details>}
                <ul className="space-y-3">{result.memories.map((m) => <li key={m.id} className="min-w-0 space-y-3 rounded-2xl border border-gold-400/40 bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2"><TypeChip type={m.type} /><span className="text-xs text-muted-foreground">{m.event_date && formatDateTime(m.event_date, lang)}</span></div>
                  <h3 className="break-words font-display text-xl">{m.title}</h3>
                  {m.summary && <p className="break-words text-sm text-muted-foreground">{m.summary}</p>}
                  <ConfidenceMeter value={m.confidence} />
                  <GoogleCalendarButton memory={m} />
                  <div className="flex flex-wrap gap-2">
                    {m.status !== 'confirmed' && <button type="button" onClick={() => confirmOne(m)} disabled={confirming !== null} className={btnPrimary}>{confirming === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{v('confirmOne')}</button>}
                    <Link href={`/memories/${m.id}?edit=1`} onClick={close} className={btnGhost}>{v('review')}</Link>
                    {m.status === 'confirmed' && <Link href={`/memories/${m.id}`} onClick={close} className={btnGhost}>{v('viewMemory')}</Link>}
                  </div>
                </li>)}</ul>
                {confirmError && <p role="alert" className="text-sm text-danger-ink">{v('confirmError')}</p>}
              </div>
            ) : processing ? <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 text-center"><PulseStar className="h-20 w-20" /><p className="font-display text-xl">{v('processing')}</p><ol className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground"><li>{v('stepRecord')} ✓</li><li>{v('stepUnderstand')} …</li><li>{v('stepSaved')}</li></ol><p>{v('wait')}</p></div>
                : recorder.phase === 'recording' ? <div className="text-center"><Waveform analyser={recorder.analyser} /><p className="mt-5 font-display text-5xl tabular-nums" dir="ltr" aria-live="off">{min}:{sec}</p><p className="mt-3 text-sm text-muted-foreground">{v('recording')}</p></div>
                : recorder.phase === 'preview' ? <div className="space-y-5 text-center"><Volume2 className="mx-auto h-14 w-14 text-gold" aria-hidden /><audio controls src={recorder.url || undefined} className="w-full" aria-label={v('preview')} /><label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-start text-sm"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-5 w-5 accent-amber-600" /><span><span className="block font-medium">{v('keep')}</span><span className="text-xs text-muted-foreground">{v('keepHint')}</span></span></label></div>
                  : <div className="text-center"><Mic className="mx-auto h-20 w-20 text-gold" strokeWidth={1.2} aria-hidden /><p className="mt-5 text-sm leading-relaxed">{v('permission')}</p></div>}
            {!result && !processing && (recorder.notice || recorder.error || requestError) && <p role={recorder.notice === 'warning' && !recorder.error && !requestError ? 'status' : 'alert'} aria-live={recorder.notice === 'warning' && !recorder.error && !requestError ? 'polite' : undefined} className="rounded-xl border border-gold-400/50 bg-gold-soft p-3 text-sm">{v((requestError || recorder.error || recorder.notice)!)}</p>}
            {!result && !processing && showPlain && recorder.phase !== 'recording' && <div className="space-y-2"><label htmlFor="voice-plain" className="block font-medium">{v('plainTitle')}</label><p className="text-xs text-muted-foreground">{v('plainHint')}</p><textarea id="voice-plain" className={fieldCls} rows={4} maxLength={100000} value={plainText} onChange={(e) => setPlainText(e.target.value)} /></div>}
          </div>
          <div className="sticky bottom-0 grid gap-3 bg-background pt-3">
            {result ? result.memories.some((m) => m.status !== 'confirmed') && <button type="button" onClick={confirmAll} disabled={confirming !== null} className={cn(btnPrimary, 'min-h-14 w-full')}>{confirming === -1 && <Loader2 className="h-4 w-4 animate-spin" />}{v('confirmAll')}</button>
              : processing ? <button type="button" onClick={close} className={cn(btnGhost, 'min-h-12 w-full')}>{v('cancel')}</button>
                : recorder.phase === 'recording' ? <><button type="button" onClick={() => recorder.stop()} className={cn(btnPrimary, 'min-h-16 w-full')}><Square className="h-5 w-5" />{v('stop')}</button><button type="button" onClick={close} className={cn(btnGhost, 'min-h-12 w-full')}>{v('cancel')}</button></>
                  : recorder.phase === 'preview' ? <><button type="button" onClick={submit} className={cn(btnPrimary, 'min-h-16 w-full')}>{v('use')}</button><button type="button" onClick={rerecord} className={cn(btnGhost, 'min-h-12 w-full')}><RotateCcw className="h-4 w-4" />{v('rerecord')}</button></>
                    : <button type="button" onClick={recorder.start} disabled={recorder.phase === 'starting'} className={cn(btnPrimary, 'min-h-16 w-full')}>{recorder.phase === 'starting' && <Loader2 className="h-4 w-4 animate-spin" />}{v('start')}</button>}
            {!result && !processing && recorder.phase !== 'recording' && showPlain && <button type="button" onClick={savePlain} disabled={plainSaving} className={cn(btnGhost, 'min-h-12 w-full')}>{plainSaving && <Loader2 className="h-4 w-4 animate-spin" />}{v('plainSave')}</button>}
            {!result && !processing && recorder.phase !== 'recording' && !showPlain && requestError && <button type="button" onClick={() => setShowPlain(true)} className="min-h-11 text-sm font-medium text-gold underline">{v('plainTitle')}</button>}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}