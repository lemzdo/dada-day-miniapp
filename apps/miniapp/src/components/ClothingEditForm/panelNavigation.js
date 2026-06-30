const FIELD_BY_ROUTE = {
  category: 'category',
  subcategory: 'subcategory',
  colors: 'colors',
  material: 'material',
  thickness: 'thickness',
  styleTags: 'styleTags',
  seasonTags: 'seasonTags',
  sceneTags: 'sceneTags',
  addTag: 'customTags',
};

function createPanelSessionState() {
  return {
    active: true,
    route: { name: 'main' },
    mainScrollTop: 0,
    restoreScrollTop: 0,
    restoreToken: 0,
    tempValue: undefined,
  };
}

function updateMainScroll(state, scrollTop) {
  const nextTop = normalizeScrollTop(scrollTop, state.mainScrollTop);
  return {
    ...state,
    mainScrollTop: nextTop,
  };
}

function openPanelRoute(state, route, scrollTop, formValue) {
  const mainScrollTop = normalizeScrollTop(scrollTop, state.mainScrollTop);
  return {
    ...state,
    active: true,
    route: { ...route },
    mainScrollTop,
    tempValue: cloneValue(readRouteValue(route, formValue)),
  };
}

function confirmPanelRoute(state, formValue, selection) {
  const field = FIELD_BY_ROUTE[state.route.name];
  const nextState = returnToMain(state);
  if (!field) {
    return {
      state: nextState,
      formValue: { ...formValue },
    };
  }

  return {
    state: nextState,
    formValue: {
      ...formValue,
      [field]: cloneValue(selection),
    },
  };
}

function cancelPanelRoute(state) {
  return returnToMain(state);
}

function closePanelSession() {
  return {
    ...createPanelSessionState(),
    active: false,
  };
}

function returnToMain(state) {
  return {
    ...state,
    route: { name: 'main' },
    restoreScrollTop: normalizeScrollTop(state.mainScrollTop, 0),
    restoreToken: state.restoreToken + 1,
    tempValue: undefined,
  };
}

function readRouteValue(route, formValue) {
  const field = FIELD_BY_ROUTE[route.name];
  if (!field) return undefined;
  return formValue[field];
}

function cloneValue(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function normalizeScrollTop(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return normalizeScrollTop(fallback, 0);
  return Math.max(0, Math.floor(number));
}

module.exports = {
  cancelPanelRoute,
  closePanelSession,
  confirmPanelRoute,
  createPanelSessionState,
  openPanelRoute,
  updateMainScroll,
};
