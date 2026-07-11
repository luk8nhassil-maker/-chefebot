import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ChefeBot — Seu restaurante no WhatsApp",
  description:
    "Automatize pedidos, gerencie entregas e receba pelo Pix — tudo pelo WhatsApp. Sem aplicativo, sem complicação.",
};

const WA_CTA =
  "https://wa.me/5599974000691?text=Ol%C3%A1!%20Tenho%20interesse%20no%20ChefeBot%20para%20minha%20pizzaria.";

const CARDS = [
  {
    icon: "🤖",
    title: "Pedidos automáticos 24h",
    desc: "O bot recebe, confirma e organiza cada pedido pelo WhatsApp — mesmo enquanto você dorme.",
  },
  {
    icon: "📱",
    title: "Painel profissional",
    desc: "Visualize todos os pedidos em tempo real, gerencie entregadores e acompanhe o financeiro numa tela só.",
  },
  {
    icon: "⚡",
    title: "Pix automático",
    desc: "Gera QR Code Pix no próprio chat, confirma o pagamento e avança o pedido sem intervenção manual.",
  },
];

const TESTIMONIALS = [
  {
    initial: "J",
    name: "João Silva",
    place: "Pizzaria do João • São Paulo, SP",
    text: "Antes eu perdia pedido todo dia. Agora o bot atende sozinho e eu só faço as pizzas.",
  },
  {
    initial: "M",
    name: "Maria Oliveira",
    place: "Pizzaria da Mari • Belo Horizonte, MG",
    text: "O Pix automático foi um divisor de águas. Recebi 40 pedidos no sábado sem pegar no celular uma vez.",
  },
  {
    initial: "C",
    name: "Carlos Mendes",
    place: "Sabor da Serra • Curitiba, PR",
    text: "Minha equipe ficou mais tranquila. O painel mostra tudo em tempo real e os entregadores sabem exatamente onde ir.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Conecte seu WhatsApp",
    desc: "Escaneie o QR Code uma vez e seu número fica conectado ao ChefeBot em segundos.",
  },
  {
    n: "02",
    title: "Configure seu cardápio",
    desc: "Adicione produtos, preços e categorias pelo painel. O bot já começa a atender automaticamente.",
  },
  {
    n: "03",
    title: "Receba pedidos e Pix",
    desc: "Seus clientes pedem pelo WhatsApp que já usam. Você recebe o pagamento e confirma a entrega.",
  },
];

