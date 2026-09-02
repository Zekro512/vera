const { extractOrder } = require("./services/llmService");

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