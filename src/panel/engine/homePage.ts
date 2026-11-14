import type { PanelLayout, PanelPage } from '../types';
import { BLANK_PAGE_ID } from './panelLayoutOps';

/** Home is a page identity, never its position or the render-only blank page. */
export function resolveHomePage(layout: PanelLayout): PanelPage | undefined {
  return (layout.surface === 'y70' && layout.homePageId !== BLANK_PAGE_ID
    ? layout.pages.find(page => page.id === layout.homePageId)
    : undefined) ?? layout.pages[0];
}

/** Setting Home preserves the current selection and the complete page collection. */
export function setHomePage(layout: PanelLayout, pageId: string): PanelLayout {
  if (pageId === BLANK_PAGE_ID || !layout.pages.some(page => page.id === pageId)
    || layout.homePageId === pageId) return layout;
  return { ...layout, homePageId: pageId };
}
