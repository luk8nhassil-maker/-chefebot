"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import ChatBubble from "./ChatBubble";
import { BotSession, createInitialSession } from "@/lib/bot";

interface Message {
  id: string;
  content: string;
  sender: "customer" | "bot";
  time: string;
}

function now() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function uid() {
  return Math.random().toString(36).slice(2);
}

export function Simulator({ fullScreen = false }: { fullScreen?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [session, setSession] = useState<BotSession | null>(null);
  const [input, setInput] = useState("");
  const [phone] = useState("55119999999999");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const addBotMessages = useCallback((texts: string[]) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      const botMsgs: Message[] = texts.map((content) => ({
        id: uid(),
        content,
        sender: "bot",
        time: now(),
      }));
      setMessages((prev) => [...prev, ...botMsgs]);
    }, 800);
  }, []);

  const handleStart = useCallback(async () => {
    setStarted(true);
    setLoading(true);
    const initialSession = createInitialSession();
    try {
      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "oi", session: initialSession, phone }),
      });
      const data = await res.json();
      setSession(data.session);
      addBotMessages(data.messages);
    } catch {
      addBotMessages(["Erro ao conectar. Tente novamente."]);
    } finally {
      setLoading(false);
    }
  }, [addBotMessages, phone]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || !session) return;
    const userMsg: Message = { id: uid(), content: input.trim(), sender: "customer", time: now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.trim(), session, phone }),
      });
      const data = await res.json();
      setSession(data.session);
      addBotMessages(data.messages);
    } catch {
      addBotMessages(["Erro ao conectar. Tente novamente."]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, session, phone, addBotMessages]);

  const containerStyle = fullScreen
    ? { display: "flex", flexDirection: "column" as const, height: "100%", width: "100%" }
    : { display: "flex", flexDirection: "column" as const, height: "600px", maxWidth: "400px", margin: "0 auto", borderRadius: "16px", overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", border: "1px solid var(--foreground)" };

  const inputBarStyle = fullScreen
    ? { position: "fixed" as const, bottom: 0, left: 0, right: 0, background: "var(--foreground)", padding: "10px 12px", display: "flex", alignItems: "center", gap: "8px", borderTop: "1px solid var(--foreground)", zIndex: 100 }
    : { background: "var(--foreground)", padding: "10px 12px", display: "flex", alignItems: "center", gap: "8px", borderTop: "1px solid var(--foreground)", flexShrink: 0 as const };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ background: "var(--whatsapp)", padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
        <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "var(--whatsapp)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>🍕</div>
        <div>
          <p style={{ color: "white", fontWeight: 600, fontSize: "15px", margin: 0 }}>Chefe da Pizza</p>
          <p style={{ color: "var(--info)", fontSize: "12px", margin: 0 }}>{started ? (typing ? "digitando..." : "online") : "Atendimento via WhatsApp"}</p>
        </div>
      </div>

      {/* Mensagens */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", background: "var(--primary)", display: "flex", flexDirection: "column", gap: "4px", paddingBottom: started && fullScreen ? "80px" : "12px" }}>
        {!started && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px" }}>
            <div style={{ fontSize: "48px" }}>🍕</div>
            <p style={{ color: "var(--foreground-muted)", fontSize: "14px", textAlign: "center", maxWidth: "260px" }}>Simule um pedido pelo WhatsApp da Chefe da Pizza</p>
            <button
              type="button"
              onClick={handleStart}
              style={{ background: "var(--whatsapp)", color: "white", border: "none", borderRadius: "24px", padding: "12px 28px", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}
            >
              Iniciar conversa
            </button>
          </div>
        )}
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg.content} sender={msg.sender} timestamp={msg.time} />
        ))}
        {typing && (
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 12px", background: "white", borderRadius: "12px", borderBottomLeftRadius: "4px", alignSelf: "flex-start", maxWidth: "80px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--foreground-secondary)", animation: "bounce 1s infinite" }}></span>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--foreground-secondary)", animation: "bounce 1s infinite 0.2s" }}></span>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--foreground-secondary)", animation: "bounce 1s infinite 0.4s" }}></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {started && (
        <div style={inputBarStyle}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Digite uma mensagem"
            disabled={loading || typing}
            style={{ flex: 1, border: "none", borderRadius: "24px", padding: "12px 16px", fontSize: "16px", outline: "none", background: "white" }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || typing || !input.trim()}
            style={{ width: "48px", height: "48px", borderRadius: "50%", background: input.trim() ? "var(--whatsapp)" : "var(--foreground)", border: "none", cursor: input.trim() ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}
          >
            ➤
          </button>
        </div>
      )}

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}