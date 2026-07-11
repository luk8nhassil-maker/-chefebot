"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

function getDestino(role: string, callbackUrl: string | null): string {
  if (callbackUrl) return callbackUrl;
  if (role === 'dev') return '/dev';
  if (role === 'admin') return '/admin';
  if (role === 'contador') return '/contador';
  if (role === 'financeiro') return '/financeiro';
  if (role === 'entregador') return '/entregador';
  return '/pedidos';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? null;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [userFocus, setUserFocus] = useState(false);
  const [passFocus, setPassFocus] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)auth-user=([^;]+)/);
    if (match) {
      fetch("/api/auth/verify")
        .then(r => {
          if (r.ok) return r.json().then((d: { role: string }) => {
            router.replace(getDestino(d.role, callbackUrl));
          });
          document.cookie = 'auth-token=; max-age=0; path=/';
          document.cookie = 'auth-user=; max-age=0; path=/';
        })
        .catch(() => {
          document.cookie = 'auth-token=; max-age=0; path=/';
          document.cookie = 'auth-user=; max-age=0; path=/';
        });
    }
  }, [callbackUrl, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Usuário ou senha incorretos.");
        return;
      }
      const data = await res.json();
      router.replace(getDestino(data.role, callbackUrl));
      router.refresh();
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = (focused: boolean, withIcon = false): React.CSSProperties => ({
    width: "100%",
    background: "var(--surface)",
    border: `1.5px solid ${focused ? "var(--primary)" : "var(--surface-secondary)"}`,
    borderRadius: 14,
    padding: withIcon ? "0 48px 0 16px" : "0 16px",
    color: "var(--foreground)",
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
    minHeight: 52,
    height: 52,
    fontFamily: "'Archivo', sans-serif",
    transition: "border-color 0.18s, box-shadow 0.18s",
    WebkitAppearance: "none",
    boxShadow: focused ? "0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent)" : "none",
    display: "block",
  });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(24px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes logoIn {
          from { opacity: 0; transform: scale(0.7) rotate(-8deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 48px color-mix(in srgb, var(--primary) 35%, transparent), 0 8px 32px color-mix(in srgb, var(--primary) 25%, transparent); }
          50%       { box-shadow: 0 0 72px color-mix(in srgb, var(--primary) 55%, transparent), 0 12px 40px color-mix(in srgb, var(--primary) 35%, transparent); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        input::placeholder { color: var(--surface-elevated); }
        input:-webkit-autofill,
        input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px var(--surface) inset !important;
          -webkit-text-fill-color: var(--foreground) !important;
          caret-color: var(--foreground);
        }
        button:active:not(:disabled) {
          transform: scale(0.98);
        }
      `}</style>

      <div style={{
        minHeight: "100svh",
        background: "var(--background)",
        backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--primary) 8%, transparent) 0%, transparent 70%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `calc(env(safe-area-inset-top) + 40px) 24px calc(env(safe-area-inset-bottom) + 40px)`,
        fontFamily: "'Archivo', sans-serif",
        overflowX: "hidden",
      }}>

        {/* Container principal */}
        <div style={{
          width: "100%",
          maxWidth: 380,
          opacity: visible ? 1 : 0,
          animation: visible ? "fadeIn 0.5s cubic-bezier(0.22,1,0.36,1) forwards" : "none",
        }}>

          {/* Marca */}
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <div style={{
              width: 96,
              height: 96,
              borderRadius: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              margin: "0 auto 24px",
              animation: visible ? "logoIn 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.1s both, glowPulse 3s ease-in-out 1s infinite" : "none",
              flexShrink: 0,
              lineHeight: 1,
              userSelect: "none",
              overflow: "hidden",
            }}>
              {logoError ? (
                <span>🍕</span>
              ) : (
                <Image
                  src="/logo-chefe-da-pizza.jpg"
                  alt="Chefe da Pizza"
                  width={96}
                  height={96}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  onError={() => setLogoError(true)}
                  priority
                />
              )}
            </div>

            <h1 style={{
              color: "var(--foreground)",
              fontSize: 38,
              fontWeight: 900,
              margin: "0 0 10px",
              letterSpacing: -1.5,
              fontFamily: "'Archivo', sans-serif",
              lineHeight: 1,
            }}>
              ChefeBot
            </h1>

            <p style={{
              color: "var(--foreground-muted)",
              fontSize: 15,
              margin: 0,
              fontWeight: 500,
              letterSpacing: 0.2,
              fontFamily: "'Archivo', sans-serif",
            }}>
              Seu restaurante no WhatsApp
            </p>
          </div>

          {/* Card */}
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--surface)",
            borderRadius: 22,
            padding: "28px 24px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 1px 0 rgba(var(--overlay-rgb), 0.03) inset",
          }}>
            <form onSubmit={handleSubmit} noValidate>

              {/* Campo Usuário */}
              <div style={{ marginBottom: 14 }}>
                <label style={{
                  display: "block",
                  color: "var(--border-strong)",
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 8,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontFamily: "'Archivo', sans-serif",
                }}>
                  Usuário
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="seu usuário"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  spellCheck={false}
                  required
                  style={inputStyle(userFocus)}
                  onFocus={() => setUserFocus(true)}
                  onBlur={() => setUserFocus(false)}
                />
              </div>

              {/* Campo Senha */}
              <div style={{ marginBottom: 24 }}>
                <label style={{
                  display: "block",
                  color: "var(--border-strong)",
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 8,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontFamily: "'Archivo', sans-serif",
                }}>
                  Senha
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    style={inputStyle(passFocus, true)}
                    onFocus={() => setPassFocus(true)}
                    onBlur={() => setPassFocus(false)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    style={{
                      position: "absolute",
                      right: 14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      lineHeight: 1,
                      fontSize: 18,
                      color: "var(--border-strong)",
                      WebkitTapHighlightColor: "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      userSelect: "none",
                    }}
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {/* Botão */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  height: 56,
                  background: loading
                    ? "var(--background)"
                    : "linear-gradient(135deg, var(--primary) 0%, var(--primary) 100%)",
                  border: "none",
                  borderRadius: 16,
                  color: loading ? "var(--foreground)" : "var(--primary-foreground)",
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: "'Archivo', sans-serif",
                  letterSpacing: -0.3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "opacity 0.2s, transform 0.15s, box-shadow 0.2s",
                  boxShadow: loading ? "none" : "0 6px 28px color-mix(in srgb, var(--primary) 38%, transparent), 0 2px 8px color-mix(in srgb, var(--primary) 20%, transparent)",
                  WebkitTapHighlightColor: "transparent",
                  opacity: loading ? 0.8 : 1,
                }}
              >
                {loading ? (
                  <span style={{
                    width: 22,
                    height: 22,
                    border: "2.5px solid rgba(var(--overlay-rgb), 0.25)",
                    borderTopColor: "var(--foreground)",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 0.6s linear infinite",
                    flexShrink: 0,
                  }} />
                ) : "Entrar"}
              </button>

              {/* Erro abaixo do botão */}
              {error && (
                <div style={{
                  marginTop: 14,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  color: "var(--danger)",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.45,
                  fontFamily: "'Archivo', sans-serif",
                }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
                  <span>{error}</span>
                </div>
              )}
            </form>
          </div>

          {/* Rodapé */}
          <p style={{
            textAlign: "center",
            color: "var(--surface-secondary)",
            fontSize: 12,
            marginTop: 28,
            lineHeight: 1.6,
            fontFamily: "'Archivo', sans-serif",
          }}>
            Simulador público —{" "}
            <a href="/simulador" style={{ color: "var(--foreground-muted)", textDecoration: "none" }}>
              acessar sem login
            </a>
          </p>
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
