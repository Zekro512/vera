import { useState } from "react";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
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

  const handleConfirmOrder = async (orderData) => {
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
        alert(orderResult.message || "Could not save the order.");
        return;
      }

      const savedOrder = orderResult.order;

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
        alert(paymentResult.message || "Could not start the payment.");
        return;
      }

      if (!window.Razorpay) {
        alert("Razorpay Checkout did not load. Check your internet connection.");
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

            alert(
              verifyResponse.ok
                ? `Payment verified. Order status: ${verifyResult.status}.`
                : `Payment could not be verified: ${verifyResult.message}`
            );
          } catch (error) {
            console.error("Verification error:", error);

            alert(
              "Payment went through but verification could not be reached. The order stays payment_pending."
            );
          }
        },
        modal: {
          ondismiss: () => {
            reportAbandonedPayment(savedOrder._id, "cancelled", "Customer closed Checkout");

            alert("Payment cancelled. The order has been marked cancelled.");
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

        alert(`Payment failed: ${response.error?.description}`);
      });

      checkout.open();
    } catch (error) {
      console.error("Order confirmation error:", error);

      alert("Something went wrong while confirming the order.");
    }
  };

  const handleSend = async () => {
    if (!message.trim()) return;

    const userMessage = message;

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

      // Add structured AI response
      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          data: data,
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
    <div>
      <h1>AI Commerce Agent</h1>
      <p>Chat with our AI assistant to place your order.</p>

      <div>
        {messages.map((item, index) => (
          <div key={index}>
            <strong>{item.sender === "user" ? "You" : "AI"}:</strong>

            {item.sender === "user" && <p>{item.text}</p>}

            {item.sender === "ai" && item.data && (
              <div>
                {item.data.needsClarification && (
                  <p>Please provide more specific product details.</p>
                )}

                {item.data.validatedItems.length > 0 &&
                 item.data.unavailableItems.length === 0 && (
                  <div>
                    <h3>Available Items</h3>

                    {item.data.validatedItems.map((product) => (
                      <div key={product.id}>
                        <p>
                          {product.name} × {product.quantity} — ₹
                          {product.subtotal}
                        </p>
                        
                      </div>
                      
                    ))}

                    <h3>Total: ₹{item.data.total}</h3>
                    <button onClick={() => handleConfirmOrder(item.data)}>
                      Confirm Order
                       </button>
                  </div>
                )}

                {item.data.unavailableItems.length > 0 && (
                  <div>
                    <h3>Unavailable Items</h3>

                    {item.data.unavailableItems.map((product, i) => (
                      <p key={i}>
                        {product.name} — {product.reason}
                      </p>
                    ))}
                    
                  </div>
                )}
              </div>
            )}

            {item.sender === "ai" && item.text && <p>{item.text}</p>}
          </div>
        ))}
        {loading && <p>AI is thinking...</p>}
        
      </div>

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

      <button onClick={handleSend} disabled={loading}>
       {loading ? "Thinking..." : "Send"}
   </button>
    </div>
  );
}

export default App;