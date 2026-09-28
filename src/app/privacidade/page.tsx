export const dynamic = "force-dynamic";

function prazoRetencao(): string {
  const configurado = process.env.BEHAVIOR_ANALYTICS_RETENTION_DAYS;
  const dias = configurado === undefined || configurado.trim() === "" ? 30 : Number(configurado);
  return Number.isInteger(dias) && dias >= 7 && dias <= 730
    ? `Os eventos são mantidos por até ${dias} dias.`
    : "O prazo de armazenamento depende da configuração de privacidade ativa no sistema.";
}

export default function PrivacidadePage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px 48px", lineHeight: 1.65, color: "#222" }}>
      <a href="/cardapio" style={{ color: "inherit" }}>Voltar ao cardápio</a>
      <h1 style={{ marginTop: 24 }}>Privacidade no cardápio</h1>
      <p>
        Para encontrar erros e melhorar o cardápio, o sistema pode registrar algumas etapas de navegação e uso.
        Essa coleta só funciona quando está habilitada no ambiente.
      </p>

      <h2>O que pode ser registrado</h2>
      <p>
        Telas acessadas, identificadores de produtos e categorias, ações no carrinho, etapas do checkout,
        resultado técnico do envio do pedido e informações gerais do dispositivo. O texto digitado na busca
        não é armazenado nos eventos comportamentais.
      </p>

      <h2>Vínculo com o WhatsApp</h2>
      <p>
        Quando o cardápio é aberto por um link oficial enviado pela pizzaria no WhatsApp, a jornada pode ser
        associada a um identificador pseudonimizado. Se você relatar um problema, a equipe Dev autorizada pode
        localizar essa jornada pelo telefone informado no atendimento. O telefone não é copiado para cada evento.
        O vínculo salvo no navegador expira em até 30 dias.
      </p>

      <h2>Quem consulta</h2>
      <p>
        O histórico individual fica restrito a pessoas autorizadas com perfil Dev e é usado para investigar
        dificuldades de uso e corrigir o sistema.
      </p>

      <h2>O que não entra nessa telemetria</h2>
      <p>
        Nome, telefone, endereço, texto da busca, mensagens privadas do WhatsApp, senhas, códigos de acesso,
        dados completos de cartão, payload do Pix e localização precisa não são registrados nos eventos
        comportamentais. Informações necessárias para realizar um pedido podem ser tratadas separadamente
        para concluir e atender o pedido.
      </p>

      <h2>Armazenamento e dúvidas</h2>
      <p>{prazoRetencao()}</p>
      <p>
        Para tirar dúvidas sobre seus dados ou pedir atendimento, fale com a pizzaria pelo canal oficial de
        WhatsApp.
      </p>
    </main>
  );
}
