import FormularioFiscalCompartilhado from "../FormularioFiscalCompartilhado";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Informações fiscais — convite do contador",
  robots: { index: false, follow: false },
};

export default function ConviteContador() {
  return (
    <>
      <meta name="referrer" content="no-referrer" />
      <FormularioFiscalCompartilhado modo="contador" />
    </>
  );
}
