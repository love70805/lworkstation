import { computeDerived } from './derivedComputations';
self.onmessage = ({ data: { kind, input } }) => {
  try { self.postMessage({ value: computeDerived(kind, input) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
