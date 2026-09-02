const express = require("express");

const { extractOrder } = require("../services/llmService");
const { validateOrder } = require("../services/catalogService");
const { recordEvent } = require("../services/auditService");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { message } = req.body;

    // Basic request validation
    if (!message) {
      return res.status(400).json({
        message: "Customer message is required",
      });
    }

    await recordEvent("ORDER_REQUEST_RECEIVED", null, { message });

    // Step 1: Gemini extracts the order
    const llmResponse = await extractOrder(message);

    // Step 2: Convert Gemini response from text to JSON
    const extractedOrder = JSON.parse(llmResponse);

    // Step 3: Validate products against our catalog
    const { validatedItems, unavailableItems } = validateOrder(
      extractedOrder.items
    );

    // Step 4: Calculate total using backend catalog prices
    const total = validatedItems.reduce(
      (sum, item) => sum + item.subtotal,
      0
    );

    if (validatedItems.length > 0) {
      await recordEvent("ORDER_PROPOSED", null, { validatedItems, total });
    }

    if (unavailableItems.length > 0) {
      await recordEvent("STOCK_UNAVAILABLE", null, { unavailableItems });
    }

    // Step 5: Return the order proposal
    res.json({
      needsClarification: extractedOrder.needsClarification,
      validatedItems,
      unavailableItems,
      total,
    });
  } catch (error) {
    console.error("Chat error:", error.message);

    res.status(500).json({
      message: "Something went wrong while processing your request",
    });
  }
});

module.exports = router;