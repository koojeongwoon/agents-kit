import {domainError} from '../domain/errors.js';
const contents = new WeakMap();
export const rememberNativeContent = (operation, content) => contents.set(operation, content);
export function nativeInstallationContent(operation) {
  if (!contents.has(operation)) throw domainError('NATIVE_CONTENT_NOT_PREPARED', 'Use the original reviewed installation plan');
  return contents.get(operation);
}
