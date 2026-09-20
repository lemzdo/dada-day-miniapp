export interface LocalStorageDiagnostic {
  event: string;
  namespace: string;
  detail: unknown;
  at: number;
}

const MAX_DIAGNOSTICS = 50;
const diagnostics: LocalStorageDiagnostic[] = [];

export function recordLocalStorageDiagnostic(event: LocalStorageDiagnostic) {
  diagnostics.push(event);
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
  }
}

export function getLocalStorageDiagnostics(): readonly LocalStorageDiagnostic[] {
  return diagnostics.slice();
}

export function clearLocalStorageDiagnostics() {
  diagnostics.length = 0;
}
