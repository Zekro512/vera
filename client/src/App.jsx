import { useState } from "react";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const handleConfirmOrder = async (orderData) => {
  try {
    const response = await fetch("http://localhost:5000/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderData),
    });

    const data = await response.json();

    console.log("Order response:", data);

    alert(data.message);
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