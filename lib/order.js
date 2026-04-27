const config = require("../config");
const { loadDB, saveDB } = require("./db");
const { reduceStock, restoreStock } = require("./product");
const { rupiah } = require("./msg");

function createOrder({ buyerJid, buyerNumber, buyerName, product, variant }) {
  const db = loadDB();

  if (!reduceStock(variant.id, 1)) {
    return { error: "Stok produk habis atau tidak cukup." };
  }

  const invoiceNumber = db.nextInvoice++;
  const invoice = `INV-${invoiceNumber}`;
  const now = Date.now();

  const order = {
    invoice,
    invoiceNumber,
    buyerJid,
    buyerNumber,
    buyerName,
    productKey: product.key,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    price: variant.price,
    qty: 1,
    total: variant.price,
    status: "pending",
    proof: null,
    note: "",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + config.orderExpireMinutes * 60 * 1000).toISOString()
  };

  db.orders.push(order);
  saveDB();

  return { order };
}

function findOrder(input) {
  const db = loadDB();
  const q = String(input || "").replace(/^INV-/i, "");
  return db.orders.find(o =>
    String(o.invoiceNumber) === q ||
    String(o.invoice).toLowerCase() === String(input).toLowerCase()
  );
}

function latestPendingOrderByBuyer(buyerJid) {
  const db = loadDB();
  return [...db.orders]
    .reverse()
    .find(o =>
      o.buyerJid === buyerJid &&
      ["pending", "payment_uploaded"].includes(o.status)
    );
}

function markPaymentUploaded(order, proofInfo = {}) {
  order.status = "payment_uploaded";
  order.proof = proofInfo;
  order.updatedAt = new Date().toISOString();
  saveDB();
}

function completeOrder(order, note = "") {
  order.status = "success";
  order.note = note || order.note || "";
  order.updatedAt = new Date().toISOString();
  saveDB();
}

function cancelOrder(order, reason = "Cancelled") {
  if (!order || !["pending", "payment_uploaded"].includes(order.status)) return false;

  order.status = "cancelled";
  order.note = reason;
  order.updatedAt = new Date().toISOString();
  restoreStock(order.variantId, order.qty || 1);
  saveDB();
  return true;
}

function refundOrder(order, reason = "Refunded") {
  if (!order || order.status !== "success") return false;

  order.status = "refunded";
  order.note = reason;
  order.updatedAt = new Date().toISOString();
  restoreStock(order.variantId, order.qty || 1);
  saveDB();
  return true;
}

function getRekap(mode = "hari") {
  const db = loadDB();
  const now = new Date();
  
  // Set to Asia/Jakarta (roughly +7)
  const offset = 7 * 60;
  const localNow = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
  
  let filtered = db.orders;

  if (mode === "hari") {
    const todayStr = localNow.toISOString().split("T")[0];
    filtered = db.orders.filter(o => {
      const oDate = new Date(o.createdAt);
      const oLocal = new Date(oDate.getTime() + (offset + oDate.getTimezoneOffset()) * 60000);
      return oLocal.toISOString().split("T")[0] === todayStr;
    });
  } else if (mode === "bulan") {
    const monthStr = localNow.toISOString().slice(0, 7); // YYYY-MM
    filtered = db.orders.filter(o => {
      const oDate = new Date(o.createdAt);
      const oLocal = new Date(oDate.getTime() + (offset + oDate.getTimezoneOffset()) * 60000);
      return oLocal.toISOString().slice(0, 7) === monthStr;
    });
  }

  const stats = {
    total: filtered.length,
    success: filtered.filter(o => o.status === "success").length,
    pending: filtered.filter(o => ["pending", "payment_uploaded"].includes(o.status)).length,
    cancelled: filtered.filter(o => o.status === "cancelled").length,
    revenue: filtered.filter(o => o.status === "success").reduce((acc, o) => acc + o.total, 0)
  };

  return stats;
}

function formatInvoice(order) {
  const db = loadDB();
  const paymentText = db.settings.paymentText || "Silakan kirim bukti pembayaran berupa foto.";
  
  return `
🧾 *INVOICE ${order.invoice}*

👤 Pembeli: ${order.buyerName}
📦 Produk: ${order.variantName}
🔢 Qty: ${order.qty}
💰 Total: *${rupiah(order.total)}*
📌 Status: *${order.status}*

${paymentText}
`.trim();
}

function formatSuccess(order) {
  return `
✅ *ORDER SELESAI ${order.invoice}*

📦 Produk: ${order.variantName}
💰 Total: ${rupiah(order.total)}
📌 Status: success

${order.note ? `🎁 Detail Produk:\n${order.note}` : ""}
`.trim();
}

module.exports = {
  createOrder,
  findOrder,
  latestPendingOrderByBuyer,
  markPaymentUploaded,
  completeOrder,
  cancelOrder,
  refundOrder,
  getRekap,
  formatInvoice,
  formatSuccess
};