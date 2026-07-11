import Link from "next/link";

export const metadata = {
  title: "404 — Página não encontrada | ChefeBot",
};

export default function NotFound() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px)    rotate(0deg);  }
          35%       { transform: translateY(-16px)  rotate(6deg);  }
          65%       { transform: translateY(-9px)   rotate(-4deg); }
        }
        @keyframes bgPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.6; }
        }

        /* ── Page shell ──────────────────────────────── */
        .nf-page {
          position: relative;
          min-height: 100svh;
          overflow: hidden;
          background: var(--background);
          background-image:
            radial-gradient(ellipse 85% 65% at 50% 48%,
              color-mix(in srgb, var(--primary) 8%, transparent) 0%,
              transparent 62%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding:
            calc(env(safe-area-inset-top)    + 48px) 24px
            calc(env(safe-area-inset-bottom) + 48px);
          font-family: 'Archivo', sans-serif;
          text-align: center;
        }

        /* ── Decorative background "404" ─────────────── */
        .nf-bg {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-weight: 900;
          font-size: clamp(180px, 46vw, 760px);
          line-height: 0.85;
          letter-spacing: -6px;
          color: color-mix(in srgb, var(--primary) 6%, transparent);
          white-space: nowrap;
          user-select: none;
          pointer-events: none;
          z-index: 0;
          animation: bgPulse 6s ease-in-out infinite;
        }

        /* ── Foreground content ──────────────────────── */
        .nf-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 440px;
          animation: fadeIn 0.5s cubic-bezier(0.22,1,0.36,1) 0.08s both;
        }

        /* Emoji floats on its own wrapper — no transform conflict */
        .nf-emoji-wrap {
          font-size: clamp(60px, 15vw, 88px);
          line-height: 1;
          margin-bottom: 32px;
          user-select: none;
          display: block;
          animation: float 4.8s ease-in-out infinite;
        }

        .nf-title {
          font-family: 'Archivo Black', 'Archivo', sans-serif;
          font-size: clamp(54px, 14vw, 84px);
          font-weight: 900;
          color: var(--foreground);
          letter-spacing: -2.5px;
          line-height: 1;
          margin-bottom: 16px;
        }

        .nf-sub {
          color: var(--foreground-secondary);
          font-size: clamp(15px, 3.5vw, 17px);
          font-weight: 400;
          line-height: 1.65;
          margin-bottom: 48px;
          max-width: 280px;
        }

        .nf-link {
          color: var(--primary-text);
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.1px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 3px 0 4px;
          border-bottom: 1.5px solid color-mix(in srgb, var(--primary) 1%, transparent);
          transition: border-color 0.18s, opacity 0.18s, gap 0.2s;
          -webkit-tap-highlight-color: transparent;
        }

        .nf-link:hover {
          border-bottom-color: color-mix(in srgb, var(--primary) 40%, transparent);
          gap: 11px;
        }

        .nf-link:active {
          opacity: 0.6;
        }

        @media (min-width: 768px) {
          .nf-content { max-width: 560px; }
          .nf-sub { max-width: 360px; }
          .nf-link { font-size: 16px; }
        }
      `}</style>

      <div className="nf-page">
        <span className="nf-bg" aria-hidden="true">404</span>

        <div className="nf-content">
          <span className="nf-emoji-wrap" aria-hidden="true">🍕</span>

          <h1 className="nf-title">Ooops!</h1>

          <p className="nf-sub">Essa página parece ter evaporado</p>

          <Link href="/" className="nf-link">
            ← Voltar para o início
          </Link>
        </div>
      </div>
    </>
  );
}
