/** The OpenFilm model menu's default order. Provider routing remains on the cloud. */
export const OPENFILM_MODELS = Object.freeze([
  { id: 'anthropic/claude-fable-5.2', name: 'Claude Fable 5.2' },
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5' },
  { id: 'openai/gpt-6.2-astra', name: 'GPT-6.2 Astra' },
  { id: 'openai/gpt-6.2-sol', name: 'GPT-6.2 Sol' },
  { id: 'openai/gpt-6.1-terra', name: 'GPT-6.1 Terra' },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna' },
  { id: 'google/gemini-4-carbon', name: 'Gemini 4 Carbon' },
  { id: 'tencent/hy4-flash', name: 'Hy4 Flash' },
  { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash' },
]);

/** Keep menu preferences independently of the current cloud catalog, including models added after this app shipped. */
export function modelPreferences(raw) {
  const valid = (list) => [...new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id && id.length <= 1000) : [])];
  return { order: valid(raw?.order), hidden: valid(raw?.hidden) };
}

/** The current catalog is authoritative; defaults only order models the cloud still offers. */
export function orderedModels(models, preferences = {}, idOf = (m) => m.id) {
  const { order, hidden } = modelPreferences(preferences);
  const ids = [...new Set([...order, ...OPENFILM_MODELS.map((m) => m.id), ...models.map(idOf)])];
  return ids.filter((id) => !hidden.includes(id)).flatMap((id) => {
    const model = models.find((m) => idOf(m) === id);
    if (!model) return [];
    return [model];
  });
}
