/** @type {{ at: string; result: object | null; error: string | null } | null} */
let lastSync = null;

export function recordSyncResult(result, error = null) {
  lastSync = {
    at: new Date().toISOString(),
    result: error ? null : result,
    error: error ? String(error) : null,
  };
}

export function getLastSyncResult() {
  return lastSync;
}
