import { createEmptyAppState, normalizeAppState } from './appState.js';

export function createAppStateService({ storage = null, onChange = null } = {}) {
  let currentState = storage?.readState() ?? createEmptyAppState();

  function emitChange(state, options = {}) {
    if (typeof onChange === 'function') {
      onChange(state, options);
    }
  }

  return {
    getState({ refresh = true } = {}) {
      if (refresh && storage) {
        currentState = storage.readState() ?? createEmptyAppState();
      }

      return currentState;
    },

    setState(nextState, options = {}) {
      currentState = storage ? storage.writeState(nextState) : normalizeAppState(nextState);
      emitChange(currentState, options);
      return currentState;
    },

    close() {
      storage?.close();
    },
  };
}
