const express = require("express");

const { extractOrder } = require("../services/llmService");
const { validateOrder, checkOrderValue } = require("../services/catalogService");
const { MAX_ITEM_QUANTITY } = require("../config/limits");
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

    // Step 4: Total from backend catalog prices, checked against the ceiling
    const { total, exceeded, limit } = checkOrderValue(validatedItems);

    if (validatedItems.length > 0) {
      await recordEvent("ORDER_PROPOSED", null, { validatedItems, total });
    }

    // A bound breach and a stock shortfall are different refusals, so they are
    // recorded as different events rather than lumped together.
    const stockRejections = unavailableItems.filter((i) => i.kind !== "limit");
    const limitRejections = unavailableItems.filter((i) => i.kind === "limit");

    if (stockRejections.length > 0) {
      await recordEvent("STOCK_UNAVAILABLE", null, {
        unavailableItems: stockRejections,
      });
    }

    if (limitRejections.length > 0) {
      await recordEvent("ORDER_LIMIT_EXCEEDED", null, {
        rejectedItems: limitRejections,
        maxItemQuantity: MAX_ITEM_QUANTITY,
      });
    }

    if (exceeded) {
      await recordEvent("ORDER_LIMIT_EXCEEDED", null, { total, limit });
    }

    // Step 5: Return the order proposal
    res.json({
      needsClarification: extractedOrder.needsClarification,
      validatedItems,
      unavailableItems,
      total,
      limit: {
        maxOrderValue: limit,
        exceeded,
      },
    });
  } catch (error) {
    console.error("Chat error:", error.message);

    res.status(500).json({
      message: "Something went wrong while processing your request",
    });
  }
});

module.exports = router;