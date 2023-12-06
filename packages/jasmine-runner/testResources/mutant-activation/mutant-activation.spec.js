describe('mutant-activation', () => {
  function getActiveMutants() {
    if (globalThis.__stryker2__ && globalThis.__stryker2__.activeMutants) {
      return [...globalThis.__stryker2__.activeMutants];
    }
    return null;
  }
  const staticActiveMutants = getActiveMutants();

  it('should report active mutants', () => {
    const runtimeActiveMutants = getActiveMutants();
    throw new Error(JSON.stringify({ staticActiveMutants, runtimeActiveMutants }));
  });
});
