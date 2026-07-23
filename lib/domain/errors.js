export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function domainError(code, message, details = {}) {
  return new DomainError(code, message, details);
}
