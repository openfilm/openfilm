/** Keep the output name stable while an OpenFilm canvas request has no locally delivered result. */
export interface CanvasMediaRequest { verb: string; args: Record<string, string | string[]> }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
async function hash(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value))))).map(byte => byte.toString(16).padStart(2,'0')).join('');
}
export async function pendingCanvasMedia(scope: unknown, request: CanvasMediaRequest, pick: {via?:string;model?:string}, storage: Store = localStorage) {
  const id = 'openfilm:canvas-media-pending:v1:' + await hash(scope);
  const {out: proposed,...args} = request.args;
  const identity = await hash({verb:request.verb,args,pick});
  let raw: string | null;
  try { raw = storage.getItem(id); } catch { throw new Error('Could not read the saved media request. No new generation was started.'); }
  let previous: {identity:string;out:string} | null = null;
  if (raw !== null) {
    try {
      previous = JSON.parse(raw);
      if (!previous || !/^[a-f0-9]{64}$/.test(previous.identity) || typeof previous.out !== 'string' || !previous.out || previous.out.length > 512) throw Error();
    } catch { throw new Error('The saved canvas media request is damaged. Check its outcome before generating another take.'); }
  }
  const resumed = previous?.identity === identity;
  const out = resumed ? previous!.out : proposed;
  if (typeof out !== 'string' || !out) throw new Error('A generated output name is required.');
  const saved = JSON.stringify({identity,out});
  try { storage.setItem(id,saved); } catch { throw new Error('Could not save the media recovery request. No new generation was started.'); }
  return {request:{...request,args:{...request.args,out}},resumed,
    finish() { try { if (storage.getItem(id) === saved) storage.removeItem(id); } catch { /* the delivered asset is already saved */ } },
  };
}
