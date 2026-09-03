const express = require("express");
const Order = require("../models/Order");
const { validateOrder, checkOrderValue } = require("../services/catalogService");
const { recordEvent } = require("../services/auditService");

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
      const isLimitBreach = unavailableItems.some((i) => i.kind === "limit");

      await recordEvent(
        isLimitBreach ? "ORDER_LIMIT_EXCEEDED" : "STOCK_UNAVAILABLE",
        null,
        { unavailableItems }
      );

      return res.status(400).json({
        message: isLimitBreach
          ? "Some items are outside the agent's ordering limits"
          : "Some items are no longer available",
        unavailableItems,
      });
    }

    // The ceiling is enforced here, not only at proposal time. A client that
    // skips the chat step and posts straight to this route is still bounded.
    const { total, exceeded, limit } = checkOrderValue(validatedItems);

    if (exceeded) {
      await recordEvent("ORDER_LIMIT_EXCEEDED", null, { total, limit });

      return res.status(400).json({
        message: `Order total of ₹${total} is above the ₹${limit} limit for a single order`,
        total,
        limit,
      });
    }

    // Guard against the double-POST that a fast double-click produces. If an
    // identical cart is already awaiting payment, hand back that order instead
    // of creating a second document for the same customer action.
    const RECENT_WINDOW_MS = 2 * 60 * 1000;

    const fingerprint = (items) =>
      JSON.stringify(
        items
          .map((item) => [item.productId ?? item.id, item.quantity])
          .sort((a, b) => a[0] - b[0])
      );

    const recentPending = await Order.find({
      status: "payment_pending",
      total,
      createdAt: { $gte: new Date(Date.now() - RECENT_WINDOW_MS) },
    });

    const duplicate = recentPending.find(
      (existing) => fingerprint(existing.items) === fingerprint(validatedItems)
    );

    if (duplicate) {
      console.log("Duplicate confirm ignored, reusing order:", duplicate._id);

      return res.status(200).json({
        message: "Order already awaiting payment",
        order: duplicate,
        duplicate: true,
      });
    }

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

    await recordEvent("CUSTOMER_CONFIRMED", order._id, {
      items: order.items,
      total: order.total,
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