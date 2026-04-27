const sessions = new Map();

function setSession(jid, data) {
  sessions.set(jid, {
    ...data,
    updatedAt: Date.now()
  });
}

function getSession(jid) {
  return sessions.get(jid);
}

function clearSession(jid) {
  sessions.delete(jid);
}

module.exports = { setSession, getSession, clearSession };