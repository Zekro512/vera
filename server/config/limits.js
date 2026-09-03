// Hard bounds on what the agent is allowed to propose or transact.
// The agent cannot raise these; only the operator can, via environment.
//
// These exist because an ordering agent that will happily assemble an order of
// any size is not a bounded agent. Every money action stays inside a ceiling
// the merchant sets, and exceeding it is a refusal, not a warning.

const MAX_ITEM_QUANTITY = Number(process.env.MAX_ITEM_QUANTITY) || 10;
const MAX_ORDER_VALUE = Number(process.env.MAX_ORDER_VALUE) || 1000;

module.exports = {
  MAX_ITEM_QUANTITY,
  MAX_ORDER_VALUE,
};
