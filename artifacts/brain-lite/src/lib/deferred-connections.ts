// Browser-local preferences only: never persist memory content or suggestion payloads.
export const deferredConnectionsPrefix = 'brain-lite:connections:deferred:v1:';

export function deferredConnectionsKey(owner: string) {
  if (!owner) throw new Error('Authentication required');
  return `${deferredConnectionsPrefix}${encodeURIComponent(owner)}`;
}

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function readDeferredConnections(owner: string, storage: Pick<Storage, 'getItem'> = window.localStorage): number[] {
  const raw = storage.getItem(deferredConnectionsKey(owner));
  if (raw === null) return [];
  // Corrupt/obsolete data is not trusted, and can be replaced by the next successful write.
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter(validId))] : [];
  } catch {
    return [];
  }
}

export function saveDeferredConnection(owner: string, id: number, storage: Storage = window.localStorage): number[] {
  if (!validId(id)) throw new Error('Invalid connection ID');
  // Read the latest value, not a potentially stale tab/query snapshot.
  const ids = [...new Set([...readDeferredConnections(owner, storage), id])];
  storage.setItem(deferredConnectionsKey(owner), JSON.stringify(ids));
  return ids;
}

export function clearDeferredConnections(owner: string, storage: Pick<Storage, 'removeItem'> = window.localStorage): void {
  storage.removeItem(deferredConnectionsKey(owner));
}