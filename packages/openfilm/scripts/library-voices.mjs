#!/usr/bin/env node
// @ts-check
/**
 * The library's voices (library/voices.json): the ready-made voices of the voice-over services OpenFilm offers
 * (ElevenLabs Eleven v4, Inworld TTS-2, Cartesia Sonic 3.6), as each service's own API lists them, each with its
 * service's own sample, made small (library/voices/<service>/<voice>.m4a).
 *
 *   ELEVENLABS_API_KEY=… INWORLD_API_KEY=… CARTESIA_API_KEY=… node scripts/library-voices.mjs [--make-samples]
 *
 * Listing voices and their samples costs nothing with any of them. A sample already here is kept; a service without
 * a key keeps what voices.json had for it.
 *
 *   ElevenLabs  its own voices (premade), every voice its Voice Library features, and the most used of the library in
 *               each language (its twenty thousand are too many to browse): only those billed at its usual rate,
 *               with a notice period before they leave, and without live moderation
 *   Inworld     all its own voices
 *   Cartesia    all its public voices; a voice it gives no sample of has one made with `--make-samples` (Sonic 3.6
 *               says LINES in its language, a few cents for them all), else none
 *
 * `featured`: the service picked it (ElevenLabs' own voices and the ones its library features); `uses`: how much it is
 * used, where the service says (ElevenLabs: characters spoken in a year), to list the most used first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIBRARY = fileURLToPath(new URL('../library/', import.meta.url));
const OUT = join(LIBRARY, 'voices.json');
/* a sample: one channel, small, its first seconds */
const SAMPLE_SECONDS = 15;

/**
 * @typedef {{ provider: string, id: string, name: string, description: string | null, gender: 'm' | 'f' | 'n' | null,
 *   age: 'young' | 'middle' | 'old' | null, language: string | null, accent: string | null, tags: string[], sample: string | null,
 *   featured: boolean, uses: number | null }} Voice
 * @typedef {{ voice: Voice, fetch: () => Promise<Uint8Array | null> }} Found
 */

