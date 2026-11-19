import React from 'react';
import { proxyText, type MediaProxy, type MediaSources, type WorkspaceResource } from './workspace-resources';

export function cannotDecode(media: HTMLVideoElement) {
  const code = media.error?.code;
  return code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
}

export async function prepareVideoCopy(copy: string, signal: AbortSignal, progress?: (state: MediaProxy) => void): Promise<string> {
  const url = new URL(copy, window.location.href);
  for (;;) {
    const response = await fetch(url, { method: 'POST', signal });
    if (!response.ok) throw new Error('The playback copy could not be prepared.');
    const proxy = await response.json() as MediaProxy & { height: number };
    signal.throwIfAborted();
    url.searchParams.set('height', String(proxy.height));
    if (proxy.state === 'ready') return url.href;
    if (proxy.state === 'failed') throw new Error(proxy.reason ?? 'The playback copy could not be prepared.');
    progress?.(proxy);
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { window.clearTimeout(timer); reject(signal.reason); };
      const timer = window.setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1000);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
}

/** Visible players try the original and share the local compatibility copy when decoding fails. */
export function useVideoPlayback(file: WorkspaceResource, sources: MediaSources) {
  const original = sources.file(file);
  const copy = file.kind === 'video' ? sources.videoCopy?.(file) : undefined;
  const [nativeError, setNativeError] = React.useState<{ src: string; canRetry: boolean }>();
  const [copyError, setCopyError] = React.useState<string>();
  const [result, setResult] = React.useState<{ for: string; proxy: MediaProxy; url?: string }>();
  const failedOriginal = nativeError?.src === original;
  const needsCopy = Boolean(copy && (file.proxy?.needed || (failedOriginal && nativeError?.canRetry)));
  const attempt = needsCopy && result?.for === copy ? result : undefined;
  const src = needsCopy ? attempt?.url : original;

  React.useEffect(() => {
    if (!needsCopy || !copy) return;
    const abort = new AbortController();
    void prepareVideoCopy(copy, abort.signal, (proxy) => setResult({ for: copy, proxy })).then(
      (url) => { if (!abort.signal.aborted) setResult({ for: copy, proxy: { state: 'ready', needed: true }, url }); },
      () => { if (!abort.signal.aborted) setResult({ for: copy, proxy: { state: 'failed', needed: true } }); },
    );
    return () => abort.abort();
  }, [copy, needsCopy]);

  const failed = needsCopy ? attempt?.proxy.state === 'failed' || (src !== undefined && copyError === src) : failedOriginal;
  const preparing = needsCopy && !failed && !src;
  return {
    src,
    failed,
    preparing,
    message(t: (key: string) => string, unavailable = 'canvas.video.unavailable') {
      if (preparing) return proxyText(attempt?.proxy ?? { state: 'waiting', needed: true }, t);
      if (failed) return t(unavailable);
      return '';
    },
    onError(event: React.SyntheticEvent<HTMLVideoElement>) {
      if (!src) return;
      if (needsCopy) { setCopyError(src); return; }
      setNativeError({ src, canRetry: cannotDecode(event.currentTarget) });
    },
  };
}
