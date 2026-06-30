import type { ClothingEditFormValue } from './index';

export type ClothingEditPanelRoute =
  | { name: 'main' }
  | { name: 'category' }
  | { name: 'subcategory' }
  | { name: 'colors' }
  | { name: 'material' }
  | { name: 'thickness' }
  | { name: 'styleTags' }
  | { name: 'seasonTags' }
  | { name: 'sceneTags' }
  | { name: 'addTag' };

export interface ClothingEditPanelSessionState {
  active: boolean;
  route: ClothingEditPanelRoute;
  mainScrollTop: number;
  restoreScrollTop: number;
  restoreToken: number;
  tempValue?: unknown;
}

export function createPanelSessionState(): ClothingEditPanelSessionState;
export function updateMainScroll(
  state: ClothingEditPanelSessionState,
  scrollTop: number,
): ClothingEditPanelSessionState;
export function openPanelRoute(
  state: ClothingEditPanelSessionState,
  route: ClothingEditPanelRoute,
  scrollTop: number,
  formValue: ClothingEditFormValue,
): ClothingEditPanelSessionState;
export function confirmPanelRoute(
  state: ClothingEditPanelSessionState,
  formValue: ClothingEditFormValue,
  selection: unknown,
): { state: ClothingEditPanelSessionState; formValue: ClothingEditFormValue };
export function cancelPanelRoute(state: ClothingEditPanelSessionState): ClothingEditPanelSessionState;
export function closePanelSession(): ClothingEditPanelSessionState;
