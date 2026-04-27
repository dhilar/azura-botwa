const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const P = require("pino");
const config = require("./config");

const { loadDB, saveDB } = require("./lib/db");
const { getText, rupiah, isGroupAdmin, ensureGroup, safeDelete } = require("./lib/msg");
const { cancelOrder, latestPendingOrderByBuyer } = require("./lib/order");

const userHandler = require("./commands/user");
const ownerHandler = require("./commands/owner");

loadDB();

// 🔥 OWNER FIX FINAL
function isOwner(senderJid) {
  const raw = String(senderJid || "");
  const cleanJid = raw.replace(/:\d+@/, "@");
  const number = cleanJid.split("@")[0].replace(/\D/g, "");

  return (
    config.ownerJids.includes(raw) ||
    config.ownerJids.includes(cleanJid) ||
    config.ownerNumbers.includes(number) ||
    config.ownerNumbers.some(n => number.endsWith(n) || n.endsWith(number))
  );
}

function ownerJids() {
  return config.ownerNumbers.map(n => `${n}@s.whatsapp.net`);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    browser: [config.botName, "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // =========================
  // GROUP PARTICIPANTS (Welcome/Goodbye)
  // =========================
  sock.ev.on("group-participants.update", async (anu) => {
    try {
      const { id, participants, action } = anu;
      const db = loadDB();
      const group = ensureGroup(db, id);
      
      // Get metadata, if fails bot won't crash
      let metadata;
      try {
        metadata = await sock.groupMetadata(id);
      } catch {
        return;
      }

      for (const user of participants) {
        let text = "";
        if (action === "add" && group.welcome.enabled) {
          text = group.welcome.text;
        } else if (action === "remove" && group.goodbye.enabled) {
          text = group.goodbye.text;
        }

        if (text) {
          text = text
            .replace("@user", `@${user.split("@")[0]}`)
            .replace("@group", metadata.subject || "Grup")
            .replace("@desc", metadata.desc?.toString() || "");
          
          await sock.sendMessage(id, {
            text,
            mentions: [user]
          });
        }
      }
    } catch (err) {
      console.error("EVENT PARTICIPANTS ERROR:", err);
    }
  });

  // =========================
  // CONNECTION
  // =========================
  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log("\nSCAN QR:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ BOT ONLINE");
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;

      console.log("❌ CONNECTION CLOSED:", code);

      if (reconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("⚠️ HAPUS SESSION & SCAN ULANG");
      }
    }
  });

  // =========================
  // AUTO CANCEL
  // =========================
  setInterval(() => {
    const db = loadDB();
    const now = new Date();

    for (const order of db.orders) {
      if (order.status === "pending" && new Date(order.expiresAt) < now) {
        cancelOrder(order, "Expired");
        console.log("AUTO CANCEL:", order.invoice);
      }
    }

    saveDB();
  }, 60000);

  // =========================
  // MESSAGE
  // =========================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const m = messages[0];
    if (!m?.message) return;
    if (m.key.fromMe) return;

    const from = m.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const senderJid = isGroup ? (m.key.participant || m.participant || from) : from;
    
    if (!senderJid) return; // safety check

    const senderNumber = senderJid.split("@")[0].split(":")[0];
    const pushName = m.pushName || "Customer";

    const text = getText(m.message).trim();
    const hasImage = !!m.message.imageMessage;

    const owner = isOwner(senderJid);

    try {
      const db = loadDB();

      // --- Passive Moderation (Group Only) ---
      if (isGroup) {
        const group = ensureGroup(db, from);
        const isAdmin = owner || await isGroupAdmin(sock, from, senderJid);

        // 1. Auto Mute
        if (!isAdmin && group.mutedUsers.includes(senderJid)) {
          return safeDelete(sock, from, m.key);
        }

        // 2. Anti Link
        if (!isAdmin && group.antilink) {
          const linkPattern = /chat.whatsapp.com|wa.me|t.me|http:\/\/|https:\/\//i;
          if (linkPattern.test(text)) {
            await safeDelete(sock, from, m.key);
            
            // Warnings
            group.warnings[senderJid] = (group.warnings[senderJid] || 0) + 1;
            const count = group.warnings[senderJid];
            saveDB();

            if (count >= 3) {
              const botAdmin = await isGroupAdmin(sock, from, sock.user.id.replace(/:.*@/, "@"));
              if (!botAdmin) {
                return sock.sendMessage(from, { text: `⚠️ @${senderNumber} melanggar aturan link 3x. Bot tidak bisa kick karena bukan admin.`, mentions: [senderJid] });
              }
              await sock.sendMessage(from, { text: `⚠️ @${senderNumber} dikeluarkan karena melanggar aturan link 3x.`, mentions: [senderJid] });
              delete group.warnings[senderJid];
              saveDB();
              return sock.groupParticipantsUpdate(from, [senderJid], "remove");
            } else {
              return sock.sendMessage(from, { text: `⚠️ @${senderNumber} Link/promosi dilarang. Peringatan ${count}/3.`, mentions: [senderJid] });
            }
          }
        }
      }

      if (hasImage) {
        const order = latestPendingOrderByBuyer(senderJid);
        if (order) {
          const stream = await downloadContentFromMessage(m.message.imageMessage, "image");
          let buffer = Buffer.from([]);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }

          const caption = `📥 *BUKTI BAYAR MASUK*\n\n` +
            `Invoice: ${order.invoice}\n` +
            `Pembeli: ${pushName} (${senderNumber})\n` +
            `Produk: ${order.variantName}\n` +
            `Total: *${rupiah(order.total)}*\n\n` +
            `Reply bukti ini dengan:\n` +
            `#p detail_produk\n\n` +
            `Atau:\n#p ${order.invoiceNumber} detail_produk`;

          for (const ownerJid of ownerJids()) {
            const sent = await sock.sendMessage(ownerJid, {
              image: buffer,
              caption: caption
            });

            // Map owner's message ID to invoice for easy reply processing
            const db = loadDB();
            db.proofMap[sent.key.id] = order.invoice;
            saveDB();
          }
        }
      }

      if (text.startsWith("#")) {
        const parts = text.slice(1).trim().split(/\s+/);
        const cmd = (parts[0] || "").toLowerCase();

        // Auto delete command messages
        if (isGroup) {
          const group = ensureGroup(db, from);
          const isAdmin = owner || await isGroupAdmin(sock, from, senderJid);
          if (isAdmin && group.autodelete) {
            safeDelete(sock, from, m.key);
          }
        }

        return ownerHandler(sock, m, {
          from,
          senderJid,
          senderNumber,
          pushName,
          text,
          isOwner: owner,
          args: {
            cmd,
            list: parts.slice(1)
          }
        });
      }

      return userHandler(sock, m, {
        from,
        senderJid,
        senderNumber,
        pushName,
        text,
        hasImage,
        ownerJids: ownerJids()
      });

    } catch (err) {
      console.error("ERROR:", err);
      await sock.sendMessage(from, {
        text: "⚠️ Error, coba lagi."
      }, { quoted: m });
    }
  });
}

startBot();