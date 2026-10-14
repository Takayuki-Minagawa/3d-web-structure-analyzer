interface LoadTargetActions {
  setActiveLoadCase: (id: string) => void;
  setActiveLoadCombination: (id: string | null) => void;
}

/** Decode only the UI prefix: imported target IDs may themselves contain colons. */
export function selectLoadTarget(value: string, actions: LoadTargetActions): void {
  if (value.startsWith('case:')) {
    const id = value.slice('case:'.length);
    if (id) actions.setActiveLoadCase(id);
  } else if (value.startsWith('combo:')) {
    const id = value.slice('combo:'.length);
    if (id) actions.setActiveLoadCombination(id);
  }
}
