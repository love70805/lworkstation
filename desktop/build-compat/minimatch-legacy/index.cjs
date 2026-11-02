// Retain the callable pre-v6 CommonJS API for asar/glob/dir-compare.
// All matching and parsing use the patched upstream implementation.
function callable(api) {
  const match = typeof api === 'function' ? api : api.minimatch;
  const legacy = Object.assign((...args) => match(...args), api);
  // glob 7 inspects each parsed portion and uses String.match(). v11
  // exposes nonrecursive Matchers instead of RegExp portions.
  legacy.Minimatch = class extends api.Minimatch {
    constructor(...args) {
      super(...args);
      for (const row of this.set) for (const portion of row) {
        if (portion && typeof portion === 'object' && typeof portion.test === 'function' && portion._glob === undefined) {
          portion._glob = portion.pattern;
          portion[Symbol.match] = value => portion.test(value) ? [value] : null;
        }
      }
    }
  };
  legacy.defaults = options => callable(api.defaults(options));
  return legacy;
}
module.exports = callable(require('minimatch'));
