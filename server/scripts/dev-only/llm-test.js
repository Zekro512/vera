// Dev-only scratch script. Not part of the running application.
// Run from the server directory: node scripts/dev-only/llm-test.js
const { extractOrder } = require("../../services/llmService");

async function testLLM() {
  try {
    const result = await extractOrder(
      "I need 2 Paracetamol and 1 Vicks Vaporub"
    );

    console.log(result);
  } catch (error) {
    console.error("LLM error:", error.message);
  }
}

testLLM();