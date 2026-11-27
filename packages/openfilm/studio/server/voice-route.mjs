// @ts-check
/**
 * The voice a voice-over asks for, matched to a model that has it, before anything is sent (`openfilm get tts`).
 *
 * An agent may name one service's voice while the run goes to another service's model (a Doubao voice sent to
 * ElevenLabs). It may give a voice's name for its id, an id cut short, or a private voice in the form Studio showed it.
 * Each of these used to start a run that the service then refused. Here the voice is settled first. The library's
 * voices (library/voices.json) say which service has which id and name. The shape of an id says the rest: ElevenLabs
 * ids are 20 letters and digits, Cartesia's are UUIDs, and Doubao's start with ICL_ or S_ or end in _bigtts or _tob.
 */

/** @typedef {{ provider: string, id: string, name: string, pair?: boolean }} LibraryVoice */
/** @typedef {{ id: string, clones?: string, dialogue?: boolean }} OfferedModel */

const SHAPES = /** @type {const} */ ([
  ['cartesia', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['elevenlabs', /^[A-Za-z0-9]{20}$/],
  ['doubao', /^(ICL_|S_)|_(bigtts|tob)$/],
]);
const NAMES = /** @type {Record<string, string>} */ ({ elevenlabs: 'ElevenLabs', inworld: 'Inworld', cartesia: 'Cartesia', doubao: 'Doubao' });
/** the shortest start of an id taken for the whole of it */
const PREFIX = 12;

/** A name as it is compared: its letters and digits in lower case ("Shan Shan" and "ShanShan" are one name). */
const squash = (/** @type {string} */ s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** A service's name for people. */
export const serviceName = (/** @type {string} */ service) => NAMES[service] ?? service;

/** The service a model speaks with: OpenFilm's models carry it ("doubao/seed-tts-2.0"), a provider's own are its. */
export const serviceOfModel = (/** @type {string} */ provider, /** @type {string | undefined} */ model) =>
  provider === 'openfilm' && model?.includes('/') ? model.split('/')[0] : provider;

/**
 * A private voice given another way, as `my:<uid>`: the reference Studio shows ("openfilm/my:<uid>"), its uid alone,
 * or its name. Anything else is returned as it came.
 * @param {string} voice @param {{ uid: string, name: string }[]} assets
 */
export function privateVoiceAlias(voice, assets) {
  const bare = voice.replace(/^[a-z]+\/(?=my:)/, '');
  if (bare.startsWith('my:')) return bare;
  const found = assets.filter((a) => a.uid === voice || (squash(a.name) !== '' && squash(a.name) === squash(voice)));
  return found.length === 1 ? `my:${found[0].uid}` : voice;
}

/**
 * The voices of `service` that `voice` may mean: its id, an id it is the start of, or (`byName`) a voice of its name.
 * @param {string} voice @param {LibraryVoice[]} voices @param {string} service @param {boolean} byName
 */
function matches(voice, voices, service, byName) {
  const own = voices.filter((v) => v.provider === service && !v.pair);
  const exact = own.filter((v) => v.id === voice);
  if (exact.length) return exact;
  const cut = voice.length >= PREFIX ? own.filter((v) => v.id.startsWith(voice)) : [];
  if (cut.length === 1 || !byName) return cut.length === 1 ? cut : [];
  const key = squash(voice);
  return key ? own.filter((v) => squash(v.name) === key) : [];
}

/**
 * Which service's voice `voice` is, and which of its voices. The run's own service is asked first (its ids, an id cut
 * short, its voices' names). Another service is told only by what cannot be a name: an id the library has for it, the
 * shape of its ids, or the start of one of its ids. A service the library has no voices of (Azure, Google…) may have
 * voices of any name, so for it only shapes count. `several`: the run's service has more than one voice of that name.
 * null: nothing tells.
 * @param {string} voice @param {LibraryVoice[]} voices @param {string} service the run's
 * @returns {{ service: string, id: string, name?: string } | { service: string, several: LibraryVoice[] } | null}
 */
export function whoseVoice(voice, voices, service) {
  const listed = voices.some((v) => v.provider === service);
  const here = listed ? matches(voice, voices, service, true) : [];
  if (here.length === 1) return { service, id: here[0].id, name: here[0].name };
  const exact = listed ? voices.filter((v) => v.id === voice && !v.pair) : [];
  if (exact.length === 1) return { service: exact[0].provider, id: voice, name: exact[0].name };
  const shape = SHAPES.find(([, re]) => re.test(voice));
  if (shape) {
    const known = matches(voice, voices, shape[0], false);
    return { service: shape[0], id: known.length === 1 ? known[0].id : voice, ...(known.length === 1 ? { name: known[0].name } : {}) };
  }
  if (here.length > 1) return { service, several: here };
  /* an id this long is no name: another service's, whole or cut short */
  const elsewhere = voice.length < PREFIX ? [] : [...new Set(voices.map((v) => v.provider))].filter((s) => s !== service)
    .map((s) => ({ s, found: matches(voice, voices, s, false) })).filter((x) => x.found.length === 1);
  if (elsewhere.length === 1) return { service: elsewhere[0].s, id: elsewhere[0].found[0].id, name: elsewhere[0].found[0].name };
  return null;
}

/**
 * The voice and model a voice-over runs with. A voice of the run's own service runs as asked, with its id where it was
 * given by name or cut short. A voice of another service is spoken by that service's model, when the provider has one
 * and no --model was named. Otherwise the run stops here with what to do, nothing sent and nothing spent.
 * @param {{ voice: string, provider: { id: string, name: string }, model: string | undefined, named: boolean,
 *   offered: OfferedModel[], chosen?: string, voices: LibraryVoice[] }} run
 *   `model`: the model it would run; `named`: --model asked for it; `chosen`: the person's model for voice-over
 * @returns {{ voice: string, model: string | undefined, note?: string } | { refuse: string, service?: string, called?: string }}
 *   `service` and `called`: the service whose voice it is, and the voice in words, when it is another service's
 */
export function routeVoice({ voice, provider, model, named, offered, chosen, voices }) {
  const service = serviceOfModel(provider.id, model);
  const name = (/** @type {string} */ s) => s === provider.id ? provider.name : serviceName(s);
  const whose = whoseVoice(voice, voices, service);
  if (!whose) return { voice, model };
  if ('several' in whose) {
    const ids = whose.several.slice(0, 5).map((v) => `${v.id} (${v.name})`).join(', ');
    return { refuse: `--voice takes a voice's id, not its name: ${name(service)} has ${whose.several.length} voices named ${voice}: ${ids}. \`openfilm get voice\` finds them. Nothing was sent.` };
  }
  const called = `the ${name(whose.service)} voice ${whose.name ? `${whose.id} (${whose.name})` : whose.id}`;
  if (whose.service === service) {
    return whose.id === voice ? { voice, model } : { voice: whose.id, model, note: `--voice ${voice} is ${called}: spoken in it.` };
  }
  const fits = offered.filter((m) => serviceOfModel(provider.id, m.id) === whose.service && m.clones !== 'only' && !m.dialogue);
  const runs = model ?? provider.name;
  if (!named && fits.length) {
    const to = (fits.find((m) => m.id === chosen) ?? fits[0]).id;
    return { voice: whose.id, model: to, note: `--voice ${voice} is ${called}, which ${runs} cannot speak: spoken by ${to}.` };
  }
  const how = fits.length ? `--model ${fits[0].id}` : `a model of ${name(whose.service)} (--via ${whose.service}${provider.id === 'openfilm' ? '' : ', or OpenFilm\'s service'})`;
  return { service: whose.service, called, refuse: `--voice ${voice} is ${called}, and ${runs} speaks only ${name(service)} voices. Speak it with ${how}, or choose one of its own voices (\`openfilm get voice\`). Nothing was sent.` };
}
