function getText(message) {
  if (!message) return "";

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;

  return "";
}

function reply(sock, jid, text, quoted) {
  return sock.sendMessage(jid, { text }, { quoted });
}

function rupiah(number) {
  return "Rp " + Number(number || 0).toLocaleString("id-ID");
}

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function isGroupAdmin(sock, groupJid, userJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const participant = metadata.participants.find(p => p.id === userJid);
    return participant && (participant.admin === "admin" || participant.admin === "superadmin");
  } catch {
    return false;
  }
}

function getMentionedOrQuotedTarget(m) {
  let target = null;
  if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
    target = m.message.extendedTextMessage.contextInfo.mentionedJid[0];
  } else if (m.message?.extendedTextMessage?.contextInfo?.participant) {
    target = m.message.extendedTextMessage.contextInfo.participant;
  }
  return target;
}

function ensureGroup(db, groupJid) {
  if (!db.groups[groupJid]) {
    db.groups[groupJid] = {
      antilink: false,
      autodelete: false,
      welcome: {
        enabled: false,
        text: "Selamat datang @user di grup @group!",
      },
      goodbye: {
        enabled: false,
        text: "Selamat jalan @user!",
      },
      mutedUsers: [],
      warnings: {}
    };
  }
  // Migrations for existing groups
  if (!db.groups[groupJid].welcome) {
    db.groups[groupJid].welcome = { enabled: false, text: "Selamat datang @user di grup @group!" };
  }
  if (!db.groups[groupJid].goodbye) {
    db.groups[groupJid].goodbye = { enabled: false, text: "Selamat jalan @user!" };
  }
  return db.groups[groupJid];
}

async function safeDelete(sock, from, key) {
  try {
    await sock.sendMessage(from, { delete: key });
  } catch (err) {
    console.error("SAFE DELETE ERROR:", err);
  }
}

module.exports = {
  getText,
  reply,
  rupiah,
  normalize,
  isGroupAdmin,
  getMentionedOrQuotedTarget,
  ensureGroup,
  safeDelete
};