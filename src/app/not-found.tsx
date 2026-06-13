import Link from "next/link";

export const metadata = {
  title: "Página não encontrada — ChefeBot",
};

export default function NotFound() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(28px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pizzaSpin {
          from { opacity: 0; transform: scale(0.5) rotate(-20deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 48px rgba(255,107,0,0.40), 0 8px 32px rgba(255,107,0,0.28); }
          50%       { box-shadow: 0 0 80px rgba(255,107,0,0.65), 0 16px 48px rgba(255,107,0,0.42); }
        }
        @keyframes btnHover {
          from { box-shadow: 0 6px 28px rgba(255,107,0,0.38); }
          to   { box-shadow: 0 8px 36px rgba(255,107,0,0.55); }
        }

        .not-found-wrap {
          min-height: 100svh;
          background: #060606;
          background-image: radial-gradient(ellipse 70% 45% at 50% 0%, rgba(255,107,0,0.07) 0%, transparent 70%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: calc(env(safe-area-inset-top) + 48px) 24px calc(env(safe-area-inset-bottom) + 48px);
          font-family: 'Archivo', sans-serif;
          text-align: center;
          overflow: hidden;
        }

        .not-found-inner {
          width: 100%;
          max-width: 400px;
          animation: fadeIn 0.55s cubic-bezier(0.22,1,0.36,1) both;
        }

        .not-found-pizza {
          width: 104px;
          height: 104px;
          background: linear-gradient(145deg, #ff7a1a, #ff5500);
          border-radius: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 52px;
          margin: 0 auto 32px;
          line-height: 1;
          user-select: none;
          flex-shrink: 0;
          animation:
            pizzaSpin 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.1s both,
            glowPulse 3s ease-in-out 0.8s infinite;
        }

        .not-found-code {
          color: #ff6b00;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          margin-bottom: 16px;
          opacity: 0.85;
        }

        .not-found-title {
          color: #f4f1ec;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.9px;
          line-height: 1.15;
          margin-bottom: 14px;
        }

        .not-found-sub {
          color: #6b6259;
          font-size: 15px;
          font-weight: 500;
          line-height: 1.55;
          margin-bottom: 40px;
          letter-spacing: 0.1px;
        }

        .not-found-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: linear-gradient(135deg, #ff7a1a 0%, #ff5500 100%);
          color: #fff;
          font-family: 'Archivo', sans-serif;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.3px;
          text-decoration: none;
          border-radius: 16px;
          height: 56px;
          padding: 0 32px;
          box-shadow: 0 6px 28px rgba(255,107,0,0.38), 0 2px 8px rgba(255,107,0,0.2);
          transition: opacity 0.18s, transform 0.15s, box-shadow 0.18s;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }

        .not-found-btn:hover {
          opacity: 0.92;
          transform: translateY(-1px);
          box-shadow: 0 10px 36px rgba(255,107,0,0.52), 0 4px 12px rgba(255,107,0,0.28);
        }

        .not-found-btn:active {
          transform: scale(0.97);
          opacity: 1;
        }
      `}</style>

      <div className="not-found-wrap">
        <div className="not-found-inner">
          <div className="not-found-pizza" aria-hidden="true">🍕</div>

          <p className="not-found-code">Erro 404</p>

          <h1 className="not-found-title">Ops, essa página sumiu!</h1>

          <p className="not-found-sub">
            Mas sua pizza não vai sumir não 😄
          </p>

          <Link href="/" className="not-found-btn">
            ← Voltar ao início
          </Link>
        </div>
      </div>
    </>
  );
}
