/**
 * Sharing the person's own media with the Community (studio/server/community-share.mjs): their name and page there,
 * a library file as it would be shared, sharing itself (in the background, with how far it is), and what they shared
 * with how each review went. Also what was asked to be shared from a menu, until the Community window's Publish page
 * takes it up.
 */
import React from 'react';
import { openPlugins } from './plugins-window.ts';
import { SourceError } from './project-sources.ts';

export interface CommunityProfile { name: string; displayName: string; bio: string; avatar: string | null; since: string }
export type ShareProblem = 'not-media' | 'format' | 'too-big' | 'too-long' | 'codec' | 'too-large';
/** A library file as it would be shared; `problem`: why the Community would not take it as it is. */
export interface Shareable { path: string; media: 'video' | 'image' | 'audio' | null; ext: string; bytes: number; durationMs: number; name: string; title: string; problem?: ShareProblem }
export type ShareSource = { kind: 'own' } | { kind: 'ai'; tool: string } | { kind: 'cc0'; url: string };
export interface ShareRequest {
  language: string;
  agreed: true;
  items: { path: string; name: string; title: string; about: string; tags: string[]; source: ShareSource }[];
  pack?: { name: string; title: string; about: string };
}
export type SubmissionState = 'uploading' | 'reviewing' | 'approved' | 'declined' | 'failed' | 'withdrawing' | 'withdrawn';
export interface Submission {
  id: string; state: SubmissionState; title: string; items: { id: string; title: string; version: number }[];
  pack?: { id: string; title: string }; film?: { id: string; title: string; version: number }; review?: string; note?: string; createdAt: string; updatedAt: string;
}
/** What of a project a shared film can hold: its edit always; its canvas and the rest of its media when chosen. */
export type FilmPart = 'edit' | 'canvas' | 'media';
export type FilmProblem = 'no-film' | 'too-big' | 'too-many' | 'secret';
type Held = { files: number; bytes: number };
/** A project as a film to share: what each part holds (null: nothing), what a shared film may be, and what stands in the way. */
export interface FilmShareable {
  title: string; duration?: number;
  parts: { edit: Held; canvas: Held | null; media: Held | null };
  limits: { files: number; bytes: number; fileBytes: number };
  left: { path: string; why: string }[];
  problem?: FilmProblem; file?: string;
}
export interface FilmRequest { language: string; agreed: true; name: string; title: string; about: string; category?: string; parts: FilmPart[] }
export interface ShareJob { state: 'preparing' | 'uploading' | 'handing' | 'done' | 'failed'; sent: number; total: number; submission?: Submission; error?: string; code?: string; item?: string }

async function call<T>(path: string, method = 'GET', json?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, { method, ...(json === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SourceError(String(body.error ?? `Studio answered ${res.status}`), res.status, typeof body.code === 'string' ? body.code : null);
  return body as T;
}

export const shareApi = {
  profile: () => call<{ signedIn: boolean; profile: CommunityProfile | null; suggested?: string }>('community/profile'),
  saveProfile: (body: { name?: string; displayName?: string; bio?: string }) => call<{ profile: CommunityProfile }>('community/profile', 'PUT', body),
  /** Anyone's page, or null when no account has that name (a GitHub author's has none). */
  author: (name: string) => call<{ profile: CommunityProfile | null }>(`community/profiles/${encodeURIComponent(name)}`).then((r) => r.profile, () => null),
  check: (paths: string[]) => call<{ items: Shareable[]; folder?: string }>('community/share/check', 'POST', { paths }),
  share: (request: ShareRequest) => call<{ job: string }>('community/share', 'POST', request),
  job: (id: string) => call<ShareJob>(`community/share/${encodeURIComponent(id)}`),
  submissions: () => call<{ signedIn: boolean; submissions: Submission[] }>('community/submissions'),
  /** Take back one of them: in review, it is closed; listed, its removal is proposed. */
  withdraw: (id: string) => call<{ submission: Submission }>(`community/submissions/${encodeURIComponent(id)}/withdraw`, 'POST'),
  film: (projectId: string) => call<FilmShareable>(`projects/${encodeURIComponent(projectId)}/community`),
  shareFilm: (projectId: string, request: FilmRequest) => call<{ job: string }>(`projects/${encodeURIComponent(projectId)}/community/share`, 'POST', request),
};

export { namesFor, slugOf, wordsOf } from './community-share-names.ts';

/** What a menu asked to share: files of the library, or a project as a film. */
export type AskedShare = { paths: string[] } | { film: string };

/* taken up by the Publish page */
let asked: AskedShare | null = null;
const listeners = new Set<() => void>();
const tell = () => { for (const fn of listeners) fn(); };

/** Share these library files (or the files of this folder): opens the Community window's Publish page on them. */
export function askShare(paths: string[]) {
  asked = paths.length ? { paths } : null;
  tell();
  openPlugins({ line: 'publish' });
}

/** Share this project as a film: opens the Community window's Publish page on it. */
export function askShareFilm(projectId: string) {
  asked = { film: projectId };
  tell();
  openPlugins({ line: 'publish' });
}

/** The name a project was shared under last, kept on this computer so that sharing it again is its next version. */
const filmNameKey = (projectId: string) => `openfilm.share.film.${projectId}`;
export function sharedFilmName(projectId: string): string | null { try { return localStorage.getItem(filmNameKey(projectId)); } catch { return null; } }
export function keepFilmName(projectId: string, name: string) { try { localStorage.setItem(filmNameKey(projectId), name); } catch { /* not kept */ } }

/** What was asked to be shared, and the way to let go of it (shared, or given up). */
export function useAskedShare(): [AskedShare | null, () => void] {
  const paths = React.useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => asked, () => asked);
  return [paths, React.useCallback(() => { asked = null; tell(); }, [])];
}
