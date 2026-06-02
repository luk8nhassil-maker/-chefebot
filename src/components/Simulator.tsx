"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatBubble } from "./ChatBubble";
import { BotSession, getWelcomeMessages } from "@/lib/bot";

interface Message {
  id: string;
  content: string;
  sender: "customer" | "bot";
  time: string;
}

function now() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function uid() {
  return Math.random().toString(36).slice(2);
}

export function Simulator() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [session, setSession] = useState<BotSession | null>(null);
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState("5511999999999");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startConversation = useCallback(() => {
    const welcome = getWelcomeMessages();
    const botMessages: Message[] = welcome.map((m) => ({
      id: uid(),
      content: m,
      sender: "bot",
      time: now(),
    }));
    setMessages(botMessages);
    setSession({ step: "size", cart: [], deliveryFee: 0 });
    setStarted(true);
  }, []);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setSession(null);
    setStarted(false);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      id: uid(),
      content: input.trim(),
      sender: "customer",
      time: now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    const sentInput = input.trim();
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: sentInput,
          session,
          phone,
        }),
      });

      const data = await res.json();
      setSession(data.session);

      const botMessages: Message[] = data.messages.map((m: string) => ({
        id: uid(),
        content: m,
        sender: "bot",
        time: now(),
      }));

      setMessages((prev) => [...prev, ...botMessages]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          content: "Erro ao processar mensagem. Tente novamente.",
          sender: "bot",
          time: now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, session, phone]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const stepLabel: Record<string, string> = {
    welcome: "Boas-vindas",
    size: "Tamanho",
    flavor: "Sabor",
    border: "Borda",
    add_more: "Mais itens",
    delivery_type: "Tipo de entrega",
    neighborhood: "Bairro",
    payment: "Pagamento",
    confirm: "Confirmação",
    done: "Concluído",
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-green-700 text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-2xl">
          🍕
        </div>
        <div className="flex-1">
          <div className="font-bold text-base">Chefe da Pizza</div>
          <div className="text-green-200 text-xs">
            {session
              ? `Etapa: ${stepLabel[session.step] ?? session.step}`
              : "Simulador de Atendimento"}
          </div>
        </div>
        <div className="flex gap-2">
          {started && (
            <button
              type="button"
              onClick={resetConversation}
              className="text-xs bg-green-600 hover:bg-green-500 px-3 py-1 rounded-full transition"
              style={{ touchAction: "manipulation" }}
            >
              Reiniciar
            </button>
          )}
        </div>
      </div>

      {/* Phone input */}
      <div className="bg-green-50 border-b border-green-100 px-4 py-2 flex items-center gap-2">
        <span className="text-xs text-gray-500">Telefone:</span>
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1 w-40 font-mono"
          placeholder="5511999999999"
          disabled={started}
        />
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 bg-[#e5ddd5] bg-opacity-50" style={{ WebkitOverflowScrolling: "touch" }}>
        {!started ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-6xl">🍕</div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-700">
                Simulador ChefBot
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Simule o atendimento via WhatsApp da Chefe da Pizza
              </p>
            </div>
            <button
              type="button"
              onClick={startConversation}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-full shadow-lg transition"
              style={{ touchAction: "manipulation" }}
            >
              Iniciar Conversa
            </button>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg.content}
                sender={msg.sender}
                time={msg.time}
              />
            ))}
            {loading && (
              <div className="flex justify-start mb-2">
                <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1">
                  🍕
                </div>
                <div className="bg-white rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      {started && (
        <div className="bg-gray-100 border-t border-gray-200 p-3 flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || session?.step === "done"}
            placeholder={
              session?.step === "done"
                ? "Pedido finalizado — reinicie para novo pedido"
                : "Digite sua mensagem..."
            }
            className="flex-1 bg-white border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={loading || !input.trim() || session?.step === "done"}
            className="w-10 h-10 rounded-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 flex items-center justify-center transition shadow-sm"
            style={{ touchAction: "manipulation" }}
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