/** The services, in the order the library shows them, each with the models a voice of it speaks with. */
const PROVIDERS = [
  { id: 'elevenlabs', name: 'ElevenLabs', models: [{ id: 'eleven_v4', name: 'Eleven v4' }, { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo' }] },
  { id: 'inworld', name: 'Inworld', models: [{ id: 'inworld-tts-2', name: 'TTS-2' }, { id: 'inworld-tts-2-flash', name: 'TTS-2 Flash' }] },
  { id: 'cartesia', name: 'Cartesia', models: [{ id: 'sonic-3.6', name: 'Sonic 3.6' }] },
];

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '');
const sex = (/** @type {unknown} */ v) => {
  const s = str(v).toLowerCase();
  return s === 'male' || s === 'masculine' ? 'm' : s === 'female' || s === 'feminine' ? 'f' : s === 'neutral' || s === 'gender_neutral' ? 'n' : null;
};
const ageOf = (/** @type {unknown} */ v) => {
  const s = str(v).toLowerCase();
  return s === 'young' ? 'young' : s === 'middle_aged' || s === 'middle aged' ? 'middle' : s === 'old' || s === 'elderly' ? 'old' : null;
};
/** "informative_educational" → "informative educational" */
const words = (/** @type {unknown} */ v) => str(v).replace(/[_-]+/g, ' ');
const fileName = (/** @type {string} */ id) => id.replace(/[^\w.-]+/g, '_');

/** GET as JSON, asked again a few times when the service says to wait. @param {string} url @param {Record<string, string>} headers */
async function json(url, headers) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && i < 5) { await sleep(1000 * 2 ** i); continue; }
    throw new Error(`${url.split('?')[0]} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** GET as bytes (null when it is not there). @param {string} url @param {Record<string, string>} [headers] */
async function bytes(url, headers = {}) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    if ((res.status === 429 || res.status >= 500) && i < 5) { await sleep(1000 * 2 ** i); continue; }
    return null;
  }
}

/* ElevenLabs' library: how many of the most used are kept in each language (the rest of the world's: `OTHER`) */
const ELEVEN_LANGUAGES = { en: 240, zh: 60, ja: 60, ko: 60, es: 60, fr: 30, de: 30, pt: 30, it: 30, hi: 30, ar: 30, ru: 30, tr: 20, pl: 20, nl: 20, id: 20, vi: 20 };

/** "Bella - Professional, Bright, Warm" is Bella, those three words her tags. @param {string} full */
const nameAndTags = (full) => {
  const [name, ...rest] = full.split(/\s+-\s+/);
  return { name: name?.trim() || full, tags: rest.join(' - ').split(',').map(str).filter(Boolean) };
};

/**
 * ElevenLabs' own voices, the ones its Voice Library features, and the most used there in each language.
 * @param {string} key @returns {Promise<Found[]>}
 */
async function elevenlabs(key) {
  const auth = { 'xi-api-key': key };
  /** @type {Map<string, Found>} */
  const found = new Map();
  const own = await json('https://api.elevenlabs.io/v2/voices?category=premade&page_size=100', auth);
  for (const v of own.voices ?? []) {
    const labels = v.labels ?? {};
    const { name, tags } = nameAndTags(str(v.name));
    found.set(str(v.voice_id), {
      voice: {
        provider: 'elevenlabs', id: str(v.voice_id), name, description: str(v.description) || null,
        gender: sex(labels.gender), age: ageOf(labels.age), language: str(labels.language) || null, accent: words(labels.accent) || null,
        tags: [...new Set([...tags, words(labels.use_case)].filter(Boolean))], sample: null, featured: true, uses: null,
      },
      fetch: () => (v.preview_url ? bytes(v.preview_url) : Promise.resolve(null)),
    });
  }
  /** a voice of the library, when it is billed as any other, will not leave at once, and is not moderated live */
  const take = (/** @type {any} */ v) => {
    const id = str(v.voice_id);
    if (!id || found.has(id) || (v.rate ?? 1) !== 1 || v.fiat_rate || !(v.notice_period >= 30) || v.live_moderation_enabled) return false;
    const { name, tags } = nameAndTags(str(v.name));
    found.set(id, {
      voice: {
        provider: 'elevenlabs', id, name, description: str(v.description) || null, gender: sex(v.gender), age: ageOf(v.age),
        language: str(v.locale) || str(v.language) || null, accent: words(v.accent) || null,
        tags: [...new Set([...tags, words(v.descriptive), words(v.use_case)].filter(Boolean))], sample: null,
        featured: v.featured === true, uses: typeof v.usage_character_count_1y === 'number' ? v.usage_character_count_1y : null,
      },
      fetch: () => (v.preview_url ? bytes(v.preview_url) : Promise.resolve(null)),
    });
    return true;
  };
  const library = (/** @type {string} */ query) => json(`https://api.elevenlabs.io/v1/shared-voices?page_size=100&${query}`, auth);
  for (const v of (await library('featured=true')).voices ?? []) take(v);
  for (const [language, most] of Object.entries(ELEVEN_LANGUAGES)) {
    let kept = 0;
    for (let page = 0; kept < most && page < 10; page++) {
      const body = await library(`language=${language}&sort=usage_character_count_1y&page=${page}`);
      for (const v of body.voices ?? []) if (kept < most && take(v)) kept++;
      if (!body.has_more) break;
    }
  }
  return [...found.values()];
}

/** Inworld's own voices (its system voices); a sample is asked for each, a few a second (its limit is lower). @param {string} key @returns {Promise<Found[]>} */
async function inworld(key) {
  const auth = { authorization: `Basic ${key}` };
  const body = await json(`https://api.inworld.ai/voices/v1/voices?pageSize=2000&filter=${encodeURIComponent('source="SYSTEM"')}`, auth);
  return (body.voices ?? []).map((/** @type {any} */ v) => ({
    voice: {
      provider: 'inworld', id: str(v.voiceId), name: str(v.displayName) || str(v.voiceId), description: str(v.description) || null,
      gender: sex(v.gender), age: ageOf(v.ageGroup), language: str(v.languageCode) || null, accent: null,
      tags: (Array.isArray(v.tags) ? v.tags : []).map(words).filter(Boolean), sample: null, featured: false, uses: null,
    },
    fetch: async () => {
      await sleep(350);
      const said = await json(`https://api.inworld.ai/tts/v1/voice:preview?voice_id=${encodeURIComponent(str(v.voiceId))}&model_id=inworld-tts-2`, auth).catch(() => null);
      return typeof said?.audioContent === 'string' ? new Uint8Array(Buffer.from(said.audioContent, 'base64')) : null;
    },
  }));
}

/**
 * What a voice says in a sample made for it, in its own language: its name, and OpenFilm's welcome. Thai says who
 * speaks as a man or a woman does.
 * @type {Record<string, (name: string, gender: Voice['gender']) => string>}
 */
const LINES = {
  en: (n) => `Hi, I'm ${n}. Welcome to OpenFilm. Tell me the film you have in mind, and let's make it together.`,
  es: (n) => `Hola, soy ${n}. Bienvenido a OpenFilm. Cuéntame la película que tienes en mente y hagámosla juntos.`,
  fr: (n) => `Bonjour, je suis ${n}. Bienvenue sur OpenFilm. Racontez-moi le film que vous imaginez, et faisons-le ensemble.`,
  de: (n) => `Hallo, ich bin ${n}. Willkommen bei OpenFilm. Erzähl mir von dem Film, den du im Kopf hast, und lass ihn uns gemeinsam machen.`,
  pt: (n) => `Olá, eu sou ${n}. Bem-vindo ao OpenFilm. Conte-me o filme que você tem em mente, e vamos fazê-lo juntos.`,
  it: (n) => `Ciao, sono ${n}. Benvenuto su OpenFilm. Raccontami il film che hai in mente e facciamolo insieme.`,
  nl: (n) => `Hoi, ik ben ${n}. Welkom bij OpenFilm. Vertel me over de film die je in gedachten hebt, en laten we hem samen maken.`,
  sv: (n) => `Hej, jag heter ${n}. Välkommen till OpenFilm. Berätta om filmen du har i tankarna, så gör vi den tillsammans.`,
  da: (n) => `Hej, jeg hedder ${n}. Velkommen til OpenFilm. Fortæl mig om den film, du har i tankerne, så laver vi den sammen.`,
  no: (n) => `Hei, jeg heter ${n}. Velkommen til OpenFilm. Fortell meg om filmen du ser for deg, så lager vi den sammen.`,
  fi: (n) => `Hei, olen ${n}. Tervetuloa OpenFilmiin. Kerro minulle elokuvasta, joka sinulla on mielessäsi, niin tehdään se yhdessä.`,
  pl: (n) => `Cześć, jestem ${n}. Witaj w OpenFilm. Opowiedz mi o filmie, który masz w głowie, i zróbmy go razem.`,
  cs: (n) => `Ahoj, jsem ${n}. Vítejte v OpenFilmu. Řekněte mi, jaký film máte na mysli, a pojďme ho natočit spolu.`,
  hu: (n) => `Szia, ${n} vagyok. Üdvözöllek az OpenFilmben. Mesélj a filmről, ami a fejedben van, és készítsük el együtt.`,
  hr: (n) => `Bok, ja sam ${n}. Dobro došli u OpenFilm. Recite mi kakav film zamišljate i napravimo ga zajedno.`,
  bg: (n) => `Здравей, аз съм ${n}. Добре дошли в OpenFilm. Разкажи ми за филма, който си представяш, и нека го направим заедно.`,
  ru: (n) => `Привет, я ${n}. Добро пожаловать в OpenFilm. Расскажи мне, какой фильм ты задумал, и давай сделаем его вместе.`,
  tr: (n) => `Merhaba, ben ${n}. OpenFilm'e hoş geldiniz. Aklınızdaki filmi bana anlatın, birlikte yapalım.`,
  ar: (n) => `مرحبًا، أنا ${n}. أهلًا بك في OpenFilm. أخبرني عن الفيلم الذي تتخيله، ولنصنعه معًا.`,
  he: (n) => `שלום, אני ${n}. ברוכים הבאים ל-OpenFilm. ספרו לי על הסרט שאתם מדמיינים, ובואו ניצור אותו יחד.`,
  hi: (n) => `नमस्ते, मैं ${n} हूँ। OpenFilm में आपका स्वागत है। मुझे अपनी सोची हुई फ़िल्म के बारे में बताइए, और चलिए उसे साथ मिलकर बनाते हैं।`,
  ur: (n) => `السلام علیکم، میں ${n} ہوں۔ OpenFilm میں خوش آمدید۔ مجھے اپنی سوچی ہوئی فلم کے بارے میں بتائیے، اور آئیے اسے مل کر بناتے ہیں۔`,
  bn: (n) => `নমস্কার, আমি ${n}। OpenFilm-এ আপনাকে স্বাগতম। আপনার মনের ছবিটার কথা আমাকে বলুন, চলুন একসাথে সেটা বানাই।`,
  ta: (n) => `வணக்கம், நான் ${n}. OpenFilm-க்கு உங்களை வரவேற்கிறேன். உங்கள் மனதில் உள்ள படத்தைப் பற்றிச் சொல்லுங்கள், அதை நாம் சேர்ந்து உருவாக்கலாம்.`,
  te: (n) => `నమస్కారం, నేను ${n}. OpenFilm కి స్వాగతం. మీ మనసులో ఉన్న సినిమా గురించి చెప్పండి, దాన్ని మనం కలిసి తీద్దాం.`,
  kn: (n) => `ನಮಸ್ಕಾರ, ನಾನು ${n}. OpenFilm ಗೆ ಸ್ವಾಗತ. ನಿಮ್ಮ ಮನಸ್ಸಿನಲ್ಲಿರುವ ಚಿತ್ರದ ಬಗ್ಗೆ ಹೇಳಿ, ಅದನ್ನು ನಾವು ಒಟ್ಟಿಗೆ ಮಾಡೋಣ.`,
  ml: (n) => `നമസ്കാരം, ഞാൻ ${n}. OpenFilm-ലേക്ക് സ്വാഗതം. നിങ്ങളുടെ മനസ്സിലുള്ള സിനിമയെക്കുറിച്ച് പറയൂ, നമുക്ക് അത് ഒരുമിച്ച് ഉണ്ടാക്കാം.`,
  gu: (n) => `નમસ્તે, હું ${n} છું. OpenFilm માં આપનું સ્વાગત છે. તમારા મનમાં જે ફિલ્મ છે તેના વિશે મને કહો, અને ચાલો તેને સાથે મળીને બનાવીએ.`,
  pa: (n) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ${n} ਹਾਂ। OpenFilm ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਮੈਨੂੰ ਆਪਣੇ ਮਨ ਵਾਲੀ ਫ਼ਿਲਮ ਬਾਰੇ ਦੱਸੋ, ਆਓ ਇਸਨੂੰ ਮਿਲ ਕੇ ਬਣਾਈਏ।`,
  or: (n) => `ନମସ୍କାର, ମୁଁ ${n}। OpenFilm କୁ ସ୍ୱାଗତ। ଆପଣଙ୍କ ମନରେ ଥିବା ଫିଲ୍ମ ବିଷୟରେ ମୋତେ କୁହନ୍ତୁ, ଆସନ୍ତୁ ଏହାକୁ ମିଶି ତିଆରି କରିବା।`,
  th: (n, g) => (g === 'm'
    ? `สวัสดีครับ ผมชื่อ ${n} ยินดีต้อนรับสู่ OpenFilm เล่าให้ผมฟังหน่อยว่าคุณอยากทำหนังแบบไหน แล้วมาสร้างมันด้วยกันครับ`
    : `สวัสดีค่ะ ฉันชื่อ ${n} ยินดีต้อนรับสู่ OpenFilm เล่าให้ฉันฟังหน่อยว่าคุณอยากทำหนังแบบไหน แล้วมาสร้างมันด้วยกันค่ะ`),
  vi: (n) => `Xin chào, tôi là ${n}. Chào mừng bạn đến với OpenFilm. Hãy kể cho tôi về bộ phim bạn đang nghĩ đến, và cùng nhau làm nên nó nhé.`,
  id: (n) => `Halo, saya ${n}. Selamat datang di OpenFilm. Ceritakan film yang ada di benak Anda, dan mari kita buat bersama.`,
  ms: (n) => `Hai, saya ${n}. Selamat datang ke OpenFilm. Ceritakan filem yang anda bayangkan, dan mari kita hasilkannya bersama.`,
  tl: (n) => `Kumusta, ako si ${n}. Maligayang pagdating sa OpenFilm. Ikuwento mo sa akin ang pelikulang nasa isip mo, at sabay nating gawin ito.`,
  ja: (n) => `こんにちは、${n}です。OpenFilm へようこそ。思い描いている映画のことを聞かせてください。一緒に作りましょう。`,
  ko: (n) => `안녕하세요, 저는 ${n}입니다. OpenFilm에 오신 것을 환영합니다. 마음속에 있는 영화를 들려주세요. 함께 만들어 봐요.`,
  zh: (n) => `你好，我是${n}。欢迎来到 OpenFilm。告诉我你心中的那部影片，我们一起把它做出来。`,
  'zh-TW': (n) => `你好，我是${n}。歡迎來到 OpenFilm。告訴我你心中的那部影片，我們一起把它做出來。`,
  ka: (n) => `გამარჯობა, მე ვარ ${n}. კეთილი იყოს თქვენი მობრძანება OpenFilm-ში. მომიყევით ფილმზე, რომელიც გაქვთ ჩაფიქრებული, და ერთად შევქმნათ ის.`,
};

/** The line a voice says in its sample, by its language (English when there is none for it). @param {Voice} v */
function sampleLine(v) {
  const tag = v.language ?? 'en';
  const say = LINES[tag] ?? LINES[tag.split(/[-_]/)[0]] ?? LINES.en;
  return { text: say(v.name, v.gender), language: LINES[tag] || LINES[tag.split(/[-_]/)[0]] ? tag.split(/[-_]/)[0] : 'en' };
}

const MAKE_SAMPLES = process.argv.includes('--make-samples');

/** Cartesia's public voices. @param {string} key @returns {Promise<Found[]>} */
async function cartesia(key) {
  const auth = { authorization: `Bearer ${key}`, 'cartesia-version': '2026-08-14' };
  /** @type {any[]} */
  const all = [];
  for (let after = ''; ;) {
    const body = await json(`https://api.cartesia.ai/voices?limit=100&is_owner=false&expand[]=preview_file_url${after ? `&starting_after=${after}` : ''}`, auth);
    all.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) break;
    after = body.next_page;
  }
  return all.filter((v) => v.access === 'public').map((v) => {
    const native = (Array.isArray(v.accents) ? v.accents : []).find((/** @type {any} */ a) => a?.is_native);
    /** @type {Voice} */
    const voice = {
      provider: 'cartesia', id: str(v.id), name: str(v.name) || str(v.id), description: str(v.description) || null,
      gender: sex(v.gender), age: null, language: str(native?.locale) || str(v.language) || null, accent: words(native?.accent) || null,
      tags: str(v.tagline) ? [str(v.tagline)] : [], sample: null, featured: false, uses: null,
    };
    /* its own sample; else one made, its line said in its language by Sonic 3.6 (MP3) */
    const made = async () => {
      const { text, language } = sampleLine(voice);
      const res = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: 'sonic-3.6', transcript: text, voice: { mode: 'id', id: voice.id }, language,
          output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 } }),
      });
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    };
    return { voice, fetch: () => (v.preview_file_url ? bytes(v.preview_file_url, auth) : MAKE_SAMPLES ? made() : Promise.resolve(null)) };
  });
}

