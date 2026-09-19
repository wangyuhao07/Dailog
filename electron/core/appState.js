export const MAX_AI_DEBUG_ENTRIES = 8;

export function createEmptyAppState() {
  return {
    months: [],
    settings: null,
    aiDebugEntries: [],
  };
}

export function normalizeAppState(state) {
  return {
    months: Array.isArray(state?.months) ? state.months : [],
    settings: state?.settings ?? null,
    aiDebugEntries: Array.isArray(state?.aiDebugEntries)
      ? state.aiDebugEntries.filter(Boolean).slice(0, MAX_AI_DEBUG_ENTRIES)
      : [],
  };
}
