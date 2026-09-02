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

  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: prompt,
  });

  return response.text;
}

module.exports = {
  extractOrder,
};