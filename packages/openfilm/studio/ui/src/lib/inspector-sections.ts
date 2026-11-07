/** The inspector's categories follow the controls that the selected object actually offers. */
export type InspectorTab = 'text' | 'wordart' | 'motion' | 'properties' | 'adjust' | 'effects' | 'sound' | 'advanced' | 'info';
export type InspectorKind = 'film' | 'video' | 'image' | 'audio' | 'page' | 'text' | 'caption' | 'layer' | 'multiple' | 'transition';

/* a line of words made with the library's text component has its own three first (TextInspector) */
export const INSPECTOR_TAB_ORDER: readonly InspectorTab[] = ['text', 'wordart', 'motion', 'properties', 'adjust', 'effects', 'sound', 'advanced', 'info'];

const categories: Readonly<Record<string, InspectorTab>> = {
  text: 'text',
  wordart: 'wordart',
  motion: 'motion',
  adjust: 'adjust',
  filter: 'adjust',
  effects: 'effects',
  mask: 'effects',
  sound: 'sound',
  advanced: 'advanced',
  source: 'advanced',
  'page-changes': 'advanced',
  'export-motion-blur': 'advanced',
  'advanced-properties': 'advanced',
  'film-info': 'info',
};

export function inspectorTabForSection(id: string): InspectorTab {
  return categories[id] ?? 'properties';
}

/* any other clip's animation comes after its properties (ClipMotionSection), so a clip opens on its properties */
const CLIP_TAB_ORDER: readonly InspectorTab[] = ['properties', 'motion', 'adjust', 'effects', 'sound', 'advanced', 'info'];

export function inspectorTabs(ids: readonly string[]): InspectorTab[] {
  const available = new Set(ids.map(inspectorTabForSection));
  return (available.has('text') ? INSPECTOR_TAB_ORDER : CLIP_TAB_ORDER).filter((tab) => available.has(tab));
}

/** A remembered category may not exist on the next selection, such as a silent still after a video. */
export function inspectorActiveTab(preferred: InspectorTab, available: readonly InspectorTab[]): InspectorTab {
  return available.includes(preferred) ? preferred : available[0] ?? 'properties';
}

/** Hidden categories and folded groups must never receive the number fields' custom Tab navigation. */
export function inspectorFieldVisible(element: { closest: (selector: string) => unknown }): boolean {
  return !element.closest('[hidden], [data-inspector-folded="true"]');
}
