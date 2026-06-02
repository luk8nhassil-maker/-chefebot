"use client";

interface ChatBubbleProps {
  message: string;
  sender: "customer" | "bot";
  time: string;
}

function formatMessage(text: string) {
  return text
    .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

export function ChatBubble({ message, sender, time }: ChatBubbleProps) {
  const isBot = sender === "bot";

  return (
    <div className={`flex ${isBot ? "justify-start" : "justify-end"} mb-2`}>
      {isBot && (
        <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 shrink-0">
          🍕
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 shadow-sm ${
          isBot
            ? "bg-white text-gray-800 rounded-tl-none"
            : "bg-green-500 text-white rounded-tr-none"
        }`}
      >
        <div
          className="text-sm leading-relaxed whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: formatMessage(message) }}
        />
        <div
          className={`text-[10px] mt-1 text-right ${
            isBot ? "text-gray-400" : "text-green-100"
          }`}
        >
          {time}
        </div>
      </div>
    </div>
  );
}
