import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceKey } from '@/lib/i18n-voice';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SECONDS = 120;
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
export type RecorderPhase = 'intro' | 'starting' | 'recording' | 'preview';

/** Upload preflight has no side effects: retry can reuse the exact same recording. */
export function voiceUploadIssue(audio: Blob, online: boolean): VoiceKey | null {
  if (!online) return 'offline';
  if (audio.size > MAX_BYTES) return 'size';
  return null;
}

export function useVoiceRecorder() {
  const [phase, setPhase] = useState<RecorderPhase>('intro');
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState<VoiceKey | null>(null);
  const [error, setError] = useState<VoiceKey | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);
  const chunks = useRef<Blob[]>([]);
  const size = useRef(0);
  const urlRef = useRef<string | null>(null);
  const generation = useRef(0);
  const cancelled = useRef(false);

  const releaseMic = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (context.current) void context.current.close().catch(() => {});
    context.current = null;
    setAnalyser(null);
  }, []);

  const clearAudio = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setUrl(null);
    setAudio(null);
    chunks.current = [];
    size.current = 0;
  }, []);

  const stop = useCallback((reason?: VoiceKey) => {
    const r = recorder.current;
    if (!r || r.state === 'inactive') return;
    if (reason) setNotice(reason);
    try { r.requestData(); } catch { /* some browsers do not support explicit flush */ }
    try { r.stop(); } catch { releaseMic(); setError('micError'); }
    try { navigator.vibrate?.(20); } catch { /* vibration is optional */ }
    releaseMic();
  }, [releaseMic]);

  const cancel = useCallback(() => {
    generation.current++;
    cancelled.current = true;
    const r = recorder.current;
    recorder.current = null;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* device already removed */ } }
    releaseMic();
    clearAudio();
    setPhase('intro');
    setError(null);
    setNotice(null);
    setSeconds(0);
  }, [releaseMic, clearAudio]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('unsupported'); return; }
    const id = ++generation.current;
    cancelled.current = false;
    clearAudio();
    setError(null); setNotice(null); setSeconds(0); setPhase('starting');
    let media: MediaStream | null = null;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation.current !== id) { media.getTracks().forEach((t) => t.stop()); return; }
      stream.current = media;
      const mimeType = formats.find((format) => MediaRecorder.isTypeSupported(format));
      const r = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = r;
      chunks.current = [];
      size.current = 0;
      r.ondataavailable = (ev) => {
        if (cancelled.current || !ev.data.size) return;
        size.current += ev.data.size;
        chunks.current.push(ev.data);
        if (size.current >= MAX_BYTES) stop('size');
      };
      r.onerror = () => { setError('micError'); stop(); };
      r.onstop = () => {
        releaseMic();
        if (cancelled.current || generation.current !== id) return;
        const actualType = r.mimeType || chunks.current[0]?.type;
        if (!actualType) { setError('unsupported'); setPhase('intro'); return; }
        const recorded = new Blob(chunks.current, { type: actualType });
        if (!recorded.size) { setError('empty'); setPhase('intro'); return; }
        if (recorded.size > MAX_BYTES) { setError('size'); setPhase('intro'); return; }
        const objectUrl = URL.createObjectURL(recorded);
        urlRef.current = objectUrl;
        setAudio(recorded); setUrl(objectUrl); setPhase('preview');
      };
      try {
        const AudioContextClass = window.AudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          context.current = ctx;
          const source = ctx.createMediaStreamSource(media);
          const node = ctx.createAnalyser();
          node.fftSize = 256;
          source.connect(node);
          setAnalyser(node);
        }
      } catch { /* audio visualization is optional; recording still works */ }
      r.start(1000);
      started.current = Date.now();
      tick.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) stop('limit');
        else if (elapsed >= 105) setNotice('warning');
      }, 250);
      setPhase('recording');
      try { navigator.vibrate?.(20); } catch { /* vibration is optional */ }
    } catch (e) {
      media?.getTracks().forEach((t) => t.stop());
      releaseMic();
      if (generation.current !== id) return;
      const name = e instanceof DOMException ? e.name : '';
      setError(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' :
        name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'noInput' :
          name === 'NotSupportedError' ? 'unsupported' : 'micError');
      setPhase('intro');
    }
  }, [clearAudio, releaseMic, stop]);

  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === 'hidden') stop(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [stop]);
  useEffect(() => () => {
    generation.current++;
    cancelled.current = true;
    const r = recorder.current;
    if (r?.state !== 'inactive') { try { r?.stop(); } catch { /* already stopped */ } }
    if (tick.current) clearInterval(tick.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    if (context.current) void context.current.close().catch(() => {});
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  return { phase, seconds, notice, error, audio, url, analyser, start, stop, cancel };
}