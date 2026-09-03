const catalog = require("../data/catalog");
const { MAX_ITEM_QUANTITY, MAX_ORDER_VALUE } = require("../config/limits");

function findProduct(productName) {
  const searchName = productName.toLowerCase();

  return catalog.find((product) =>
    product.name.toLowerCase().includes(searchName)
  );
}

function validateOrder(items) {
  const validatedItems = [];
  const unavailableItems = [];

  for (const item of items) {
    const product = findProduct(item.name);

    if (!product) {
      unavailableItems.push({
        name: item.name,
        reason: "Product not found",
        kind: "catalog",
      });

      continue;
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      unavailableItems.push({
        name: item.name,
        reason: "Invalid quantity",
        kind: "catalog",
      });

      continue;
    }

    // Checked before stock so the refusal names the agent's own ceiling
    // rather than a warehouse level the customer cannot reason about.
    if (item.quantity > MAX_ITEM_QUANTITY) {
      unavailableItems.push({
        name: product.name,
        reason: `Above the ${MAX_ITEM_QUANTITY} per-item limit`,
        // A bound the operator set, not a warehouse problem. The audit trail
        // records these as ORDER_LIMIT_EXCEEDED rather than STOCK_UNAVAILABLE.
        kind: "limit",
      });

      continue;
    }

    if (item.quantity > product.stock) {
      unavailableItems.push({
        name: product.name,
        reason: product.stock === 0 ? "Out of stock" : "Insufficient stock",
        kind: "stock",
      });

      continue;
    }

    validatedItems.push({
      id: product.id,
      name: product.name,
      quantity: item.quantity,
      price: product.price,
      subtotal: product.price * item.quantity,
    });
  }

  return {
    validatedItems,
    unavailableItems,
  };
}

// The order-value ceiling. Returns the computed total and whether it is
// allowed, so callers never have to know how the bound is defined.
function checkOrderValue(validatedItems) {
  const total = validatedItems.reduce((sum, item) => sum + item.subtotal, 0);

  return {
    total,
    exceeded: total > MAX_ORDER_VALUE,
    limit: MAX_ORDER_VALUE,
  };
}

module.exports = {
  findProduct,
  validateOrder,
  checkOrderValue,
};