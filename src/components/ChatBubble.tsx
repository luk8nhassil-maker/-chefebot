"use client";

interface ChatBubbleProps {
  message: string;
  sender: "bot" | "customer";
  timestamp?: string;
}

export default function ChatBubble({ message, sender, timestamp }: ChatBubbleProps) {
  const isCustomer = sender === "customer";
  const time = timestamp || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`flex ${isCustomer ? "justify-end" : "justify-start"} mb-1 px-2`}>
      <div
        style={{
          backgroundColor: isCustomer ? "#DCF8C6" : "#FFFFFF",
          maxWidth: "75%",
          borderRadius: isCustomer ? "12px 0px 12px 12px" : "0px 12px 12px 12px",
          padding: "6px 10px 4px 10px",
          boxShadow: "0 1px 1px rgba(0,0,0,0.13)",
          position: "relative",
        }}
      >
        <p style={{ fontSize: "14px", color: "#111", margin: 0, lineHeight: "19px", whiteSpace: "pre-wrap" }}>
          {message}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "3px", marginTop: "2px" }}>
          <span style={{ fontSize: "11px", color: "#888", lineHeight: 1 }}>{time}</span>
          {isCustomer && (
            <span style={{ color: "#53bdeb", fontSize: "13px", lineHeight: 1 }}>✓✓</span>
          )}
        </div>
      </div>
    </div>
  );
}