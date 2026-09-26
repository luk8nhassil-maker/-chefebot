#!/usr/bin/env node
// ============================================================================
// Shim REST local — só para rodar o E2E HTTP real (scripts/e2e-ranking-
// gamificacao-http.mjs) numa sessão sem Docker disponível.
// ----------------------------------------------------------------------------
// Implementa o subconjunto do protocolo REST do @upstash/redis que a
// aplicação usa (POST "/" com um comando único, POST "/pipeline" com vários),
// só que encaminhando cada comando via RESP2 puro para um `redis-server`
// LOCAL e descartável (não Vercel KV/Upstash, não produção). É genérico —
// não conhece nenhum comando específico da aplicação — e por isso é
// funcionalmente equivalente ao SRH (serverless-redis-http) já usado nos
// workflows de CI deste repositório (ver .github/workflows/entregador-auth-
// e2e.yml), só que sem depender de um daemon Docker.
//
// Uso:
//   node scripts/local-redis-http-shim.mjs --redis-port 6399 --http-port 8079 --token test
// ============================================================================
import http from "node:http";
import net from "node:net";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { redisPort: 6399, httpPort: 8079, token: "test" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--redis-port") opts.redisPort = Number(args[++i]);
    else if (args[i] === "--http-port") opts.httpPort = Number(args[++i]);
    else if (args[i] === "--token") opts.token = args[++i];
  }
  return opts;
}

const { redisPort, httpPort, token } = parseArgs();

// ---------------------------------------------------------------------------
// Cliente RESP2 mínimo — só o suficiente para SET/GET/DEL/EXPIRE/INCR/EVAL/
// pipelines arbitrários. Uma única conexão persistente; comandos são
// serializados (uma resposta de cada vez), o que é suficiente para um smoke
// test local (não é um servidor de produção).
// ---------------------------------------------------------------------------
class RespClient {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port: this.port, host: "127.0.0.1" }, () => {
        this.connected = true;
        resolve();
      });
      this.socket.on("error", (err) => {
        if (!this.connected) reject(err);
      });
      this.socket.on("data", (chunk) => this._onData(chunk));
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.queue.length > 0) {
      const parsed = this._tryParse(this.buffer, 0);
      if (!parsed) break;
      this.buffer = this.buffer.subarray(parsed.offset);
      const { resolve, reject } = this.queue.shift();
      if (parsed.value instanceof Error) reject(parsed.value);
      else resolve(parsed.value);
    }
  }

  // Parser RESP2 recursivo. Retorna { value, offset } ou null se incompleto.
  _tryParse(buf, start) {
    if (start >= buf.length) return null;
    const type = String.fromCharCode(buf[start]);
    const lineEnd = buf.indexOf("\r\n", start + 1);
    if (lineEnd === -1) return null;
    const line = buf.toString("utf8", start + 1, lineEnd);
    const afterLine = lineEnd + 2;

    if (type === "+") return { value: line, offset: afterLine };
    if (type === "-") return { value: new Error(line), offset: afterLine };
    if (type === ":") return { value: Number(line), offset: afterLine };
    if (type === "$") {
      const len = Number(line);
      if (len === -1) return { value: null, offset: afterLine };
      const dataEnd = afterLine + len;
      if (buf.length < dataEnd + 2) return null;
      const value = buf.toString("utf8", afterLine, dataEnd);
      return { value, offset: dataEnd + 2 };
    }
    if (type === "*") {
      const count = Number(line);
      if (count === -1) return { value: null, offset: afterLine };
      let offset = afterLine;
      const items = [];
      for (let i = 0; i < count; i++) {
        const item = this._tryParse(buf, offset);
        if (!item) return null;
        items.push(item.value);
        offset = item.offset;
      }
      return { value: items, offset };
    }
    throw new Error(`RESP: tipo desconhecido '${type}'`);
  }

  sendCommand(args) {
    const parts = [`*${args.length}\r\n`];
    for (const arg of args) {
      const s = String(arg);
      parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.socket.write(parts.join(""));
    });
  }
}

const client = new RespClient(redisPort);
await client.connect();
console.log(`[local-redis-http-shim] conectado ao redis-server local em 127.0.0.1:${redisPort}`);

function checkAuth(req) {
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${token}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// O client @upstash/redis para Node pede, por padrão, respostas em base64
// (header "Upstash-Encoding: base64") e decodifica com uma regra específica
// (ver node_modules/@upstash/redis/nodejs.js, função decode()): a string
// literal "OK" no TOPO nunca é decodificada (fica "OK"), qualquer outra
// string no topo é base64-decodificada, e strings DENTRO de um array são
// sempre base64-decodificadas (mesmo que sejam "OK") — sem a exceção do
// topo. Isto espelha exatamente essa regra na hora de ENCODAR a resposta,
// senão o client corrompe todo valor de string ao tentar decodificar texto
// puro como se fosse base64.
function b64(valor) {
  return Buffer.from(String(valor), "utf8").toString("base64");
}
function encodarAninhado(valor) {
  if (typeof valor === "string") return b64(valor);
  if (Array.isArray(valor)) return valor.map(encodarAninhado);
  return valor;
}
function encodarTopo(valor) {
  if (typeof valor === "string") return valor === "OK" ? "OK" : b64(valor);
  if (Array.isArray(valor)) return valor.map(encodarAninhado);
  return valor;
}

async function runOne(command, encodarBase64) {
  try {
    const result = await client.sendCommand(command);
    return { result: encodarBase64 ? encodarTopo(result) : result };
  } catch (err) {
    return { error: err.message };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  if (!checkAuth(req)) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "bad json" }));
    return;
  }

  const url = req.url || "/";
  const encodarBase64 = String(req.headers["upstash-encoding"] || "").toLowerCase() === "base64";
  if (process.env.SHIM_DEBUG) console.error("[shim debug] url:", url, "body:", JSON.stringify(body));
  if (url === "/pipeline" || url === "/multi-exec") {
    const commands = Array.isArray(body) ? body : [];
    const out = [];
    for (const cmd of commands) out.push(await runOne(cmd, encodarBase64));
    if (process.env.SHIM_DEBUG) console.error("[shim debug] pipeline result:", JSON.stringify(out));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    return;
  }

  const command = Array.isArray(body) ? body : [];
  if (process.env.SHIM_DEBUG) console.error("[shim debug] command:", JSON.stringify(command));
  const out = await runOne(command, encodarBase64);
  if (process.env.SHIM_DEBUG) console.error("[shim debug] result:", JSON.stringify(out));
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
});

server.listen(httpPort, "127.0.0.1", () => {
  console.log(`[local-redis-http-shim] REST compatível com @upstash/redis em http://127.0.0.1:${httpPort}`);
});
