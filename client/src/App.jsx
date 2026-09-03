import { useEffect, useState } from "react";
import "./App.css";

// Presentation only — the server is the authority on what an order's status is.
const statusLabel = (status) =>
  ({
    payment_pending: "Payment pending",
    paid: "Paid",
    payment_failed: "Payment failed",
    cancelled: "Cancelled",
  }[status] || "Problem");

const statusClass = (status) =>
  ({
    payment_pending: "status-pending",
    paid: "status-paid",
    payment_failed: "status-bad",
    cancelled: "status-bad",
  }[status] || "status-bad");

function App() {
  // Boot splash. Purely cosmetic — it never gates the app, which is already
  // interactive underneath while the overlay slides away.
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 1500);

    return () => clearTimeout(timer);
  }, []);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  // Which proposals are mid-confirm or already confirmed, so one customer
  // action cannot become two orders.
  const [confirmingIndex, setConfirmingIndex] = useState(null);
  const [confirmedIndexes, setConfirmedIndexes] = useState([]);
  // Payment outcome per proposal, shown inline on the order card instead of
  // in a browser alert. Mirrors the server's status; it never sets it.
  const [orderState, setOrderState] = useState({});

  const setOrderStatus = (messageIndex, patch) => {
    setOrderState((prev) => ({
      ...prev,
      [messageIndex]: { ...(prev[messageIndex] || {}), ...patch },
    }));
  };
  // Tell the server a payment was cancelled or failed so the order does not
  // sit at payment_pending forever. Never used to mark anything paid.
  const reportAbandonedPayment = async (orderId, outcome, reason) => {
    try {
      await fetch("http://localhost:5000/api/payments/abandon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId, outcome, reason }),
      });
    } catch (error) {
      console.error("Could not report abandoned payment:", error);
    }
  };

  const handleConfirmOrder = async (orderData, messageIndex) => {
    // First line of defence against a double-click: refuse to start a second
    // confirm for a proposal that is already in flight or already confirmed.
    if (confirmingIndex !== null || confirmedIndexes.includes(messageIndex)) {
      return;
    }

    setConfirmingIndex(messageIndex);

    try {
      // Step 1: save the customer-confirmed order. The server re-validates the
      // items and recomputes the total, so this response is the trusted one.
      const orderResponse = await fetch("http://localhost:5000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderData),
      });

      const orderResult = await orderResponse.json();

      console.log("Order response:", orderResult);

      if (!orderResponse.ok) {
        setOrderStatus(messageIndex, {
          status: "error",
          note: orderResult.message || "Could not save the order.",
        });
        return;
      }

      const savedOrder = orderResult.order;

      setOrderStatus(messageIndex, {
        status: savedOrder.status,
        orderId: savedOrder._id,
        note: "Awaiting payment",
      });

      // The order now exists server-side, so this proposal must not be
      // confirmable again even if the payment is later cancelled.
      setConfirmedIndexes((prev) => [...prev, messageIndex]);

      // Step 2: ask the backend to create a Razorpay order from the stored total.
      const paymentResponse = await fetch("http://localhost:5000/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId: savedOrder._id }),
      });

      const paymentResult = await paymentResponse.json();

      console.log("Payment response:", paymentResult);

      if (!paymentResponse.ok) {
        setOrderStatus(messageIndex, {
          status: "error",
          note: paymentResult.message || "Could not start the payment.",
        });
        return;
      }

      if (!window.Razorpay) {
        setOrderStatus(messageIndex, {
          status: "error",
          note: "Razorpay Checkout did not load. Check your connection.",
        });
        return;
      }

      // Step 3: open Razorpay Checkout in Test Mode.
      const checkout = new window.Razorpay({
        key: paymentResult.razorpayKeyId,
        amount: paymentResult.razorpayOrder.amount,
        currency: paymentResult.razorpayOrder.currency,
        order_id: paymentResult.razorpayOrder.id,
        name: "AI Commerce Agent",
        description: `Order ${savedOrder._id}`,
        handler: async (response) => {
          // Checkout says it succeeded. That is a claim, not proof — the order
          // only becomes "paid" if the server verifies the signature.
          console.log("Razorpay payment response:", response);

          try {
            const verifyResponse = await fetch(
              "http://localhost:5000/api/payments/verify",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              }
            );

            const verifyResult = await verifyResponse.json();

            console.log("Verification response:", verifyResult);

            setOrderStatus(messageIndex, {
              status: verifyResponse.ok ? verifyResult.status : "payment_failed",
              paymentId: response.razorpay_payment_id,
              note: verifyResponse.ok
                ? "Signature verified by the server"
                : verifyResult.message || "Signature could not be verified",
            });
          } catch (error) {
            console.error("Verification error:", error);

            setOrderStatus(messageIndex, {
              status: "payment_pending",
              note: "Paid at Razorpay, but the server could not be reached to verify it.",
            });
          }
        },
        modal: {
          ondismiss: () => {
            reportAbandonedPayment(savedOrder._id, "cancelled", "Customer closed Checkout");

            setOrderStatus(messageIndex, {
              status: "cancelled",
              note: "Checkout closed before payment",
            });
          },
        },
      });

      checkout.on("payment.failed", (response) => {
        console.error("Razorpay payment failed:", response.error);

        reportAbandonedPayment(
          savedOrder._id,
          "failed",
          response.error?.description
        );

        setOrderStatus(messageIndex, {
          status: "payment_failed",
          note: response.error?.description || "Payment failed at Razorpay",
        });
      });

      checkout.open();
    } catch (error) {
      console.error("Order confirmation error:", error);

      setOrderStatus(messageIndex, {
        status: "error",
        note: "Something went wrong while confirming the order.",
      });
    } finally {
      setConfirmingIndex(null);
    }
  };

  const handleSend = async (presetText) => {
    // presetText comes from the suggestion chips; typing uses the input state.
    const userMessage = (typeof presetText === "string"
      ? presetText
      : message
    ).trim();

    if (!userMessage) return;

    // Show user message immediately
    setMessages((prev) => [
      ...prev,
      {
        sender: "user",
        text: userMessage,
      },
    ]);

    setMessage("");
    setLoading(true);

    try {
      // Send message to backend
      const response = await fetch("http://localhost:5000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
        }),
      });

      const data = await response.json();

      // An error response has no validatedItems/unavailableItems. Rendering it
      // as a proposal would throw during render and unmount the whole app, so
      // show it as text instead.
      const isProposal =
        response.ok &&
        Array.isArray(data.validatedItems) &&
        Array.isArray(data.unavailableItems);

      setMessages((prev) => [
        ...prev,
        isProposal
          ? { sender: "ai", data }
          : {
              sender: "ai",
              text:
                data.message ||
                "Sorry, I could not read that order. Please try again.",
            },
      ]);
      setLoading(false);
    } catch (error) {
      console.error("Error:", error);

      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: "Sorry, something went wrong.",
        },
      ]);
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className={`splash ${booting ? "" : "splash-out"}`}>
        <div className="splash-inner">
          <div className="splash-mark">AC</div>
          <div className="splash-title">AI Commerce Agent</div>
          <div className="splash-sub">Bounded · Gated · Auditable</div>
          <div className="splash-bar">
            <span />
          </div>
        </div>
      </div>

      <header className="app-header">
        <div className="brand-mark">AC</div>

        <div className="brand-text">
          <h1>AI Commerce Agent</h1>
          <p>Order in plain language. Every price checked by the server.</p>
        </div>

        <span className="mode-pill">Test mode</span>
      </header>

      <div className="chat">
        {messages.length === 0 && !loading && (
          <div className="empty">
            <h2>What do you need today?</h2>
            <p>Describe your order and the agent will price it up.</p>

            <div className="chips">
              {[
                "I need 2 Paracetamol and 1 Vicks Vaporub",
                "1 Digital Thermometer please",
                "3 ORS and 1 Cough Syrup",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="chip"
                  onClick={() => handleSend(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((item, index) => (
          <div
            key={index}
            className={`msg ${item.sender === "user" ? "msg-user" : "msg-agent"}`}
          >
            <span className="msg-label">
              {item.sender === "ai" && <span className="avatar">AI</span>}
              {item.sender === "user" ? "You" : "Agent"}
            </span>

            {item.sender === "user" && (
              <div className="bubble bubble-user">{item.text}</div>
            )}

            {item.sender === "ai" && item.text && (
              <div className="bubble bubble-agent">{item.text}</div>
            )}

            {item.sender === "ai" && item.data && (
              <>
                {item.data.needsClarification && (
                  <div className="bubble bubble-agent">
                    I could not tell which product you meant. Could you name it?
                  </div>
                )}

                {(item.data.unavailableItems?.length ?? 0) > 0 && (
                  <div className="card card-warn">
                    <div className="card-title">Cannot be ordered</div>

                    {item.data.unavailableItems.map((product, i) => (
                      <div className="warn-item" key={i}>
                        <span>{product.name}</span>
                        <span className="warn-reason">{product.reason}</span>
                      </div>
                    ))}

                    {(item.data.validatedItems?.length ?? 0) === 0 && (
                      <p className="note">
                        Nothing in this request can be ordered. Try different
                        items or quantities.
                      </p>
                    )}
                  </div>
                )}

                {(item.data.validatedItems?.length ?? 0) > 0 && (
                  <div className="card">
                    <div className="card-title">Order proposal</div>

                    {item.data.validatedItems.map((product) => (
                      <div className="line-item" key={product.id}>
                        <span>
                          {product.name}{" "}
                          <span className="qty">x {product.quantity}</span>
                        </span>
                        <span className="amount">₹{product.subtotal}</span>
                      </div>
                    ))}

                    <div className="total-row">
                      <span>Total</span>
                      <span>₹{item.data.total}</span>
                    </div>

                    {item.data.limit?.exceeded && (
                      <div className="limit-note">
                        <strong>Over the spending limit.</strong> This order
                        comes to ₹{item.data.total}, above the ₹
                        {item.data.limit.maxOrderValue} ceiling for a single
                        order. The agent cannot raise it — remove an item or
                        reduce a quantity.
                      </div>
                    )}

                    <button
                      className="btn"
                      onClick={() => handleConfirmOrder(item.data, index)}
                      disabled={
                        confirmingIndex !== null ||
                        confirmedIndexes.includes(index) ||
                        item.data.limit?.exceeded
                      }
                    >
                      {confirmedIndexes.includes(index)
                        ? "Order confirmed"
                        : confirmingIndex === index
                        ? "Confirming..."
                        : item.data.limit?.exceeded
                        ? "Blocked by spending limit"
                        : (item.data.unavailableItems?.length ?? 0) > 0
                        ? "Confirm available items only"
                        : "Confirm order"}
                    </button>

                    {orderState[index] && (
                      <>
                        <div
                          className={`status ${statusClass(
                            orderState[index].status
                          )}`}
                        >
                          <span className="status-dot" />
                          {statusLabel(orderState[index].status)}
                        </div>

                        {orderState[index].note && (
                          <div className="note">{orderState[index].note}</div>
                        )}

                        {orderState[index].orderId && (
                          <div className="status-meta">
                            order {orderState[index].orderId}
                            {orderState[index].paymentId
                              ? ` / ${orderState[index].paymentId}`
                              : ""}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {loading && (
          <>
            <div className="thinking">
              <span />
              <span />
              <span />
              Agent is reading your order
            </div>
            <div className="thinking-bar">
              <span />
            </div>
          </>
        )}
      </div>

      <div className="composer">
        <input
          type="text"
          placeholder="Type your order..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSend();
            }
          }}
        />

        <button onClick={() => handleSend()} disabled={loading}>
          {loading ? "Thinking..." : "Send"}
        </button>
      </div>
    </div>
  );
}

export default App;