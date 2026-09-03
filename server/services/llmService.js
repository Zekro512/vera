const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function extractOrder(customerMessage) {
  const prompt = `
You are an order understanding assistant for a small OTC pharmacy catalog.

Your job is ONLY to understand what products the customer wants
and extract the requested quantities.

Return ONLY valid JSON in this format:

{
  "items": [
    {
      "name": "product name",
      "quantity": 1
    }
  ],
  "needsClarification": false
}

Rules:
- Do not include prices.
- Do not include stock information.
- Do not invent products.
- If the request is unclear, set "needsClarification" to true.
- Return only JSON. No explanation or markdown.

Customer message:
"${customerMessage}"
`;

  return callWithRetry(prompt);
}

// The model call has no timeout of its own, so a stalled request would hang
// until the socket died — the customer just watches "thinking" forever. These
// outages are usually seconds long, so one retry turns most of them into a
// slow response rather than a failed order.
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 12000;
const RETRY_DELAY_MS = 1500;

function isWorthRetrying(error) {
  const text = `${error?.message || error}`;

  // 503 UNAVAILABLE and 429 RESOURCE_EXHAUSTED are transient on Gemini's side.
  // A bad API key or a malformed prompt is not, and retrying wastes quota.
  return (
    text.includes("timed out") ||
    text.includes("503") ||
    text.includes("UNAVAILABLE") ||
    text.includes("429") ||
    text.includes("RESOURCE_EXHAUSTED")
  );
}

async function callOnce(prompt) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Gemini timed out after ${REQUEST_TIMEOUT_MS}ms`)),
      REQUEST_TIMEOUT_MS
    );
  });

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      }),
      timeout,
    ]);

    return response.text;
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(prompt) {
  try {
    return await callOnce(prompt);
  } catch (error) {
    if (!isWorthRetrying(error)) {
      throw error;
    }

    console.warn(`[llm] ${error.message} — retrying once`);

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    return callOnce(prompt);
  }
}

module.exports = {
  extractOrder,
};