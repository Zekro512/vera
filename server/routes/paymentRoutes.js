const express = require("express");
const Razorpay = require("razorpay");
const Order = require("../models/Order");

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

    const razorpayOrder = await razorpay.orders.create({
      amount: order.total * 100,
      currency: "INR",
      receipt: order._id.toString(),
    });

    console.log("Razorpay order created:", razorpayOrder.id);

    res.status(201).json({
      message: "Razorpay order created successfully",
      razorpayOrder,
    });
  } catch (error) {
    console.error("Payment error:", error);

    res.status(500).json({
      message: "Failed to create Razorpay order",
    });
  }
});

module.exports = router;