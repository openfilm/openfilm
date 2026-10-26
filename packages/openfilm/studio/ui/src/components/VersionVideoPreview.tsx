/** A saved version plays from its own read-only folder, with its own clock and audio mix. */
import React from 'react';
import { Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { api } from '@/api';
import { Preview, type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import { Player } from '@/editor/player';
import { useT } from '@/i18n';
import { historyApi, type VersionPreview } from '@/lib/project-history';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

export function VersionVideoPreview({ projectId, commit }: { projectId: string; commit: string | null }) {
  const t = useT();
  const [snapshot, setSnapshot] = React.useState<VersionPreview | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setSnapshot(null);
    setFailed(false);
    const load = async () => {
      if (commit) {
        const result = await historyApi.preview(projectId, commit);
        if (active) {
          if (result.ok) setSnapshot(result.body);
          else setFailed(true);
        }
      } else {
        try {
          const film = await api.film(projectId);
          if (active) setSnapshot({ folder: film.folder, doc: film.doc, missing: [] });
        } catch {
          if (active) setFailed(true);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [projectId, commit, attempt]);

  if (failed || (snapshot && !snapshot.doc))
    return (
      <div
        role="alert"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--canvas)] px-6 py-8 text-center"
      >
        <p className="text-[12px] text-[var(--text-muted)]">{t('versions.previewFailed')}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px]"
        >
          {t('versions.retry')}
        </button>
      </div>
    );
  if (!snapshot)
    return (
      <div
        role="status"
        aria-label={t('versions.previewLoading')}
        className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-[var(--canvas)] text-[12px] text-[var(--text-muted)]"
      >
        <Loader2 size={15} className="animate-spin" />
        {t('versions.previewLoading')}
      </div>
    );
  return <SnapshotPlayer snapshot={snapshot} />;
}

function SnapshotPlayer({ snapshot }: { snapshot: VersionPreview }) {
  const t = useT();
  const preview = React.useRef<PreviewHandle>(null);
  const [player] = React.useState(() => new Player());
  const [stage, setStage] = React.useState(snapshot.doc?.stage ?? { w: 1920, h: 1080 });
  const [duration, setDuration] = React.useState(0);
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const now = React.useCallback(() => player.time(), [player]);
  React.useEffect(() => {
    player.onAnchor = (anchor) => preview.current?.play?.(anchor);
    return () => {
      player.onAnchor = null;
      player.close();
    };
  }, [player]);
  React.useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const at = player.time();
      setTime(at);
      if (at >= player.duration - 0.001) {
        player.pause();
        preview.current?.seek(Math.max(0, player.duration - 0.001));
        setPlaying(false);
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);
  React.useEffect(() => {
    if (error) {
      player.pause();
      setPlaying(false);
    }
  }, [error, player]);
  const onInfo = React.useCallback(
    (info: FilmInfo) => {
      setStage({ w: info.width, h: info.height });
      setDuration(info.duration);
      player.load(snapshot.folder, info.sounds, info.duration);
    },
    [player, snapshot.folder]
  );
  const seek = (at: number) => {
    player.seek(at);
    if (!player.playing) preview.current?.seek(Math.min(at, Math.max(0, duration - 0.001)));
    setTime(at);
  };
  const toggle = () => {
    if (!duration || error) return;
    if (player.playing) {
      player.pause();
      preview.current?.seek(player.time());
    } else player.play();
    setPlaying(player.playing);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-[var(--canvas)]" aria-label={t('versions.videoPreview')}>
        <Preview ref={preview} folder={snapshot.folder} stage={stage} time={now} onInfo={onInfo} onError={setError} />
      </div>
      {snapshot.missing.length ? (
        <p
          role="status"
          className="shrink-0 border-t border-[var(--border-soft)] bg-[var(--surface-2)] px-4 py-1.5 text-[11px] text-[var(--warn)]"
        >
          {t('versions.previewMissing').replace('{n}', String(snapshot.missing.length))}
        </p>
      ) : null}
      <div className="flex h-11 shrink-0 items-center gap-3 border-t border-[var(--border-soft)] px-4">
        <button
          type="button"
          disabled={!duration || !!error}
          onClick={toggle}
          aria-label={t(playing ? 'versions.pause' : 'versions.play')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
          {clock(time)} / {clock(duration)}
        </span>
        <input
          type="range"
          aria-label={t('versions.seek')}
          min={0}
          max={duration || 1}
          step={0.01}
          value={time}
          disabled={!duration || !!error}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--text)]"
        />
        <button
          type="button"
          aria-label={t(muted ? 'versions.unmute' : 'versions.mute')}
          onClick={() => {
            player.setMuted(!muted);
            setMuted(!muted);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      </div>
    </div>
  );
}
