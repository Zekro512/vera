const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const AuditEvent = require("../models/AuditEvent");

const router = express.Router();

// Recent events across everything. Handy to leave open in a browser tab while
// demonstrating the flow.
router.get("/", async (req, res) => {
  try {
    const events = await AuditEvent.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({
      count: events.length,
      events,
    });
  } catch (error) {
    console.error("Audit read error:", error.message);

    res.status(500).json({ message: "Could not read the audit trail" });
  }
});

// The full story of one order.
router.get("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(orderId).lean();

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const orderEvents = await AuditEvent.find({ orderId })
      .sort({ createdAt: 1 })
      .lean();

    // Chat-stage events are recorded before the order exists, so they carry a
    // null orderId. Include the ones from just before this order was created so
    // the chain reads end to end rather than starting at CUSTOMER_CONFIRMED.
    const LOOKBACK_MS = 10 * 60 * 1000;

    const chatEvents = await AuditEvent.find({
      orderId: null,
      createdAt: {
        $gte: new Date(new Date(order.createdAt).getTime() - LOOKBACK_MS),
        $lte: new Date(order.createdAt),
      },
    })
      .sort({ createdAt: 1 })
      .lean();

    const timeline = [...chatEvents, ...orderEvents].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );

    res.json({
      order: {
        _id: order._id,
        items: order.items,
        total: order.total,
        status: order.status,
        razorpayOrderId: order.razorpayOrderId || null,
        razorpayPaymentId: order.razorpayPaymentId || null,
        createdAt: order.createdAt,
      },
      timeline: timeline.map((event) => ({
        at: event.createdAt,
        type: event.type,
        // Chat-stage events are not tied to this order; label them so the
        // timeline is not read as stronger evidence than it is.
        scope: event.orderId ? "order" : "chat (correlated by time)",
        detail: event.detail,
      })),
    });
  } catch (error) {
    console.error("Audit read error:", error.message);

    res.status(500).json({ message: "Could not read the audit trail" });
  }
});

module.exports = router;
