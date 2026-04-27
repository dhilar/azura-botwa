const path = require("path");

module.exports = {
  botName: "Digimu Store Bot",
  prefix: "#",

  ownerNumbers: [
    "6285138745718",
    "13001486762213"
  ],

  ownerJids: [
    "6285138745718@s.whatsapp.net",
    "13001486762213@lid"
  ],

  sessionPath: path.join(__dirname, "session"),
  dbFile: path.join(__dirname, "db.json"),

  orderExpireMinutes: 30
};