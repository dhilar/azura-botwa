const { loadDB, saveDB } = require("./db");
const { normalize } = require("./msg");

function normalizeSlug(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function listProducts() {
  const db = loadDB();
  return db.products;
}

function addProduct(name) {
  const db = loadDB();
  const key = normalizeSlug(name);

  if (db.products.find(p => p.key === key)) {
    return { error: `Produk dengan key "${key}" sudah ada.` };
  }

  const product = {
    key,
    name,
    variants: []
  };

  db.products.push(product);
  saveDB();
  return { product };
}

function deleteProduct(key) {
  const db = loadDB();
  const index = db.products.findIndex(p => p.key === key);

  if (index === -1) return false;

  db.products.splice(index, 1);
  saveDB();
  return true;
}

function addVariant(productKey, name, price, stock, description = "") {
  const db = loadDB();
  const product = db.products.find(p => p.key === productKey);

  if (!product) return { error: "Produk tidak ditemukan." };

  const variantId = `${productKey}-${normalizeSlug(name)}`;

  if (product.variants.find(v => v.id === variantId)) {
    return { error: `Varian dengan ID "${variantId}" sudah ada.` };
  }

  const variant = {
    id: variantId,
    name,
    price: Number(price),
    stock: Number(stock),
    description
  };

  product.variants.push(variant);
  saveDB();
  return { variant };
}

function editVariant(variantId, field, value) {
  const db = loadDB();
  let found = null;

  for (const product of db.products) {
    const variant = product.variants.find(v => v.id === variantId);
    if (variant) {
      if (field === "price" || field === "stock") {
        variant[field] = Number(value);
      } else {
        variant[field] = value;
      }
      found = variant;
      break;
    }
  }

  if (found) {
    saveDB();
    return { variant: found };
  }

  return { error: "Varian tidak ditemukan." };
}

function deleteVariant(variantId) {
  const db = loadDB();
  let deleted = false;

  for (const product of db.products) {
    const index = product.variants.findIndex(v => v.id === variantId);
    if (index !== -1) {
      product.variants.splice(index, 1);
      deleted = true;
      break;
    }
  }

  if (deleted) {
    saveDB();
    return true;
  }

  return false;
}

function findProduct(input) {
  const db = loadDB();
  const q = normalize(input);

  // exact key match
  let p = db.products.find(p => p.key === q);
  if (p) return p;

  // fuzzy match
  return db.products.find(p => {
    const key = normalize(p.key);
    const name = normalize(p.name);
    return key.includes(q) || name.includes(q) || q.includes(key) || q.includes(name);
  });
}

function findVariantFromSession(input, variants) {
  const q = normalize(input);

  const asNumber = Number(q);
  if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= variants.length) {
    return variants[asNumber - 1];
  }

  return variants.find(v => {
    const name = normalize(v.name);
    const id = normalize(v.id);
    return name.includes(q) || id.includes(q) || q.includes(name);
  });
}

function reduceStock(variantId, qty = 1) {
  const db = loadDB();

  for (const product of db.products) {
    const variant = product.variants.find(v => v.id === variantId);
    if (variant) {
      if ((variant.stock || 0) < qty) return false;
      variant.stock -= qty;
      saveDB();
      return true;
    }
  }

  return false;
}

function restoreStock(variantId, qty = 1) {
  const db = loadDB();

  for (const product of db.products) {
    const variant = product.variants.find(v => v.id === variantId);
    if (variant) {
      variant.stock = (variant.stock || 0) + qty;
      saveDB();
      return true;
    }
  }

  return false;
}

module.exports = {
  listProducts,
  addProduct,
  deleteProduct,
  addVariant,
  editVariant,
  deleteVariant,
  findProduct,
  findVariantFromSession,
  reduceStock,
  restoreStock
};