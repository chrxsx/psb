export const sessions = new Map();
export const results = new Map();
export const eventHistory = new Map(); // Map<sessionId, Array<{type:string, data:any, ts:string}>>
export const sseClients = new Map(); // Map<sessionId, Set<ServerResponse>>

export function addEvent(sessionId, event) {
  const withTs = { ...event, ts: new Date().toISOString() };
  const arr = eventHistory.get(sessionId) || [];
  arr.push(withTs);
  eventHistory.set(sessionId, arr);
  broadcastToSse(sessionId, withTs);
}

export function addSseClient(sessionId, res) {
  let set = sseClients.get(sessionId);
  if (!set) {
    set = new Set();
    sseClients.set(sessionId, set);
  }
  set.add(res);
  // Replay history to the new client
  const hist = eventHistory.get(sessionId) || [];
  for (const ev of hist) {
    try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
  }
}

export function removeSseClient(sessionId, res) {
  const set = sseClients.get(sessionId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(sessionId);
}

export function broadcastToSse(sessionId, ev) {
  const set = sseClients.get(sessionId);
  if (!set || set.size === 0) return;
  for (const res of set) {
    try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
  }
}