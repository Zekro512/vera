// Dev-only scratch script. Not part of the running application.
// Run from the server directory: node scripts/dev-only/catalog-test.js
const { validateOrder } = require("../../services/catalogService");

const testItems = [
  {
    name: "Paracetamol",
    quantity: 2,
  },
  {
    name: "Unknown Medicine",
    quantity: 1,
  },
  {
    name: "Vicks Vaporub",
    quantity: 100,
  },
];

const result = validateOrder(testItems);

console.log(result);