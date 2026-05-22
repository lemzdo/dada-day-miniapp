// ── 字典类型 ──

/** 分类树节点 */
export interface CategoryNode {
  key: string;
  label: string;
  children?: CategoryNode[];
}

/** 场景字典项 */
export interface SceneDictItem {
  key: string;
  label: string;
  icon?: string;
}

/** 风格字典项 */
export interface StyleDictItem {
  key: string;
  label: string;
  category?: string;
}
