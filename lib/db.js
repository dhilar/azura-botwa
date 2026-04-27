const fs = require("fs");
const config = require("../config");

let db = null;
let saveTimer = null;

function defaultDB() {
  return {
    products: [],
    orders: [],
    users: {},
    groups: {},
    faq: {},
    settings: {
      paymentText: "Silakan kirim bukti pembayaran berupa foto.",
      qrisImage: null,
      rules: "",
      garansi: "",
      kontakAdmin: ""
    },
    nextInvoice: 1,
    proofMap: {},
    broadcastLog: []
  };
}

function loadDB() {
  if (db) return db;

  if (!fs.existsSync(config.dbFile)) {
    db = defaultDB();
    saveNow();
    return db;
  }

  try {
    db = JSON.parse(fs.readFileSync(config.dbFile, "utf8"));
  } catch {
    db = defaultDB();
  }

  // Migrations / Defaults
  if (!Array.isArray(db.products)) db.products = [];
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!db.users) db.users = {};
  if (!db.groups) db.groups = {};
  if (!db.faq) db.faq = {};
  if (!db.settings) db.settings = {};
  if (!db.settings.paymentText) db.settings.paymentText = "Silakan kirim bukti pembayaran berupa foto.";
  if (db.settings.qrisImage === undefined) db.settings.qrisImage = null;
  if (db.settings.rules === undefined) db.settings.rules = "";
  if (db.settings.garansi === undefined) db.settings.garansi = "";
  if (db.settings.kontakAdmin === undefined) db.settings.kontakAdmin = "";
  
  if (!db.nextInvoice) db.nextInvoice = 1;
  if (!db.proofMap) db.proofMap = {};
  if (!Array.isArray(db.broadcastLog)) db.broadcastLog = [];

  return db;
}

function saveNow() {
  fs.writeFileSync(config.dbFile, JSON.stringify(db, null, 2));
}

function saveDB() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow();
    saveTimer = null;
  }, 500);
}

module.exports = { loadDB, saveDB, saveNow };