export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "32px 20px",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <section
        aria-labelledby="offline-title"
        style={{
          width: "100%",
          maxWidth: 440,
          padding: 28,
          borderRadius: 20,
          background: "var(--surface)",
          border: "1px solid var(--surface-secondary)",
          textAlign: "center",
        }}
      >
        <div aria-hidden="true" style={{ fontSize: 42, marginBottom: 12 }}>
          📶
        </div>
        <h1 id="offline-title" style={{ margin: "0 0 10px", fontSize: 24 }}>
          Sem conexão com a internet
        </h1>
        <p
          style={{
            margin: "0 0 22px",
            color: "var(--foreground-muted)",
            lineHeight: 1.55,
          }}
        >
          O ChefeBot não mostra dados antigos de pedidos enquanto estiver offline.
          Reconecte a internet e tente novamente.
        </p>
        <a
          href="/pedidos"
          style={{
            display: "inline-flex",
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            padding: "0 18px",
            borderRadius: 12,
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Tentar novamente
        </a>
      </section>
    </main>
  );
}
