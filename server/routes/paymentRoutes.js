const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const Order = require("../models/Order");
const { recordEvent } = require("../services/auditService");

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

router.post("/", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        message: "Order ID is required",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (order.status === "paid") {
      return res.status(409).json({
        message: "This order has already been paid",
      });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: order.total * 100,
      currency: "INR",
      receipt: order._id.toString(),
    });

    // Remember which Razorpay order belongs to this order so verification can
    // look the order up by signature subject instead of trusting the client.
    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    console.log("Razorpay order created:", razorpayOrder.id);

    await recordEvent("PAYMENT_CREATED", order._id, {
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
    });

    res.status(201).json({
      message: "Razorpay order created successfully",
      razorpayOrder,
      // Public key ID — safe in the browser. The secret stays server-side.
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Payment error:", error);

    res.status(500).json({
      message: "Failed to create Razorpay order",
    });
  }
});

// The only route that may move an order to "paid".
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        message: "Missing payment verification fields",
      });
    }

    // Look the order up by the Razorpay order ID that the signature covers,
    // so a caller cannot attach a valid signature to a different order.
    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });

    if (!order) {
      return res.status(404).json({
        message: "No order matches this payment",
      });
    }

    if (order.status === "paid") {
      // Already verified — treat a repeat call as a no-op, not a new payment.
      return res.json({
        message: "Payment already verified",
        status: order.status,
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const receivedBuffer = Buffer.from(razorpay_signature, "utf8");

    const isValid =
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

    if (!isValid) {
      order.status = "payment_failed";
      await order.save();

      await recordEvent("PAYMENT_FAILED", order._id, {
        reason: "Signature verification failed",
        razorpayOrderId: razorpay_order_id,
      });

      return res.status(400).json({
        message: "Payment verification failed",
        status: order.status,
      });
    }

    order.status = "paid";
    order.razorpayPaymentId = razorpay_payment_id;
    await order.save();

    await recordEvent("PAYMENT_SUCCESS", order._id, {
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: order.total,
    });

    res.json({
      message: "Payment verified successfully",
      status: order.status,
      order,
    });
  } catch (error) {
    console.error("Verification error:", error);

    res.status(500).json({
      message: "Something went wrong while verifying the payment",
    });
  }
});

// Checkout reported a failure or the customer closed the modal. This can only
// move a pending order to a terminal non-paid state; it can never undo "paid".
router.post("/abandon", async (req, res) => {
  try {
    const { orderId, outcome, reason } = req.body;

    if (!orderId || !["cancelled", "failed"].includes(outcome)) {
      return res.status(400).json({
        message: "Order ID and a valid outcome are required",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (order.status !== "payment_pending") {
      return res.status(409).json({
        message: `Order is already ${order.status} and cannot be changed`,
        status: order.status,
      });
    }

    order.status = outcome === "cancelled" ? "cancelled" : "payment_failed";
    await order.save();

    await recordEvent(
      outcome === "cancelled" ? "PAYMENT_CANCELLED" : "PAYMENT_FAILED",
      order._id,
      { reason: reason || "Reported by Checkout" }
    );

    res.json({
      message: "Order updated",
      status: order.status,
    });
  } catch (error) {
    console.error("Abandon error:", error);

    res.status(500).json({
      message: "Something went wrong while updating the order",
    });
  }
});

module.exports = router;
