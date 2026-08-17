import fs from "node:fs";
const path = "src/app/salao/page.test.tsx";
let texto = fs.readFileSync(path, "utf8");
const antigo = 'rodadas: [{ id: "r1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "", atualizadaEm: "", enviadaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1 }],';
const novo = 'rodadas: [{ id: "r1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "", atualizadaEm: "", enviadaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1, pedidoStatus: "novo" }],';
const indice = texto.indexOf(antigo);
if (indice < 0) throw new Error("Fixture legado alvo não encontrada");
texto = texto.slice(0, indice) + novo + texto.slice(indice + antigo.length);
fs.writeFileSync(path, texto);
