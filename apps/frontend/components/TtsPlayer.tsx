'use client';

import { useState, useRef } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  text: string;
  className?: string;
}

export function TtsPlayer({ text, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  async function generate() {
    if (audioUrl) {
      audioRef.current?.play();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setTimeout(() => audioRef.current?.play(), 50);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <button
        onClick={() => void generate()}
        disabled={loading}
        title="Read aloud"
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle transition hover:bg-white/[0.05] hover:text-fg disabled:opacity-40"
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Volume2 size={11} />}
        <span>Listen</span>
      </button>
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} controls className="h-6 max-w-[180px]" />
      )}
    </span>
  );
}