const LISTS = { elevenlabs: [elevenlabs, 'ELEVENLABS_API_KEY'], inworld: [inworld, 'INWORLD_API_KEY'], cartesia: [cartesia, 'CARTESIA_API_KEY'] };

/** The sample made small: one channel, 64 kbps AAC, its first seconds. @param {Uint8Array} raw @param {string} out */
function small(raw, out) {
  const tmp = `${out}.in`;
  writeFileSync(tmp, raw);
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-t', String(SAMPLE_SECONDS), '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out]);
  } finally { rmSync(tmp, { force: true }); }
}

const before = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { voices: [] };
/** @type {Voice[]} */
const voices = [];
for (const provider of PROVIDERS) {
  const [list, env] = /** @type {[(key: string) => Promise<Found[]>, string]} */ (LISTS[/** @type {keyof typeof LISTS} */ (provider.id)]);
  const key = process.env[env];
  if (!key) {
    const kept = before.voices.filter((/** @type {Voice} */ v) => v.provider === provider.id);
    console.log(`${provider.name}: no ${env}, ${kept.length} voices kept as they were`);
    voices.push(...kept);
    continue;
  }
  /* the service's picks first, then the most used, then by name */
  const found = (await list(key)).filter((f) => f.voice.id).sort((a, b) => Number(b.voice.featured) - Number(a.voice.featured)
    || (b.voice.uses ?? 0) - (a.voice.uses ?? 0) || a.voice.name.localeCompare(b.voice.name));
  mkdirSync(join(LIBRARY, 'voices', provider.id), { recursive: true });
  let made = 0;
  for (const { voice, fetch: sample } of found) {
    const rel = `voices/${provider.id}/${fileName(voice.id)}.m4a`;
    const file = join(LIBRARY, rel);
    if (!existsSync(file)) {
      const raw = await sample().catch(() => null);
      if (raw?.length) { small(raw, file); made++; }
    }
    if (existsSync(file)) voice.sample = rel;
    voices.push(voice);
  }
  console.log(`${provider.name}: ${found.length} voices, ${made} samples made, ${found.filter((f) => f.voice.sample).length} with a sample`);
}

/* Mandarin as the other services say it (ElevenLabs says `cmn`) */
for (const v of voices) if (v.language) v.language = v.language.replace(/^cmn\b/, 'zh');
/* within each service: its picks, then those with a sample to hear, then the most used, then by name */
const order = PROVIDERS.map((p) => p.id);
voices.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider) || Number(b.featured) - Number(a.featured)
  || Number(Boolean(b.sample)) - Number(Boolean(a.sample)) || (b.uses ?? 0) - (a.uses ?? 0) || a.name.localeCompare(b.name));
writeFileSync(OUT, `${JSON.stringify({ version: 1, providers: PROVIDERS, voices }, null, 1)}\n`);
console.log(`${voices.length} voices → ${OUT}`);
