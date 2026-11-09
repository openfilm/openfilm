/** The OpenFilm model menu's default order. Provider routing remains on the cloud. */
export const OPENFILM_MODELS = Object.freeze([
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5' },
  { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  { id: 'openai/gpt-6.1-terra', name: 'GPT-6.1 Terra' },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna' },
  { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash' },
]);

/** Known ids, once each, followed by new defaults; unknown entries from older clients are discarded. */
export function modelPreferences(raw) {
  const ids = OPENFILM_MODELS.map((m) => m.id);
  const known = (list) => Array.isArray(list) ? list.filter((id) => ids.includes(id)) : [];
  const order = [...new Set([...known(raw?.order), ...ids])];
  const hidden = [...new Set(known(raw?.hidden))];
  return { order, hidden: hidden.length === ids.length ? [] : hidden };
}

/** Filter and sort a catalog or cached ACP menu, so legacy model lists cannot reappear. */
export function orderedModels(models, preferences = {}, idOf = (m) => m.id) {
  const { order, hidden } = modelPreferences(preferences);
  return order.filter((id) => !hidden.includes(id)).flatMap((id) => {
    const model = models.find((m) => idOf(m) === id);
    if (!model) return [];
    const name = OPENFILM_MODELS.find((m) => m.id === id).name;
    return [{ ...model, name }];
  });
}
