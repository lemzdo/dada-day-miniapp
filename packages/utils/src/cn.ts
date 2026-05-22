/** 合并 class 名称 */
export function cn(...inputs: (string | number | bigint | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ');
}
