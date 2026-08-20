"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const RENOVACAO_SESSAO_MS = 60 * 60 * 1000;

export default function SalaoSessionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ehTelaLogin = pathname === "/salao/login";
  const [pronto, setPronto] = useState(ehTelaLogin);
  const [erro, setErro] = useState(false);

  const garantirSessao = useCallback(async (silencioso = false) => {
    if (ehTelaLogin) {
      setPronto(true);
      return true;
    }

    try {
      const resposta = await fetch("/api/salao/login", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!resposta.ok) throw new Error("sessao_salao_indisponivel");
      setErro(false);
      setPronto(true);
      return true;
    } catch {
      if (!silencioso) {
        setErro(true);
        setPronto(false);
      }
      return false;
    }
  }, [ehTelaLogin]);

  useEffect(() => {
    if (ehTelaLogin) {
      setPronto(true);
      return;
    }

    void garantirSessao();

    const renovarAoFocar = () => { void garantirSessao(true); };
    const renovacao = window.setInterval(() => { void garantirSessao(true); }, RENOVACAO_SESSAO_MS);
    window.addEventListener("focus", renovarAoFocar);

    return () => {
      window.clearInterval(renovacao);
      window.removeEventListener("focus", renovarAoFocar);
    };
  }, [ehTelaLogin, garantirSessao]);

  if (ehTelaLogin || pronto) return children;

  return (
    <div
      style={{
        minHeight: "100svh",
        background: "var(--background)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "'Archivo', sans-serif",
      }}
    >
      <div style={{ textAlign: "center", display: "grid", gap: 12, maxWidth: 340 }}>
        <p style={{ margin: 0, fontWeight: 900, color: "var(--foreground)" }}>
          {erro ? "Não foi possível iniciar o terminal agora." : "Iniciando terminal do salão…"}
        </p>
        {erro && (
          <button
            type="button"
            onClick={() => { setErro(false); void garantirSessao(); }}
            style={{
              height: 46,
              border: "none",
              borderRadius: 12,
              background: "var(--primary)",
              color: "var(--background)",
              fontSize: 14,
              fontWeight: 900,
              cursor: "pointer",
              padding: "0 18px",
            }}
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}
