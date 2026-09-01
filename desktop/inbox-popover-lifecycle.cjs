function createInboxPopoverLifecycle() {
  let sequence = 0;
  let current = null;

  return {
    open() {
      const generation = ++sequence;
      current = generation;
      return generation;
    },
    close(generation) {
      if (generation !== undefined && generation !== null && current !== generation) return false;
      current = null;
      sequence += 1;
      return true;
    },
    isCurrent(generation) {
      return current === generation;
    },
  };
}

module.exports = { createInboxPopoverLifecycle };
