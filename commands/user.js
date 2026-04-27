const { listProducts, findProduct, findVariantFromSession } = require("../lib/product");
const { 
  createOrder, 
  formatInvoice, 
  latestPendingOrderByBuyer, 
  markPaymentUploaded,
  findOrder,
  cancelOrder
} = require("../lib/order");
const { setSession, getSession, clearSession } = require("../lib/session");
const { reply, rupiah } = require("../lib/msg");
const { loadDB, saveDB } = require("../lib/db");

async function userHandler(sock, m, context) {
  const { from, senderJid, senderNumber, pushName, text, hasImage, ownerJids } = context;
  const lower = text.toLowerCase().trim();

  // Update user info
  const db = loadDB();
  if (!db.users[senderJid]) {
    db.users[senderJid] = {
      jid: senderJid,
      number: senderNumber,
      name: pushName,
      createdAt: new Date().toISOString(),
      optOutBroadcast: false
    };
    saveDB();
  } else if (db.users[senderJid].name !== pushName) {
    db.users[senderJid].name = pushName;
    saveDB();
  }

  if (lower === "menu" || lower === "list") {
    const products = listProducts();

    if (!products.length) {
      return reply(sock, from, "📭 Produk masih kosong.", m);
    }

    const list = products.map((p, i) => `${i + 1}. ${p.name}`).join("\n");

    return reply(sock, from, `
🛒 *MENU PRODUK*

${list}

Ketik nama produk.
Contoh: *chatgpt*
`.trim(), m);
  }

  // Support Commands
  if (lower === "rules") {
    return reply(sock, from, db.settings.rules || "Belum ada rules.", m);
  }
  if (lower === "garansi") {
    return reply(sock, from, db.settings.garansi || "Belum ada info garansi.", m);
  }
  if (lower === "kontakadmin" || lower === "kontak") {
    return reply(sock, from, db.settings.kontakAdmin || "Belum ada kontak admin.", m);
  }

  // FAQ System
  if (lower === "faq" || lower.startsWith("faq ") || lower.startsWith("penjelasan ") || lower.startsWith("info ")) {
    const faqKeys = Object.keys(db.faq);
    if (!faqKeys.length) return reply(sock, from, "📭 FAQ belum tersedia.", m);

    let keyword = "";
    if (lower === "faq") {
      return reply(sock, from, `📑 *DAFTAR INFO / FAQ*\n\n${faqKeys.map(k => `• ${k}`).join("\n")}\n\nKetik *faq <keyword>* untuk melihat penjelasan.`, m);
    } else if (lower.startsWith("faq ")) {
      keyword = lower.substring(4).trim();
    } else if (lower.startsWith("penjelasan ")) {
      keyword = lower.substring(11).trim();
    } else if (lower.startsWith("info ")) {
      keyword = lower.substring(5).trim();
    }

    // Fuzzy/Partial matching
    const match = faqKeys.find(k => k.includes(keyword) || keyword.includes(k));
    if (match) {
      return reply(sock, from, `📑 *${match.toUpperCase()}*\n\n${db.faq[match]}`, m);
    }

    return reply(sock, from, "Penjelasan belum tersedia. Ketik *faq* untuk daftar info.", m);
  }

  if (lower === "pay" || lower === "payment") {
    const db = loadDB();
    const paymentText = db.settings.paymentText || "Silakan transfer...";
    const qris = db.settings.qrisImage;

    if (qris) {
      return sock.sendMessage(from, {
        image: Buffer.from(qris, "base64"),
        caption: paymentText
      }, { quoted: m });
    }
    return reply(sock, from, paymentText, m);
  }

  if (lower === "start" || lower === "subscribe") {
    db.users[senderJid].optOutBroadcast = false;
    saveDB();
    return reply(sock, from, "✅ Kamu telah berlangganan broadcast info & promo.", m);
  }

  if (lower === "stop" || lower === "unsubscribe") {
    db.users[senderJid].optOutBroadcast = true;
    saveDB();
    return reply(sock, from, "✅ Kamu telah berhenti berlangganan broadcast.", m);
  }

  if (lower === "myorder") {
    const orders = db.orders.filter(o => o.buyerJid === senderJid).slice(-5).reverse();

    if (!orders.length) return reply(sock, from, "📭 Kamu belum punya order.", m);

    const out = orders.map(o =>
      `• ${o.invoice} - ${o.variantName}\n  Status: ${o.status} | Total: ${rupiah(o.total)}`
    ).join("\n\n");

    return reply(sock, from, `📦 *ORDER KAMU*\n\n${out}`, m);
  }

  if (lower.startsWith("cekorder")) {
    const num = lower.split(/\s+/)[1];
    if (!num) return reply(sock, from, "Contoh: cekorder 1", m);

    const order = db.orders.find(o =>
      o.buyerJid === senderJid &&
      (String(o.invoiceNumber) === num || o.invoice.toLowerCase() === num.toLowerCase())
    );

    if (!order) return reply(sock, from, "❌ Order tidak ditemukan.", m);

    return reply(sock, from, `
📦 *DETAIL ORDER ${order.invoice}*

Produk: ${order.variantName}
Total: ${rupiah(order.total)}
Status: ${order.status}
Note: ${order.note || "-"}
`.trim(), m);
  }

  if (lower.startsWith("batal")) {
    const num = lower.split(/\s+/)[1];
    if (!num) return reply(sock, from, "Contoh: batal 1", m);

    const order = db.orders.find(o =>
      o.buyerJid === senderJid &&
      (String(o.invoiceNumber) === num || o.invoice.toLowerCase() === num.toLowerCase())
    );

    if (!order) return reply(sock, from, "❌ Order tidak ditemukan.", m);
    if (!["pending", "payment_uploaded"].includes(order.status)) {
      return reply(sock, from, `❌ Order ${order.invoice} tidak bisa dibatalkan karena statusnya ${order.status}.`, m);
    }

    cancelOrder(order, "Dibatalkan oleh pembeli");
    return reply(sock, from, `✅ Order *${order.invoice}* berhasil dibatalkan.`, m);
  }

  if (hasImage) {
    const order = latestPendingOrderByBuyer(senderJid);

    if (!order) {
      return reply(sock, from, "📷 Bukti bayar diterima, tapi aku belum menemukan order pending kamu. Ketik *list* untuk order dulu.", m);
    }

    markPaymentUploaded(order, {
      uploadedAt: new Date().toISOString(),
      messageId: m.key.id
    });

    await reply(sock, from, `✅ Bukti bayar untuk *${order.invoice}* diterima. Mohon tunggu admin memproses ya.`, m);

    // Forwarding to owner will be handled in index.js to use downloadContentFromMessage easily
    return;
  }

  const session = getSession(senderJid);

  if (session?.mode === "select_variant") {
    const variant = findVariantFromSession(text, session.variants);

    if (!variant) {
      const options = session.variants.map((v, i) =>
        `${i + 1}. ${v.name} - ${rupiah(v.price)} ${v.stock <= 0 ? '(Stok Habis)' : ''}`
      ).join("\n");

      return reply(sock, from, `
Aku belum menemukan pilihan itu.

Pilih salah satu:
${options}

Contoh: *1* atau *plus*
`.trim(), m);
    }

    if (variant.stock <= 0) {
      return reply(sock, from, `❌ Stok *${variant.name}* sedang habis. Silakan pilih varian lain atau kembali nanti.`, m);
    }

    const { order, error } = createOrder({
      buyerJid: senderJid,
      buyerNumber: senderNumber,
      buyerName: pushName,
      product: session.product,
      variant
    });

    clearSession(senderJid);

    if (error) return reply(sock, from, `❌ ${error}`, m);

    const invText = formatInvoice(order);
    const qris = db.settings.qrisImage;

    if (qris) {
      return sock.sendMessage(from, {
        image: Buffer.from(qris, "base64"),
        caption: invText
      }, { quoted: m });
    }
    return reply(sock, from, invText, m);
  }

  const product = findProduct(text);

  if (product) {
    setSession(senderJid, {
      mode: "select_variant",
      product,
      variants: product.variants
    });

    const variants = product.variants.map((v, i) => {
      const stock = v.stock ?? 0;
      const stockText = stock <= 0 ? "*STOK HABIS*" : stock;
      return `${i + 1}. ${v.name}\n   Harga: ${rupiah(v.price)}\n   Stok: ${stockText}`;
    }).join("\n\n");

    return reply(sock, from, `
📦 *${product.name.toUpperCase()}*

${variants}

Ketik nomor atau nama varian.
Contoh: *1* atau *plus*
`.trim(), m);
  }

  // Auto Responder Fallback
  const autoKeywords = ["garansi", "refund", "cara order", "payment", "pembayaran", "stok"];
  const foundKeyword = autoKeywords.find(k => lower.includes(k));
  if (foundKeyword) {
    const faqKeys = Object.keys(db.faq);
    const match = faqKeys.find(k => k.includes(foundKeyword) || foundKeyword.includes(k));
    if (match) {
      return reply(sock, from, `📑 *${match.toUpperCase()}*\n\n${db.faq[match]}`, m);
    }
  }

  return reply(sock, from, "Aku belum paham. Ketik *menu* untuk lihat produk.", m);
}

module.exports = userHandler;
