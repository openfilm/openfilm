// @ts-check
/**
 * For Studio's tests in a page: show a workbench as the person does. The top bar's one button names the workbench
 * shown; with two, a press shows the other (the edit and the canvas), with more it opens the menu of them, whose row
 * is pressed. Nothing when it is shown already.
 * @param {import('playwright-core').Page} page @param {string} name the workbench (`edit`, `canvas`, `screening`…)
 * @param {{ dispatch?: boolean }} [how] `dispatch`: pressed as an event, not by the pointer (a button under a loading
 *   surface)
 */
export async function showWorkbench(page, name, { dispatch = false } = {}) {
  const shown = page.locator(`[data-work-mode="${name}"]`);
  if (await shown.count()) return;
  const press = (/** @type {import('playwright-core').Locator} */ el) => (dispatch ? el.dispatchEvent('click') : el.click());
  await press(page.locator('[data-work-mode]'));
  const row = page.locator(`[data-mode-option="${name}"]`);
  await Promise.race([row.waitFor(), shown.waitFor()]);
  if (await row.count()) await press(row);
  await shown.waitFor();
}
