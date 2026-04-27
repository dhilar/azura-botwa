const { loadDB, saveDB } = require("../lib/db");
const {
  findOrder,
  latestPendingOrderByBuyer,
  completeOrder,
  cancelOrder,
  refundOrder,
  getRekap,
  formatSuccess
} = require("../lib/order");
const {
  addProduct,
  addVariant,
  editVariant,
  deleteProduct,
  deleteVariant,
  listProducts
} = require("../lib/product");
const { broadcast, canBroadcastToday } = require("../lib/broadcast");
const os = require("os");
const {
  reply,
  rupiah,
  getMentionedOrQuotedTarget,
  isGroupAdmin,
  ensureGroup
} = require("../lib/msg");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

async function ownerHandler(sock, m, context) {
  const { from, senderJid, text, args, isOwner, isGroup } = context;

  // Reusable permission check
  const isAdmin = isOwner || (isGroup && await isGroupAdmin(sock, from, senderJid));

  if (!isAdmin) {
    return reply(sock, from, "❌ Khusus owner/admin.", m);
  }

  const cmd = args.cmd;

  try {
    // --- FAQ Management ---
    if (cmd === "addfaq") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const [keyword, answer] = args.list.join(" ").split("|");
      if (!keyword || !answer) return reply(sock, from, "Contoh: #addfaq garansi|Garansi 7 hari", m);
      const db = loadDB();
      db.faq[keyword.toLowerCase().trim()] = answer.trim();
      saveDB();
      return reply(sock, from, `✅ FAQ '${keyword}' berhasil ditambah.`, m);
    }

    if (cmd === "editfaq") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const [keyword, answer] = args.list.join(" ").split("|");
      if (!keyword || !answer) return reply(sock, from, "Contoh: #editfaq garansi|Garansi baru", m);
      const db = loadDB();
      if (!db.faq[keyword.toLowerCase().trim()]) return reply(sock, from, "❌ FAQ tidak ditemukan.", m);
      db.faq[keyword.toLowerCase().trim()] = answer.trim();
      saveDB();
      return reply(sock, from, `✅ FAQ '${keyword}' berhasil diupdate.`, m);
    }

    if (cmd === "delfaq") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const keyword = args.list[0]?.toLowerCase().trim();
      if (!keyword) return reply(sock, from, "Contoh: #delfaq garansi", m);
      const db = loadDB();
      if (!db.faq[keyword]) return reply(sock, from, "❌ FAQ tidak ditemukan.", m);
      delete db.faq[keyword];
      saveDB();
      return reply(sock, from, `✅ FAQ '${keyword}' dihapus.`, m);
    }

    if (cmd === "listfaq") {
      const db = loadDB();
      const keys = Object.keys(db.faq);
      if (!keys.length) return reply(sock, from, "📭 FAQ kosong.", m);
      return reply(sock, from, `📑 *DAFTAR FAQ*\n\n${keys.map(k => `• ${k}`).join("\n")}`, m);
    }

    // --- Group Moderation ---
    if (isGroup) {
      const db = loadDB();
      const group = ensureGroup(db, from);

      // Check if bot is admin for moderation commands
      const moderationCmds = ["open", "close", "kick", "mute", "unmute", "antilink", "autodelete", "welcome", "goodbye", "setwelcome", "setleft"];
      if (moderationCmds.includes(cmd)) {
        const botAdmin = await isGroupAdmin(sock, from, sock.user.id);
        if (!botAdmin) return reply(sock, from, "❌ Bot harus jadi admin untuk fitur ini.", m);
      }

      if (cmd === "open" || cmd === "close") {
        try {
          await sock.groupSettingUpdate(from, cmd === "open" ? "not_announcement" : "announcement");
          return reply(sock, from, `✅ Grup berhasil di-${cmd === "open" ? "buka" : "tutup"}.`, m);
        } catch (e) {
          return reply(sock, from, `❌ Gagal: ${e.message}`, m);
        }
      }

      if (cmd === "welcome") {
        const mode = args.list[0];
        if (mode === "on") group.welcome.enabled = true;
        else if (mode === "off") group.welcome.enabled = false;
        else return reply(sock, from, "Gunakan: #welcome on/off", m);
        saveDB();
        return reply(sock, from, `✅ Welcome message: ${group.welcome.enabled ? "ON" : "OFF"}`, m);
      }

      if (cmd === "goodbye") {
        const mode = args.list[0];
        if (mode === "on") group.goodbye.enabled = true;
        else if (mode === "off") group.goodbye.enabled = false;
        else return reply(sock, from, "Gunakan: #goodbye on/off", m);
        saveDB();
        return reply(sock, from, `✅ Goodbye message: ${group.goodbye.enabled ? "ON" : "OFF"}`, m);
      }

      if (cmd === "setwelcome") {
        const text = args.list.join(" ");
        if (!text) return reply(sock, from, "Contoh: #setwelcome Selamat datang @user!", m);
        group.welcome.text = text;
        saveDB();
        return reply(sock, from, "✅ Teks welcome diupdate.", m);
      }

      if (cmd === "setleft") {
        const text = args.list.join(" ");
        if (!text) return reply(sock, from, "Contoh: #setleft Selamat jalan @user!", m);
        group.goodbye.text = text;
        saveDB();
        return reply(sock, from, "✅ Teks goodbye diupdate.", m);
      }

      if (cmd === "kick") {
        const target = getMentionedOrQuotedTarget(m);
        if (!target) return reply(sock, from, "❌ Tag atau reply user yang mau di-kick.", m);
        
        // Safety check
        const metadata = await sock.groupMetadata(from);
        const cleanTarget = target.split("@")[0].split(":")[0];
        
        const participant = metadata.participants.find(p => {
          const pId = p.id.split("@")[0].split(":")[0];
          return p.id === target || pId === cleanTarget;
        });

        if (participant?.admin || config.ownerNumbers.includes(cleanTarget)) {
          return reply(sock, from, "❌ Tidak bisa kick owner/admin.", m);
        }

        await sock.groupParticipantsUpdate(from, [target], "remove");
        return reply(sock, from, "✅ User berhasil dikeluarkan.", m);
      }

      if (cmd === "mute") {
        const target = getMentionedOrQuotedTarget(m);
        if (!target) return reply(sock, from, "❌ Tag atau reply user yang mau di-mute.", m);
        if (target.includes(config.ownerNumber)) return reply(sock, from, "❌ Tidak bisa mute owner.", m);
        
        if (!group.mutedUsers.includes(target)) {
          group.mutedUsers.push(target);
          saveDB();
        }
        return reply(sock, from, "✅ User berhasil di-mute.", m);
      }

      if (cmd === "unmute") {
        const target = getMentionedOrQuotedTarget(m);
        if (!target) return reply(sock, from, "❌ Tag atau reply user yang mau di-unmute.", m);
        group.mutedUsers = group.mutedUsers.filter(u => u !== target);
        saveDB();
        return reply(sock, from, "✅ User berhasil di-unmute.", m);
      }

      if (cmd === "mutelist") {
        if (!group.mutedUsers.length) return reply(sock, from, "📭 Tidak ada user di-mute.", m);
        return reply(sock, from, `🔇 *DAFTAR MUTE*\n\n${group.mutedUsers.map(u => `• @${u.split("@")[0]}`).join("\n")}`, { mentions: group.mutedUsers });
      }

      if (cmd === "antilink") {
        const mode = args.list[0];
        if (mode === "on") group.antilink = true;
        else if (mode === "off") group.antilink = false;
        else return reply(sock, from, "Gunakan: #antilink on/off", m);
        saveDB();
        return reply(sock, from, `✅ Anti-link: ${group.antilink ? "ON" : "OFF"}`, m);
      }

      if (cmd === "autodelete") {
        const mode = args.list[0];
        if (mode === "on") group.autodelete = true;
        else if (mode === "off") group.autodelete = false;
        else return reply(sock, from, "Gunakan: #autodelete on/off", m);
        saveDB();
        return reply(sock, from, `✅ Auto-delete command: ${group.autodelete ? "ON" : "OFF"}`, m);
      }

      if (cmd === "warns") {
        const entries = Object.entries(group.warnings);
        if (!entries.length) return reply(sock, from, "📭 Tidak ada peringatan.", m);
        const out = entries.map(([u, c]) => `• @${u.split("@")[0]}: ${c}/3`).join("\n");
        return reply(sock, from, `⚠️ *DAFTAR PERINGATAN*\n\n${out}`, { mentions: entries.map(e => e[0]) });
      }

      if (cmd === "resetwarn") {
        const target = getMentionedOrQuotedTarget(m);
        if (!target) return reply(sock, from, "❌ Tag atau reply user.", m);
        delete group.warnings[target];
        saveDB();
        return reply(sock, from, "✅ Peringatan user di-reset.", m);
      }

      if (cmd === "groupsetting") {
        return reply(sock, from, `
⚙️ *GROUP SETTING*

Anti-link: ${group.antilink ? "✅" : "❌"}
Auto-delete Cmd: ${group.autodelete ? "✅" : "❌"}
Welcome: ${group.welcome.enabled ? "✅" : "❌"}
Goodbye: ${group.goodbye.enabled ? "✅" : "❌"}
Muted Users: ${group.mutedUsers.length}
Total Warnings: ${Object.keys(group.warnings).length}
`.trim(), m);
      }

      // --- Promotions ---
      if (cmd === "tagall") {
        const metadata = await sock.groupMetadata(from);
        const participants = metadata.participants.map(p => p.id);
        const message = args.list.join(" ") || "Tag All";
        const out = `📣 *TAG ALL*\n\n${message}\n\n${participants.map(p => `@${p.split("@")[0]}`).join(" ")}`;
        return sock.sendMessage(from, { text: out, mentions: participants });
      }

      if (cmd === "hta" || cmd === "hidetag") {
        const metadata = await sock.groupMetadata(from);
        const participants = metadata.participants.map(p => p.id);
        const message = args.list.join(" ");
        if (!message) return reply(sock, from, "Contoh: #hta Promo hari ini", m);
        return sock.sendMessage(from, { text: message, mentions: participants });
      }

      if (cmd === "promo" || cmd === "promotag") {
        const metadata = await sock.groupMetadata(from);
        const participants = cmd === "promotag" ? metadata.participants.map(p => p.id) : [];
        const message = args.list.join(" ");
        if (!message) return reply(sock, from, "Contoh: #promo Diskon Netflix", m);
        const out = `📢 *PROMO*\n\n${message}\n\nKetik *menu* untuk order.`;
        return sock.sendMessage(from, { text: out, mentions: participants });
      }
    }

    // --- Original Commands ---
    if (cmd === "orders") {
      const db = loadDB();
      const type = args.list[0]; // all, success, or pending (default)
      
      let filtered = [];
      let title = "ORDER PENDING";

      if (type === "all") {
        filtered = db.orders.slice(-20).reverse();
        title = "20 ORDER TERAKHIR";
      } else if (type === "success") {
        const stats = getRekap("hari");
        filtered = db.orders.filter(o => o.status === "success" && o.createdAt.startsWith(new Date().toISOString().split("T")[0])).slice(-20).reverse();
        title = "ORDER SUKSES HARI INI";
      } else {
        filtered = db.orders.filter(o => ["pending", "payment_uploaded"].includes(o.status));
      }

      if (!filtered.length) return reply(sock, from, `📭 Tidak ada order ${type || "pending"}.`, m);

      const out = filtered.map(o =>
        `• ${o.invoice} | ${o.buyerName}\n  ${o.variantName}\n  ${rupiah(o.total)} | ${o.status}`
      ).join("\n\n");

      return reply(sock, from, `📦 *${title}*\n\n${out}`, m);
    }

    if (cmd === "p" || cmd === "done") {
      let order = null;
      let note = "";

      const first = args.list[0];

      // Check if replying to a proof map entry
      const quoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
      const db = loadDB();
      if (quoted && db.proofMap[quoted]) {
        order = findOrder(db.proofMap[quoted]);
        note = args.list.join(" ");
      } else if (first && /^\d+$|^inv-/i.test(first)) {
        order = findOrder(first);
        note = args.list.slice(1).join(" ");
      } else {
        const quotedBuyer = getMentionedOrQuotedTarget(m);
        if (quotedBuyer) order = latestPendingOrderByBuyer(quotedBuyer);
        note = args.list.join(" ");
      }

      if (!order) {
        return reply(sock, from, "❌ Order tidak ditemukan. Pakai: #p 1 detail atau reply bukti bayar dengan #p detail", m);
      }

      completeOrder(order, note);

      await sock.sendMessage(order.buyerJid, {
        text: formatSuccess(order)
      });

      return reply(sock, from, `✅ ${order.invoice} selesai dan dikirim ke pembeli.`, m);
    }

    if (cmd === "c" || cmd === "cancel") {
      const first = args.list[0];
      if (!first) return reply(sock, from, "Contoh: #c 1", m);

      const order = findOrder(first);
      if (!order) return reply(sock, from, "❌ Order tidak ditemukan.", m);

      if (cancelOrder(order, "Cancelled by owner")) {
        await sock.sendMessage(order.buyerJid, {
          text: `❌ Order *${order.invoice}* dibatalkan.`
        });
        return reply(sock, from, `✅ ${order.invoice} dibatalkan.`, m);
      }
      return reply(sock, from, "❌ Gagal membatalkan order (mungkin sudah sukses/batal).", m);
    }

    if (cmd === "refund") {
      const first = args.list[0];
      if (!first) return reply(sock, from, "Contoh: #refund 1", m);

      const order = findOrder(first);
      if (!order) return reply(sock, from, "❌ Order tidak ditemukan.", m);

      if (refundOrder(order, "Refunded by owner")) {
        await sock.sendMessage(order.buyerJid, {
          text: `⚠️ Order *${order.invoice}* telah di-refund.`
        });
        return reply(sock, from, `✅ ${order.invoice} berhasil di-refund.`, m);
      }
      return reply(sock, from, "❌ Gagal refund order (harus berstatus success).", m);
    }

    // Product Management
    if (cmd === "addproduk") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const name = args.list.join(" ");
      if (!name) return reply(sock, from, "Contoh: #addproduk Netflix", m);
      const { product, error } = addProduct(name);
      if (error) return reply(sock, from, `❌ ${error}`, m);
      return reply(sock, from, `✅ Produk berhasil ditambah:\nKey: ${product.key}\nNama: ${product.name}`, m);
    }

    if (cmd === "addvarian") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const raw = args.list.join(" ");
      const [productKey, ...rest] = raw.split(" ");
      const [name, price, stock, description] = rest.join(" ").split("|");

      if (!productKey || !name || !price || !stock) {
        return reply(sock, from, "Contoh: #addvarian netflix Netflix Premium|20000|10|Deskripsi", m);
      }

      const { variant, error } = addVariant(productKey, name, price, stock, description);
      if (error) return reply(sock, from, `❌ ${error}`, m);
      return reply(sock, from, `✅ Varian berhasil ditambah:\nID: ${variant.id}\nNama: ${variant.name}\nHarga: ${rupiah(variant.price)}\nStok: ${variant.stock}`, m);
    }

    if (cmd === "editvarian") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const variantId = args.list[0];
      const kv = args.list[1];
      if (!variantId || !kv || !kv.includes("=")) {
        return reply(sock, from, "Contoh: #editvarian netflix-premium stock=20", m);
      }

      const [field, value] = kv.split("=");
      const allowed = ["name", "price", "stock", "description"];
      if (!allowed.includes(field)) return reply(sock, from, `❌ Field tidak diizinkan. Gunakan: ${allowed.join(", ")}`, m);

      const { variant, error } = editVariant(variantId, field, value);
      if (error) return reply(sock, from, `❌ ${error}`, m);
      return reply(sock, from, `✅ Varian berhasil diupdate:\nID: ${variant.id}\n${field}: ${variant[field]}`, m);
    }

    if (cmd === "delproduk") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const key = args.list[0];
      if (!key) return reply(sock, from, "Contoh: #delproduk netflix", m);
      if (deleteProduct(key)) return reply(sock, from, `✅ Produk ${key} dihapus.`, m);
      return reply(sock, from, "❌ Produk tidak ditemukan.", m);
    }

    if (cmd === "delvarian") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const id = args.list[0];
      if (!id) return reply(sock, from, "Contoh: #delvarian netflix-premium", m);
      if (deleteVariant(id)) return reply(sock, from, `✅ Varian ${id} dihapus.`, m);
      return reply(sock, from, "❌ Varian tidak ditemukan.", m);
    }

    if (cmd === "produk") {
      const products = listProducts();
      if (!products.length) return reply(sock, from, "📭 Produk kosong.", m);

      const out = products.map(p => {
        const variants = p.variants.map(v => `  - ${v.id} (${v.name}) | ${rupiah(v.price)} | Stok: ${v.stock}`).join("\n");
        return `📦 *${p.name}* (${p.key})\n${variants || "  (Belum ada varian)"}`;
      }).join("\n\n");

      return reply(sock, from, `🛒 *DAFTAR PRODUK OWNER*\n\n${out}`, m);
    }

    // Settings
    if (cmd === "setpayment") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const text = args.list.join(" ");
      if (!text) return reply(sock, from, "Contoh: #setpayment Silakan transfer ke...", m);
      const db = loadDB();
      db.settings.paymentText = text;
      saveDB();
      return reply(sock, from, "✅ Payment text berhasil diupdate.", m);
    }

    if (cmd === "setqris") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const msg = quoted?.imageMessage ? quoted : m.message?.imageMessage ? m.message : null;

      if (!msg || !msg.imageMessage) {
        return reply(sock, from, "❌ Kirim/reply foto QRIS dengan caption #setqris", m);
      }

      const stream = await downloadContentFromMessage(msg.imageMessage, "image");
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      const base64 = buffer.toString("base64");
      const db = loadDB();
      db.settings.qrisImage = base64;
      saveDB();
      return reply(sock, from, "✅ QRIS berhasil diupdate.", m);
    }

    if (cmd === "setrules" || cmd === "setgaransi" || cmd === "setkontak") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const text = args.list.join(" ");
      if (!text) return reply(sock, from, `Contoh: #${cmd} Isinya...`, m);
      const db = loadDB();
      const field = cmd === "setrules" ? "rules" : cmd === "setgaransi" ? "garansi" : "kontakAdmin";
      db.settings[field] = text;
      saveDB();
      return reply(sock, from, `✅ ${cmd.substring(3)} berhasil diupdate.`, m);
    }

    // Rekap
    if (cmd === "rekap") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      const mode = args.list[0] === "bulan" ? "bulan" : "hari";
      const stats = getRekap(mode);
      const title = mode === "bulan" ? "REKAP BULAN INI" : "REKAP HARI INI";

      return reply(sock, from, `
📊 *${title}*

Total Order: ${stats.total}
✅ Sukses: ${stats.success}
⏳ Pending: ${stats.pending}
❌ Batal: ${stats.cancelled}

💰 Gross Revenue: *${rupiah(stats.revenue)}*
`.trim(), m);
    }

    // Broadcast
    if (cmd === "bc" || cmd === "bcbuyer") {
      if (!isOwner) return reply(sock, from, "❌ Khusus owner.", m);
      if (!canBroadcastToday()) return reply(sock, from, "❌ Limit broadcast tercapai (max 2 per hari).", m);

      const message = args.list.join(" ");
      if (!message) return reply(sock, from, "Contoh: #bc Info promo terbaru!", m);

      const db = loadDB();
      let jids = [];

      if (cmd === "bcbuyer") {
        jids = [...new Set(db.orders.filter(o => o.status === "success").map(o => o.buyerJid))];
      } else {
        jids = Object.keys(db.users);
      }

      if (!jids.length) return reply(sock, from, "📭 Target broadcast kosong.", m);

      await reply(sock, from, `🚀 Memulai broadcast ke ${jids.length} user...`, m);
      const log = await broadcast(sock, jids, message);

      return reply(sock, from, `✅ Broadcast selesai!\nSukses: ${log.success}\nGagal: ${log.fail}`, m);
    }

    // --- Stats & Owner Check ---
    if (cmd === "stats") {
      const db = loadDB();
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      
      const stats = `
📊 *BOT STATISTICS*

*Sistem:*
• Uptime: ${hours}h ${minutes}m
• Platform: ${os.platform()}
• RAM: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB / ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB

*Database:*
• Total Users: ${Object.keys(db.users).length}
• Total Orders: ${db.orders.length}
• Total Products: ${db.products.length}
• Total Groups: ${Object.keys(db.groups).length}
• Total FAQ: ${Object.keys(db.faq).length}
`.trim();
      return reply(sock, from, stats, m);
    }

    if (cmd === "checkowner" || cmd === "owner") {
      const db = loadDB();
      const list = config.ownerNumbers.map((n, i) => `${i + 1}. @${n}`).join("\n");
      return reply(sock, from, `👑 *DAFTAR OWNER*\n\n${list}\n\nJID Kamu: ${senderJid}`, { mentions: config.ownerNumbers.map(n => n + "@s.whatsapp.net") });
    }

    return reply(sock, from, `
*COMMAND OWNER/ADMIN*

*FAQ:*
#addfaq key|ans
#editfaq key|ans
#delfaq key
#listfaq

*Grup:*
#open / #close
#kick @user
#mute / #unmute @user
#mutelist
#antilink on/off
#autodelete on/off
#welcome on/off
#setwelcome <teks>
#goodbye on/off
#setleft <teks>
#groupsetting
#hta / #tagall / #promo

*Produk:*
#addproduk Name
#addvarian key Name|Price|Stock|Desc
#editvarian id field=value
#delproduk key
#delvarian id
#produk

*Order:*
#orders (pending/all/success)
#p [id] [detail]
#c [id]
#refund [id]
#rekap (hari/bulan)

*Sistem:*
#setpayment / #setrules / #setgaransi / #setkontak
#setqris (reply image)
#bc / #bcbuyer message
#stats
#checkowner
`.trim(), m);

  } catch (err) {
    console.error("OWNER CMD ERROR:", err);
    return reply(sock, from, `❌ Error: ${err.message}`, m);
  }
}

module.exports = ownerHandler;
