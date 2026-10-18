/**
 * The rows of the chat's agent menu (ModelPopover), from the config options the agent reports. Reads no React, so
 * `node --test` can use it.
 */

export type MenuOption = {
  id: string;
  name: string;
  category?: string;
  options?: Array<{ value: unknown; name: string; description?: string }>;
  /** a row the agent offers no choice of: its one value, shown and never set */
  fixed?: boolean;
};

export const isSpeed = (o: MenuOption) => o.category === 'speed' || /^(fast|fast-mode|speed)$/i.test(o.id) || /\b(fast|speed)\b/i.test(o.name);

/**
 * The rows the menu shows, in this order: the model and the reasoning effort, always, and the speed when the model has
 * one. A model or an effort the agent offers no choice of (GitHub Copilot picks its own) is a row all the same, its one
 * value `fixed`: `defaultName` when the agent names none.
 */
export function menuOptions(options: MenuOption[] | undefined, defaultName: string): MenuOption[] {
  const pick = (test: (o: MenuOption) => boolean, least: number) => (options ?? []).find((o) => test(o) && (o.options?.length ?? 0) >= least);
  const always = (category: string, found: MenuOption | undefined): MenuOption => (found && found.options!.length > 1 ? found
    : { id: found?.id ?? category, name: found?.name ?? category, category, fixed: true, options: found?.options?.length ? found.options : [{ value: null, name: defaultName }] });
  const speed = pick(isSpeed, 2);
  return [always('model', pick((o) => o.category === 'model', 1)), always('thought_level', pick((o) => o.category === 'thought_level', 1)), ...(speed ? [speed] : [])];
}
