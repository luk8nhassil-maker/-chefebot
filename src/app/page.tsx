"use client";
import { useEffect, useState } from "react";

export default function LandingPage() {
  const [visible, setVisible] = useState(false);
  const [digitando, setDigitando] = useState(0);

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    const intervalo = setInterval(() => {
      setDigitando(prev => (prev + 1) % 5);
    }, 2500);
    return () => clearInterval(intervalo);
  }, []);

  const whatsapp = "5599974000691";
  const mensagem = encodeURIComponent("Olá! Vi a Ominix e quero saber mais sobre o sistema de pedidos pelo WhatsApp para minha pizzaria.");
  const ctaLink = `https://wa.me/${whatsapp}?text=${mensagem}`;

  const msgs = [
    { texto: "Oi! Bem-vindo à Chefe da Pizza! 👋\nMe fala seu nome pra gente começar?", bot: true },
    { texto: "João", bot: false },
    { texto: "Prazer, João! 😊 O que vai ser hoje?\n\n1. Pizza\n2. Lanches\n3. Bebidas", bot: true },
    { texto: "1 pizza grande calabresa com borda catupiry", bot: false },
    { texto: "Pizza G Calabresa + Borda Catupiry! 🍕\n\nSubtotal: R$ 60,00\n\nVai querer mais alguma coisa?", bot: true },
  ];

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif", background: "var(--surface)", minHeight: "100vh", color: "var(--foreground)", overflowX: "hidden" }}>

      {/* HERO */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px 40px", textAlign: "center", background: "radial-gradient(ellipse at top, var(--background) 0%, var(--surface) 60%)", position: "relative" }}>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "color-mix(in srgb, var(--whatsapp) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--whatsapp) 30%, transparent)", borderRadius: 20, padding: "6px 16px", marginBottom: 32, opacity: visible ? 1 : 0, transition: "opacity 0.8s" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 13, color: "color-mix(in srgb, var(--whatsapp) 90%, transparent)", fontWeight: 600 }}>Mais de 200 pedidos atendidos por noite</span>
        </div>

        <h1 style={{ fontSize: "clamp(32px, 7vw, 64px)", fontWeight: 900, lineHeight: 1.1, margin: "0 0 24px", maxWidth: 700, opacity: visible ? 1 : 0, transition: "opacity 0.8s 0.2s" }}>
          Seu cliente faz o pedido{" "}
          <span style={{ color: "var(--whatsapp)" }}>direto pelo WhatsApp.</span>{" "}
          <span style={{ color: "rgba(var(--overlay-rgb), 0.4)" }}>Do jeito que ele já prefere.</span>
        </h1>

        <p style={{ fontSize: "clamp(16px, 2.5vw, 20px)", color: "rgba(var(--overlay-rgb), 0.55)", maxWidth: 560, lineHeight: 1.6, margin: "0 0 40px", opacity: visible ? 1 : 0, transition: "opacity 0.8s 0.4s" }}>
          A Ominix coloca um atendente robô no WhatsApp da sua pizzaria — que conversa como gente, anota o pedido completo e avisa sua equipe em tempo real.
        </p>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, opacity: visible ? 1 : 0, transition: "opacity 0.8s 0.6s" }}>
          <a href={ctaLink} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "var(--whatsapp)", color: "var(--whatsapp-foreground)", padding: "16px 32px", borderRadius: 14, fontSize: 17, fontWeight: 800, textDecoration: "none", boxShadow: "0 4px 24px color-mix(in srgb, var(--whatsapp) 40%, transparent)" }}>
            <WhatsAppIcon />
            Quero para minha pizzaria
          </a>
          <p style={{ fontSize: 13, color: "rgba(var(--overlay-rgb), 0.3)", margin: 0 }}>Resposta em menos de 1 hora · Instalação gratuita</p>
        </div>

        {/* Mockup animado */}
        <div style={{ marginTop: 60, width: "100%", maxWidth: 340, background: "#ece5dd", borderRadius: 20, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", opacity: visible ? 1 : 0, transition: "opacity 0.8s 0.8s" }}>
          <div style={{ background: "var(--whatsapp)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--whatsapp)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🍕</div>
            <div>
              <p style={{ color: "var(--whatsapp-foreground)", fontWeight: 700, margin: 0, fontSize: 14 }}>Chefe da Pizza</p>
              <p style={{ color: "rgba(255,255,255,0.75)", margin: 0, fontSize: 11 }}>online agora</p>
            </div>
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, minHeight: 280 }}>
            {msgs.slice(0, digitando + 1).map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.bot ? "flex-start" : "flex-end", animation: "fadeIn 0.3s ease" }}>
                <div style={{ background: msg.bot ? "var(--foreground)" : "var(--success)", borderRadius: msg.bot ? "0 12px 12px 12px" : "12px 0 12px 12px", padding: "8px 12px", maxWidth: "85%", fontSize: 13, color: "var(--surface)", lineHeight: 1.4, whiteSpace: "pre-line", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>
                  {msg.texto}
                </div>
              </div>
            ))}
            {digitando < msgs.length - 1 && (
              <div style={{ display: "flex", justifyContent: msgs[digitando + 1]?.bot ? "flex-start" : "flex-end" }}>
                <div style={{ background: "var(--foreground)", borderRadius: "0 12px 12px 12px", padding: "10px 14px", fontSize: 13 }}>
                  <span style={{ display: "inline-flex", gap: 3 }}>
                    {[0, 1, 2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--foreground-secondary)", display: "inline-block", animation: `bounce 1s ${i * 0.2}s infinite` }} />)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* DOR */}
      <section style={{ padding: "80px 24px", background: "var(--surface)", textAlign: "center" }}>
        <p style={{ color: "var(--brand-text)", fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>O problema que todo dono de pizzaria conhece</p>
        <h2 style={{ fontSize: "clamp(24px, 5vw, 42px)", fontWeight: 900, maxWidth: 600, margin: "0 auto 48px", lineHeight: 1.2 }}>
          Seu cliente odeia clicar em link para fazer pedido.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, maxWidth: 800, margin: "0 auto" }}>
          {[
            { emoji: "😤", titulo: "\"Não consigo abrir o link\"", desc: "O cliente desiste antes de finalizar. Você perde a venda sem nem saber." },
            { emoji: "📱", titulo: "\"Prefiro mandar mensagem\"", desc: "95% dos seus clientes já estão no WhatsApp. Por que tirar eles de lá?" },
            { emoji: "😴", titulo: "\"Ninguém respondeu\"", desc: "Sua atendente não consegue responder todo mundo ao mesmo tempo." },
          ].map((item, i) => (
            <div key={i} style={{ background: "var(--surface-secondary)", border: "1px solid var(--surface-elevated)", borderRadius: 16, padding: 28, textAlign: "left" }}>
              <p style={{ fontSize: 36, margin: "0 0 12px" }}>{item.emoji}</p>
              <p style={{ fontWeight: 800, fontSize: 16, margin: "0 0 8px", color: "var(--foreground)" }}>{item.titulo}</p>
              <p style={{ fontSize: 14, color: "rgba(var(--overlay-rgb), 0.5)", margin: 0, lineHeight: 1.6 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SOLUÇÃO */}
      <section style={{ padding: "80px 24px", textAlign: "center", background: "var(--surface)" }}>
        <p style={{ color: "var(--whatsapp)", fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>A solução</p>
        <h2 style={{ fontSize: "clamp(24px, 5vw, 42px)", fontWeight: 900, maxWidth: 600, margin: "0 auto 16px", lineHeight: 1.2 }}>
          Um atendente que nunca dorme, nunca erra e nunca deixa cliente sem resposta.
        </h2>
        <p style={{ fontSize: 17, color: "rgba(var(--overlay-rgb), 0.5)", maxWidth: 500, margin: "0 auto 60px", lineHeight: 1.6 }}>
          A Ominix coloca um robô humanizado no WhatsApp da sua pizzaria em menos de 24 horas.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, maxWidth: 800, margin: "0 auto" }}>
          {[
            { num: "01", titulo: "Cliente manda mensagem", desc: "No WhatsApp de sempre, sem baixar nada, sem clicar em link." },
            { num: "02", titulo: "Robô anota tudo", desc: "Sabor, tamanho, borda, endereço, pagamento. Tudo certinho, sem erro." },
            { num: "03", titulo: "Sua equipe vê na tela", desc: "Pedido aparece no painel em tempo real. É só preparar e entregar." },
          ].map((item, i) => (
            <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 16, padding: 28, textAlign: "left" }}>
              <p style={{ fontSize: 48, fontWeight: 900, color: "color-mix(in srgb, var(--primary) 15%, transparent)", margin: "0 0 16px", lineHeight: 1 }}>{item.num}</p>
              <p style={{ fontWeight: 800, fontSize: 16, margin: "0 0 8px", color: "var(--foreground)" }}>{item.titulo}</p>
              <p style={{ fontSize: 14, color: "rgba(var(--overlay-rgb), 0.5)", margin: 0, lineHeight: 1.6 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* INCLUSO */}
      <section style={{ padding: "80px 24px", background: "var(--surface)", textAlign: "center" }}>
        <p style={{ color: "var(--brand-text)", fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Tudo incluso</p>
        <h2 style={{ fontSize: "clamp(24px, 5vw, 38px)", fontWeight: 900, maxWidth: 500, margin: "0 auto 48px", lineHeight: 1.2 }}>
          Plug and play. Instala hoje, vende amanhã.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, maxWidth: 700, margin: "0 auto" }}>
          {[
            { emoji: "🤖", titulo: "Robô no WhatsApp", desc: "Atende 24h, anota pedidos e reconhece clientes que já pediram antes." },
            { emoji: "📋", titulo: "Painel de pedidos", desc: "Sua equipe vê e avança o status de cada pedido em tempo real." },
            { emoji: "👑", titulo: "Painel do dono", desc: "Veja quanto você ganhou hoje, quantas pizzas vendeu e seus clientes fiéis." },
            { emoji: "💸", titulo: "Pix automático", desc: "Cliente escolhe Pix e recebe a chave na hora, sem precisar perguntar." },
          ].map((item, i) => (
            <div key={i} style={{ background: "var(--surface-secondary)", border: "1px solid var(--surface-elevated)", borderRadius: 14, padding: "20px 16px", textAlign: "left" }}>
              <p style={{ fontSize: 28, margin: "0 0 10px" }}>{item.emoji}</p>
              <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 6px", color: "var(--foreground)" }}>{item.titulo}</p>
              <p style={{ fontSize: 13, color: "rgba(var(--overlay-rgb), 0.45)", margin: 0, lineHeight: 1.5 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PREÇO */}
      <section style={{ padding: "80px 24px", textAlign: "center", background: "var(--surface)" }}>
        <p style={{ color: "var(--whatsapp)", fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Investimento</p>
        <h2 style={{ fontSize: "clamp(24px, 5vw, 38px)", fontWeight: 900, maxWidth: 500, margin: "0 auto 16px" }}>
          R$ 5 por dia. Menos que um cafezinho.
        </h2>
        <p style={{ fontSize: 16, color: "rgba(var(--overlay-rgb), 0.45)", maxWidth: 400, margin: "0 auto 48px", lineHeight: 1.6 }}>
          Uma atendente humana custa R$ 1.500/mês e não trabalha de madrugada. A Ominix custa R$ 150/mês e nunca para.
        </p>
        <div style={{ display: "inline-block", background: "linear-gradient(135deg, var(--background), var(--surface))", border: "2px solid color-mix(in srgb, var(--primary) 30%, transparent)", borderRadius: 24, padding: "40px 48px", maxWidth: 360, width: "100%" }}>
          <div style={{ background: "color-mix(in srgb, var(--whatsapp) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--whatsapp) 30%, transparent)", borderRadius: 10, padding: "8px 16px", marginBottom: 20, display: "inline-block" }}>
            <p style={{ color: "var(--whatsapp)", fontSize: 13, fontWeight: 700, margin: 0 }}>🎁 Instalação gratuita para os 3 primeiros clientes</p>
          </div>
          <p style={{ color: "rgba(var(--overlay-rgb), 0.4)", fontSize: 14, margin: "0 0 8px" }}>por pizzaria / por mês</p>
          <p style={{ color: "var(--brand-text)", fontSize: 64, fontWeight: 900, margin: "0 0 4px", lineHeight: 1 }}>R$150</p>
          <p style={{ color: "rgba(var(--overlay-rgb), 0.4)", fontSize: 13, margin: "0 0 32px" }}>sem taxa de instalação · sem contrato</p>
          <a href={ctaLink} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", background: "var(--whatsapp)", color: 'var(--whatsapp-foreground)', padding: "16px 0", borderRadius: 12, fontSize: 16, fontWeight: 800, textDecoration: "none", boxShadow: "0 4px 20px color-mix(in srgb, var(--whatsapp) 30%, transparent)" }}>
            Garantir minha vaga
          </a>
          <p style={{ fontSize: 12, color: "rgba(var(--overlay-rgb), 0.25)", margin: "12px 0 0" }}>Resposta em menos de 1 hora</p>
        </div>
      </section>

      {/* CTA FINAL */}
      <section style={{ padding: "80px 24px", textAlign: "center", background: "radial-gradient(ellipse at center, var(--background) 0%, var(--surface) 70%)" }}>
        <h2 style={{ fontSize: "clamp(28px, 6vw, 52px)", fontWeight: 900, maxWidth: 600, margin: "0 auto 16px", lineHeight: 1.2 }}>
          Sua pizzaria merece um atendente que{" "}
          <span style={{ color: "var(--whatsapp)" }}>nunca decepciona.</span>
        </h2>
        <p style={{ fontSize: 17, color: "rgba(var(--overlay-rgb), 0.45)", maxWidth: 440, margin: "0 auto 40px", lineHeight: 1.6 }}>
          Fale com a gente agora. Em menos de 24 horas seu robô já está atendendo no WhatsApp.
        </p>
        <a href={ctaLink} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "var(--whatsapp)", color: 'var(--whatsapp-foreground)', padding: "18px 36px", borderRadius: 14, fontSize: 18, fontWeight: 800, textDecoration: "none", boxShadow: "0 4px 24px color-mix(in srgb, var(--whatsapp) 40%, transparent)" }}>
          <WhatsAppIcon />
          Falar com a Ominix agora
        </a>
      </section>

      {/* FOOTER */}
      <footer style={{ padding: "24px", textAlign: "center", borderTop: "1px solid var(--surface-secondary)" }}>
        <p style={{ color: "rgba(var(--overlay-rgb), 0.2)", fontSize: 13, margin: 0 }}>© 2025 Ominix · Todos os direitos reservados</p>
      </footer>

      {/* BOTÃO FLUTUANTE MOBILE */}
      <div style={{ position: "fixed", bottom: 20, left: 16, right: 16, zIndex: 9999, display: "flex", justifyContent: "center" }}>
        <a href={ctaLink} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "var(--whatsapp)", color: 'var(--whatsapp-foreground)', padding: "14px 28px", borderRadius: 50, fontSize: 15, fontWeight: 800, textDecoration: "none", boxShadow: "0 4px 24px color-mix(in srgb, var(--whatsapp) 50%, transparent)", width: "100%", maxWidth: 360, justifyContent: "center" }}>
          <WhatsAppIcon />
          Falar com a Ominix
        </a>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        body { margin: 0; padding-bottom: 80px; }
      `}</style>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}