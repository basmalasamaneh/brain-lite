import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { useVoiceRecorder, voiceUploadIssue } from '@/hooks/use-voice-recorder';
import { transcribeVoice } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { searchText } from '@/lib/i18n-search';
import { voiceText, type VoiceKey } from '@/lib/i18n-voice';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { btnGhost, btnPrimary } from '@/components/kit';

function encodeAudio(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new Error('read'));
    reader.readAsDataURL(blob);
  });
}

export function VoiceQuestion({ onTranscript, disabled = false, testId }: { onTranscript: (text: string) => void; disabled?: boolean; testId: string }) {
  const { lang } = useI18n();
  const recorder = useVoiceRecorder();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<VoiceKey | null>(null);
  const request = useRef<AbortController | null>(null);
  const v = (key: VoiceKey) => voiceText(lang, key);
  useEffect(() => () => request.current?.abort(), []);
  const close = () => {
    request.current?.abort(); request.current = null;
    recorder.cancel(); setOpen(false); setBusy(false); setError(null);
  };
  const transcribe = async () => {
    if (!recorder.audio || busy) return;
    const issue = voiceUploadIssue(recorder.audio, navigator.onLine);
    if (issue) { setError(issue); return; }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null);
    try {
      const audio_base64 = await encodeAudio(recorder.audio);
      if (controller.signal.aborted) return;
      const response = await transcribeVoice({ audio_base64, mime_type: recorder.audio.type.split(';')[0], language: lang,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', keep_recording: false },
      { signal: controller.signal, credentials: 'include' });
      if (controller.signal.aborted) return;
      if (!response.transcript?.trim()) { setError('empty'); return; }
      onTranscript(response.transcript.trim());
      close();
    } catch (e) {
      if (controller.signal.aborted) return;
      const status = (e as { status?: number }).status;
      setError(!navigator.onLine ? 'offline' : status === 429 ? 'rate' : status === 413 ? 'size' : status === 422 ? 'transcriptError' : status === 503 || status === 502 ? 'unavailable' : 'uploadError');
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} aria-label={searchText(lang, 'voice')} data-testid={testId}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gold hover:bg-gold-soft disabled:opacity-40"><Mic className="h-5 w-5" /></button>
      <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle>{searchText(lang, 'voiceTitle')}</DialogTitle><DialogDescription>{searchText(lang, 'voicePrivacy')}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            {busy ? <p className="flex items-center gap-2 text-sm" role="status" data-testid="status-question-transcribing"><Loader2 className="h-5 w-5 animate-spin text-gold" />{searchText(lang, 'transcribing')}</p>
              : recorder.phase === 'recording' ? <div className="space-y-3">
                <p role="status" className="text-center text-gold">{v('recording')} · {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}</p>
                <button type="button" onClick={() => recorder.stop()} className={`${btnPrimary} w-full`} data-testid="button-question-stop"><Square className="h-4 w-4" />{v('stop')}</button>
              </div> : recorder.phase === 'preview' ? <div className="space-y-3">
                {recorder.url && <audio controls src={recorder.url} className="w-full" aria-label={v('playback')} data-testid="audio-question-preview" />}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setError(null); void recorder.start(); }} className={btnGhost} data-testid="button-question-rerecord">{v('rerecord')}</button>
                  <button type="button" onClick={() => void transcribe()} className={btnPrimary} data-testid="button-question-transcribe">{searchText(lang, 'useQuestion')}</button>
                </div>
              </div> : <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{searchText(lang, 'voicePermission')}</p>
                <button type="button" disabled={recorder.phase === 'starting'} onClick={() => { setError(null); void recorder.start(); }} className={`${btnPrimary} w-full`} data-testid="button-question-record"><Mic className="h-4 w-4" />{v('start')}</button>
              </div>}
            {recorder.notice && <p role="status" className="text-sm text-muted-foreground">{v(recorder.notice)}</p>}
            {(error || recorder.error) && <p role="alert" className="text-sm text-danger-ink" data-testid="error-voice-question">{v(error || recorder.error!)}</p>}
            <button type="button" onClick={close} className={btnGhost} data-testid="button-question-cancel">{v('cancel')}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}