export type XiaodaProductState =
  | 'loading'
  | 'empty'
  | 'exhausted'
  | 'stale_waiting'
  | 'retry'
  | 'error_neutral'
  | 'refreshing';

export const PRODUCT_STATE_COPY: Readonly<Record<XiaodaProductState, string>>;
export function getProductStateCopy(
  state: XiaodaProductState | string | null | undefined,
): string;
