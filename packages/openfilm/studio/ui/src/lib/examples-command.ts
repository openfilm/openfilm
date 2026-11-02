/**
 * What the app's chat asks of the Community over the film (lib/host.ts StudioCommand `show-examples` and
 * `close-examples`): open (on a skill's or an example's page), and close — as "Add a skill" there keeps one, so the
 * person is back at the conversation the dialog opened over. Pure, so `node --test` runs it
 * (examples-command.test.ts).
 */
import type { CommunityItem } from './host';

/** The Community's state in a project's page: closed, or open (on an item's page when one was asked). */
export type ExamplesOpen = boolean | CommunityItem;

/** What a `show-examples` or `close-examples` command leaves the Community at. */
export function examplesOpenOf(command: { type: 'show-examples'; open?: CommunityItem } | { type: 'close-examples' }): ExamplesOpen {
  return command.type === 'close-examples' ? false : command.open ?? true;
}
