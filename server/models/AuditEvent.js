const mongoose = require("mongoose");

// One row per meaningful step in the order lifecycle. Written by the server
// only — never from anything the customer or the LLM supplies directly.
const auditEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "ORDER_REQUEST_RECEIVED",
        "ORDER_PROPOSED",
        "STOCK_UNAVAILABLE",
        "ORDER_LIMIT_EXCEEDED",
        "CUSTOMER_CONFIRMED",
        "PAYMENT_CREATED",
        "PAYMENT_SUCCESS",
        "PAYMENT_FAILED",
        "PAYMENT_CANCELLED",
      ],
      required: true,
    },
    // Null for chat-stage events, which happen before an order document exists.
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    detail: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("AuditEvent", auditEventSchema);
