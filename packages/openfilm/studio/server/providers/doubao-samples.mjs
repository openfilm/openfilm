// @ts-check
/** Static recordings published by Volcengine and BytePlus for their stock TTS voices. */
export const DOUBAO_SAMPLES = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/portal/bigtts/';

/** @param {string} source */
export function doubaoSampleUrl(source) {
  if (source.startsWith(DOUBAO_SAMPLES) && /^[\w-]+\.(?:mp3|wav)$/.test(source.slice(DOUBAO_SAMPLES.length))) return source;
  if (/^https:\/\/sf-bpcms\.bytepluscdn\.com\/obj\/byteplus-public-aiso\/cloud-universal-doc\/[\w-]+\.(?:mp3|wav)$/.test(source)) return source;
  return null;
}
