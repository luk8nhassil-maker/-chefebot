import { describe, expect, test } from "vitest";
import { extrairTelefoneIndividualDaChave } from "./whatsappJid";

describe("extrairTelefoneIndividualDaChave", () => {
  test("preserva o remoteJid telefonico que o fluxo antigo ja usa", () => {
    expect(
      extrairTelefoneIndividualDaChave({
        remoteJid: "5586999990001@s.whatsapp.net",
      })
    ).toBe("5586999990001");
  });

  test("usa remoteJidAlt quando o identificador principal e LID", () => {
    expect(
      extrairTelefoneIndividualDaChave({
        remoteJid: "154417159582282@lid",
        remoteJidAlt: "5586999990002@s.whatsapp.net",
      })
    ).toBe("5586999990002");
  });

  test("nunca usa LID como telefone sem mapeamento", () => {
    expect(
      extrairTelefoneIndividualDaChave({ remoteJid: "154417159582282@lid" })
    ).toBeUndefined();
  });

  test("ignora grupos e broadcasts mesmo se houver campo alternativo", () => {
    expect(
      extrairTelefoneIndividualDaChave({
        remoteJid: "123456789@g.us",
        remoteJidAlt: "5586999990003@s.whatsapp.net",
      })
    ).toBeUndefined();
    expect(
      extrairTelefoneIndividualDaChave({
        remoteJid: "status@broadcast",
        remoteJidAlt: "5586999990003@s.whatsapp.net",
      })
    ).toBeUndefined();
  });

  test("tolera payload ausente ou malformado", () => {
    expect(extrairTelefoneIndividualDaChave(undefined)).toBeUndefined();
    expect(extrairTelefoneIndividualDaChave("invalido")).toBeUndefined();
    expect(extrairTelefoneIndividualDaChave({ remoteJid: 123 })).toBeUndefined();
  });
});
