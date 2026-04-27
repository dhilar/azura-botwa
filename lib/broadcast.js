const { loadDB, saveDB } = require("./db");
const { reply } = require("./msg");

async function broadcast(sock, jidList, message, delayRange = [10000, 20000]) {
  const db = loadDB();
  let success = 0;
  let fail = 0;

  for (const jid of jidList) {
    const user = db.users[jid] || {};
    if (user.optOutBroadcast) {
      continue;
    }

    try {
      await sock.sendMessage(jid, { text: message });
      success++;
    } catch (err) {
      console.error(`Broadcast failed for ${jid}:`, err);
      fail++;
    }

    // Delay
    const delay = Math.floor(Math.random() * (delayRange[1] - delayRange[0] + 1)) + delayRange[0];
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  const log = {
    date: new Date().toISOString(),
    message,
    success,
    fail,
    total: jidList.length
  };

  db.broadcastLog.push(log);
  saveDB();

  return log;
}

function canBroadcastToday() {
  const db = loadDB();
  const today = new Date().toISOString().split("T")[0];
  const todayLogs = db.broadcastLog.filter(log => log.date.split("T")[0] === today);
  return todayLogs.length < 2;
}

module.exports = { broadcast, canBroadcastToday };
