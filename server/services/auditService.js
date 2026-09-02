const AuditEvent = require("../models/AuditEvent");

// Recording an audit event must never break the customer's order or payment.
// If the write fails we log it and carry on rather than throwing.
async function recordEvent(type, orderId = null, detail = undefined) {
  try {
    await AuditEvent.create({ type, orderId, detail });

    console.log(`[audit] ${type}${orderId ? ` order=${orderId}` : ""}`);
  } catch (error) {
    console.error(`[audit] failed to record ${type}:`, error.message);
  }
}

module.exports = {
  recordEvent,
};
