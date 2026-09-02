// Clears demo state so a recording can be re-taken from scratch.
// Run from the server directory:  npm run demo:reset
//
// Deletes every order and every audit event. Catalog stock is a static file
// (server/data/catalog.js) and is never mutated at runtime, so there is
// nothing to reset there — the check below just reports the current levels.

const path = require("path");
const dns = require("dns");
const mongoose = require("mongoose");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Order = require("../models/Order");
const AuditEvent = require("../models/AuditEvent");
const catalog = require("../data/catalog");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const ordersBefore = await Order.countDocuments();
  const eventsBefore = await AuditEvent.countDocuments();

  console.log(`Orders to delete:       ${ordersBefore}`);
  console.log(`Audit events to delete: ${eventsBefore}`);

  const deletedOrders = await Order.deleteMany({});
  const deletedEvents = await AuditEvent.deleteMany({});

  console.log(`\nDeleted ${deletedOrders.deletedCount} order(s)`);
  console.log(`Deleted ${deletedEvents.deletedCount} audit event(s)`);

  console.log("\nCatalog stock (static, nothing to reset):");
  for (const product of catalog) {
    const flag = product.stock === 0 ? "  <-- out of stock" : "";
    console.log(`  ${String(product.name).padEnd(20)} stock=${product.stock}${flag}`);
  }

  console.log("\nDemo state is clean. Ready to record.");

  await mongoose.disconnect();
})().catch((error) => {
  console.error("Reset failed:", error.message);
  process.exit(1);
});