export default function SobrePage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;700;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html { scroll-behavior: smooth; }

        body {
          background: var(--background);
          color: var(--foreground);
          font-family: 'Archivo', sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        /* ── Animations ──────────────────────────────── */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }

        /* ── Layout helpers ──────────────────────────── */
        .container {
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
          padding: 0 24px;
        }

        /* ── Header ──────────────────────────────────── */
        .site-header {
          position: sticky;
          top: 0;
          z-index: 100;
          background: color-mix(in srgb, var(--background) 88%, transparent);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--surface);
          padding-top: env(safe-area-inset-top);
        }
        .header-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 60px;
          gap: 16px;
        }
        .header-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          flex-shrink: 0;
        }
        .header-pizza {
          width: 36px;
          height: 36px;
          background: linear-gradient(145deg, var(--primary), var(--primary));
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          line-height: 1;
          flex-shrink: 0;
        }
        .header-name {
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: 20px;
          font-weight: 900;
          color: var(--foreground);
          letter-spacing: -0.5px;
        }
        .header-login {
          color: var(--foreground-secondary);
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          padding: 8px 16px;
          border: 1px solid var(--surface-secondary);
          border-radius: 10px;
          transition: color 0.15s, border-color 0.15s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .header-login:hover { color: var(--foreground); border-color: var(--border-strong); }

        /* ── Hero ────────────────────────────────────── */
        .hero {
          padding: 80px 0 72px;
          text-align: center;
          background-image:
            radial-gradient(ellipse 80% 55% at 50% -5%,
              color-mix(in srgb, var(--primary) 10%, transparent) 0%, transparent 65%);
          animation: fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) both;
        }
        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: color-mix(in srgb, var(--primary) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary) 22%, transparent);
          border-radius: 100px;
          padding: 5px 14px 5px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--brand-text);
          letter-spacing: 0.4px;
          text-transform: uppercase;
          margin-bottom: 28px;
        }
        .hero-badge-dot {
          width: 7px;
          height: 7px;
          background: var(--primary);
          border-radius: 50%;
          animation: float 2s ease-in-out infinite;
          flex-shrink: 0;
        }
        .hero-h1 {
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: clamp(32px, 7vw, 62px);
          font-weight: 900;
          color: var(--foreground);
          letter-spacing: -2px;
          line-height: 1.08;
          margin-bottom: 22px;
          max-width: 720px;
          margin-left: auto;
          margin-right: auto;
        }
        .hero-h1 span { color: var(--brand-text); }
        .hero-sub {
          color: var(--foreground-secondary);
          font-size: clamp(15px, 3vw, 18px);
          font-weight: 400;
          line-height: 1.65;
          max-width: 520px;
          margin: 0 auto 40px;
        }
        .hero-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          height: 58px;
          padding: 0 36px;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary) 100%);
          color: var(--foreground);
          font-family: 'Archivo', sans-serif;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.3px;
          border-radius: 16px;
          text-decoration: none;
          box-shadow: 0 8px 32px color-mix(in srgb, var(--primary) 40%, transparent), 0 2px 8px color-mix(in srgb, var(--primary) 20%, transparent);
          transition: opacity 0.18s, transform 0.15s, box-shadow 0.18s;
          -webkit-tap-highlight-color: transparent;
        }
        .hero-cta:hover {
          opacity: 0.9;
          transform: translateY(-2px);
          box-shadow: 0 12px 40px color-mix(in srgb, var(--primary) 52%, transparent), 0 4px 12px color-mix(in srgb, var(--primary) 28%, transparent);
        }
        .hero-cta:active { transform: scale(0.97); opacity: 1; }
        .hero-stats {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 24px;
          margin-top: 40px;
          flex-wrap: wrap;
        }
        .hero-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .hero-stat-n {
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: 22px;
          font-weight: 900;
          color: var(--foreground);
          letter-spacing: -0.8px;
        }
        .hero-stat-l {
          font-size: 12px;
          color: var(--border-strong);
          font-weight: 500;
          margin-top: 2px;
        }
        .hero-divider {
          width: 1px;
          height: 32px;
          background: var(--border);
        }

        /* ── Divider line ────────────────────────────── */
        .section-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border) 20%, var(--border) 80%, transparent);
          margin: 0 24px;
        }

        /* ── Features ────────────────────────────────── */
        .features {
          padding: 80px 0;
        }
        .section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--brand-text);
          margin-bottom: 14px;
          opacity: 0.85;
        }
        .section-title {
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: clamp(26px, 5vw, 40px);
          font-weight: 900;
          color: var(--foreground);
          letter-spacing: -1.2px;
          line-height: 1.1;
          margin-bottom: 48px;
          max-width: 480px;
        }
        .cards-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .feat-card {
          background: var(--surface);
          border: 1px solid var(--surface);
          border-radius: 20px;
          padding: 28px 24px;
          transition: border-color 0.2s, transform 0.2s;
        }
        .feat-card:hover {
          border-color: color-mix(in srgb, var(--primary) 20%, transparent);
          transform: translateY(-2px);
        }
        .feat-icon {
          width: 52px;
          height: 52px;
          background: color-mix(in srgb, var(--primary) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary) 15%, transparent);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          margin-bottom: 20px;
          line-height: 1;
          flex-shrink: 0;
        }
        .feat-title {
          font-size: 18px;
          font-weight: 800;
          color: var(--foreground);
          letter-spacing: -0.4px;
          margin-bottom: 10px;
        }
        .feat-desc {
          font-size: 14px;
          color: var(--foreground-muted);
          line-height: 1.65;
          font-weight: 400;
        }

        /* ── How it works ────────────────────────────── */
        .how {
          padding: 80px 0;
          background-image:
            radial-gradient(ellipse 60% 40% at 50% 50%,
              color-mix(in srgb, var(--primary) 5%, transparent) 0%, transparent 70%);
        }
        .steps {
          display: flex;
          flex-direction: column;
          gap: 0;
          margin-top: 0;
          position: relative;
        }
        .step {
          display: flex;
          gap: 24px;
          align-items: flex-start;
          padding: 28px 0;
          border-bottom: 1px solid var(--surface);
        }
        .step:last-child { border-bottom: none; }
        .step-num {
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: 13px;
          font-weight: 900;
          color: var(--brand-text);
          background: color-mix(in srgb, var(--primary) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary) 15%, transparent);
          border-radius: 10px;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          letter-spacing: 0.5px;
        }
        .step-body { flex: 1; padding-top: 2px; }
        .step-title {
          font-size: 17px;
          font-weight: 800;
          color: var(--foreground);
          letter-spacing: -0.3px;
          margin-bottom: 8px;
        }
        .step-desc {
          font-size: 14px;
          color: var(--foreground-muted);
          line-height: 1.65;
        }

        /* ── Final CTA ───────────────────────────────── */
        .cta-section {
          padding: 80px 0 calc(80px + env(safe-area-inset-bottom));
          text-align: center;
        }
        .cta-card {
          background: var(--surface);
          border: 1px solid var(--surface);
          border-radius: 28px;
          padding: 56px 32px;
          position: relative;
          overflow: hidden;
        }
        .cta-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 80% 70% at 50% 0%,
            color-mix(in srgb, var(--primary) 7%, transparent) 0%, transparent 60%);
          pointer-events: none;
        }
        .cta-pizza {
          font-size: 52px;
          display: block;
          margin-bottom: 24px;
          line-height: 1;
          animation: float 3.5s ease-in-out infinite;
        }
        .cta-h2 {
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: clamp(26px, 5vw, 42px);
          font-weight: 900;
          color: var(--foreground);
          letter-spacing: -1.5px;
          line-height: 1.1;
          margin-bottom: 16px;
          position: relative;
        }
        .cta-sub {
          color: var(--foreground-muted);
          font-size: 15px;
          line-height: 1.65;
          margin-bottom: 36px;
          max-width: 380px;
          margin-left: auto;
          margin-right: auto;
          position: relative;
        }
        .cta-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          height: 58px;
          padding: 0 36px;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary) 100%);
          color: var(--foreground);
          font-family: 'Archivo', sans-serif;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.3px;
          border-radius: 16px;
          text-decoration: none;
          box-shadow: 0 8px 32px color-mix(in srgb, var(--primary) 40%, transparent), 0 2px 8px color-mix(in srgb, var(--primary) 20%, transparent);
          transition: opacity 0.18s, transform 0.15s, box-shadow 0.18s;
          position: relative;
          -webkit-tap-highlight-color: transparent;
        }
        .cta-btn:hover {
          opacity: 0.9;
          transform: translateY(-2px);
          box-shadow: 0 12px 40px color-mix(in srgb, var(--primary) 52%, transparent), 0 4px 12px color-mix(in srgb, var(--primary) 28%, transparent);
        }
        .cta-btn:active { transform: scale(0.97); opacity: 1; }
        .cta-note {
          margin-top: 18px;
          font-size: 12px;
          color: var(--border-strong);
          position: relative;
        }

        /* ── Footer ──────────────────────────────────── */
        .site-footer {
          border-top: 1px solid var(--surface);
          padding: 28px 0;
          text-align: center;
        }
        .footer-text {
          font-size: 12px;
          color: var(--surface-secondary);
        }
        .footer-text a {
          color: var(--border-strong);
          text-decoration: none;
        }
        .footer-text a:hover { color: var(--border-strong); }

        /* ── Testimonials ───────────────────────────── */
        .testimonials {
          padding: 80px 0;
        }
        .testi-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .testi-card {
          background: var(--surface);
          border: 1px solid color-mix(in srgb, var(--primary) 12%, transparent);
          border-radius: 20px;
          padding: 28px 24px;
          display: flex;
          flex-direction: column;
          gap: 0;
          transition: border-color 0.2s, transform 0.2s;
        }
        .testi-card:hover {
          border-color: color-mix(in srgb, var(--primary) 28%, transparent);
          transform: translateY(-2px);
        }
        .testi-stars {
          color: var(--brand-text);
          font-size: 14px;
          letter-spacing: 3px;
          margin-bottom: 16px;
        }
        .testi-text {
          font-size: 15px;
          color: var(--foreground-secondary);
          line-height: 1.72;
          font-weight: 400;
          flex: 1;
          margin-bottom: 24px;
        }
        .testi-text::before { content: '“'; }
        .testi-text::after  { content: '”'; }
        .testi-author {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-top: 20px;
          border-top: 1px solid var(--surface);
        }
        .testi-avatar {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--primary), var(--primary));
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: 17px;
          font-weight: 900;
          color: var(--foreground);
          flex-shrink: 0;
          user-select: none;
        }
        .testi-name {
          font-size: 14px;
          font-weight: 700;
          color: var(--foreground);
          letter-spacing: -0.2px;
          margin-bottom: 3px;
        }
        .testi-place {
          font-size: 12px;
          color: var(--border-strong);
          font-weight: 400;
        }

        /* ── Desktop ─────────────────────────────────── */
        @media (min-width: 680px) {
          .cards-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
          }
          .testi-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
          }
        }
        @media (min-width: 768px) {
          .hero { padding: 108px 0 96px; }
          .step { gap: 32px; }
          .step-body { padding-top: 4px; }
          .cta-card { padding: 72px 56px; }
        }
      `}</style>

      {/* ── Header ── */}
      <header className="site-header">
        <div className="container">
          <div className="header-inner">
            <Link href="/sobre" className="header-brand">
              <div className="header-pizza" aria-hidden="true">🍕</div>
              <span className="header-name">ChefeBot</span>
            </Link>
            <Link href="/login" className="header-login">Entrar</Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="hero">
          <div className="container">
            <div className="hero-badge">
              <span className="hero-badge-dot" aria-hidden="true" />
              Para restaurantes e pizzarias
            </div>

            <h1 className="hero-h1">
              Seu restaurante no WhatsApp,{" "}
              <span>do jeito certo</span>
            </h1>

            <p className="hero-sub">
              Automatize pedidos, gerencie entregas e receba pelo Pix —
              tudo sem sair do WhatsApp
            </p>

            <a href={WA_CTA} target="_blank" rel="noopener noreferrer" className="hero-cta">
              💬 Quero para minha pizzaria
            </a>

            <div className="hero-stats">
              <div className="hero-stat">
                <span className="hero-stat-n">24h</span>
                <span className="hero-stat-l">Atendimento</span>
              </div>
              <div className="hero-divider" aria-hidden="true" />
              <div className="hero-stat">
                <span className="hero-stat-n">0%</span>
                <span className="hero-stat-l">Comissão</span>
              </div>
              <div className="hero-divider" aria-hidden="true" />
              <div className="hero-stat">
                <span className="hero-stat-n">Pix</span>
                <span className="hero-stat-l">Automático</span>
              </div>
            </div>
          </div>
        </section>

        <div className="section-divider" />

        {/* ── Features ── */}
        <section className="features">
          <div className="container">
            <p className="section-label">Benefícios</p>
            <h2 className="section-title">
              Tudo que seu restaurante precisa
            </h2>

            <div className="cards-grid">
              {CARDS.map(c => (
                <div key={c.title} className="feat-card">
                  <div className="feat-icon" aria-hidden="true">{c.icon}</div>
                  <h3 className="feat-title">{c.title}</h3>
                  <p className="feat-desc">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="section-divider" />

        {/* ── Testimonials ── */}
        <section className="testimonials">
          <div className="container">
            <p className="section-label">Depoimentos</p>
            <h2 className="section-title">O que dizem nossos clientes</h2>

            <div className="testi-grid">
              {TESTIMONIALS.map(t => (
                <div key={t.name} className="testi-card">
                  <p className="testi-stars" aria-label="5 estrelas">★★★★★</p>
                  <p className="testi-text">{t.text}</p>
                  <div className="testi-author">
                    <div className="testi-avatar" aria-hidden="true">{t.initial}</div>
                    <div>
                      <p className="testi-name">{t.name}</p>
                      <p className="testi-place">{t.place}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="section-divider" />

        {/* ── How it works ── */}
        <section className="how">
          <div className="container">
            <p className="section-label">Como funciona</p>
            <h2 className="section-title">
              Três passos para começar
            </h2>

            <div className="steps">
              {STEPS.map(s => (
                <div key={s.n} className="step">
                  <div className="step-num" aria-hidden="true">{s.n}</div>
                  <div className="step-body">
                    <h3 className="step-title">{s.title}</h3>
                    <p className="step-desc">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="section-divider" />

        {/* ── Final CTA ── */}
        <section className="cta-section">
          <div className="container">
            <div className="cta-card">
              <span className="cta-pizza" aria-hidden="true">🍕</span>
              <h2 className="cta-h2">Pronto para transformar<br />sua pizzaria?</h2>
              <p className="cta-sub">
                Fale com a gente no WhatsApp e veja como o ChefeBot
                funciona na prática — sem contratos nem complicação.
              </p>
              <a href={WA_CTA} target="_blank" rel="noopener noreferrer" className="cta-btn">
                💬 Quero para minha pizzaria
              </a>
              <p className="cta-note">Resposta em até 1 hora útil</p>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="site-footer">
        <div className="container">
          <p className="footer-text">
            © {new Date().getFullYear()} ChefeBot —{" "}
            <Link href="/login">Acessar painel</Link>
          </p>
        </div>
      </footer>
    </>
  );
}
