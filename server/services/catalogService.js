const catalog = require("../data/catalog");

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
      });

      continue;
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      unavailableItems.push({
        name: item.name,
        reason: "Invalid quantity",
      });

      continue;
    }

    if (item.quantity > product.stock) {
      unavailableItems.push({
        name: item.name,
        reason: "Insufficient stock",
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

module.exports = {
  findProduct,
  validateOrder,
};