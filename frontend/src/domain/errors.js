export class DomainRuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainRuleError";
    this.code = code;
    this.details = details;
  }
}

export function assertDomain(condition, code, message, details) {
  if (!condition) {
    throw new DomainRuleError(code, message, details);
  }
}
