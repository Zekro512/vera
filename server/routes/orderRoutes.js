const express = require("express");
const Order = require("../models/Order");
const { validateOrder } = require("../services/catalogService");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const orderData = req.body;

    console.log("Received confirmed order:", orderData);

    if (!Array.isArray(orderData.validatedItems) || orderData.validatedItems.length === 0) {
      return res.status(400).json({
        message: "Order must contain at least one item",
      });
    }

    // Never trust the client for prices or totals. Re-validate the requested
    // items against the catalog and recompute the total server-side.
    const { validatedItems, unavailableItems } = validateOrder(
      orderData.validatedItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
      }))
    );

    if (unavailableItems.length > 0) {
      return res.status(400).json({
        message: "Some items are no longer available",
        unavailableItems,
      });
    }

    const total = validatedItems.reduce((sum, item) => sum + item.subtotal, 0);

    const order = await Order.create({
      items: validatedItems.map((item) => ({
        productId: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal,
      })),
      total,
      status: "payment_pending",
    });

    res.status(201).json({
      message: "Order saved successfully",
      order,
    });
  } catch (error) {
    console.error("Order error:", error.message);

    res.status(500).json({
      message: "Something went wrong while saving the order",
    });
  }
});
module.exports = router;