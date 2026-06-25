"use client";
import { useState } from 'react'
import Link from 'next/link'

const SQL = `-- Execute este SQL no Supabase Dashboard > SQL Editor
-- https://supabase.com/dashboard/project/xwbtitkuuzawutwhwxbw/sql

CREATE TABLE IF NOT EXISTS tenants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  cor_primaria TEXT DEFAULT '#DC2626',
  horario TEXT NOT NULL,
  endereco TEXT NOT NULL,
  telefone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS produtos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT,
  preco DECIMAL(10,2) NOT NULL,
  categoria TEXT NOT NULL,
  foto_url TEXT,
  ativo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS pedidos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  endereco TEXT,
  tipo_entrega TEXT NOT NULL CHECK (tipo_entrega IN ('delivery','retirada')),
  pagamento TEXT NOT NULL CHECK (pagamento IN ('pix','cartao','dinheiro')),
  total DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'novo',
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id UUID REFERENCES pedidos(id),
  produto_id UUID REFERENCES produtos(id),
  quantidade INTEGER NOT NULL,
  tamanho TEXT CHECK (tamanho IN ('P','M','G')),
  observacao TEXT,
  preco_unitario DECIMAL(10,2) NOT NULL
);

-- Enable RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_pedido ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY IF NOT EXISTS "public_read_tenants" ON tenants FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public_read_produtos" ON produtos FOR SELECT USING (ativo = true);

-- Anonymous write policies
CREATE POLICY IF NOT EXISTS "anon_insert_pedidos" ON pedidos FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_insert_itens" ON itens_pedido FOR INSERT WITH CHECK (true);`

export default function SetupPage() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)

  async function seedData() {
    setStatus('loading')
    try {
      const res = await fetch('/api/setup-db', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setStatus('ok')
      setMsg('Dados inseridos com sucesso!')
    } catch (e: any) {
      setStatus('error')
      setMsg(e.message)
    }
  }

  function copySQL() {
    navigator.clipboard.writeText(SQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-white px-4 py-10 max-w-lg mx-auto">
      <Link href="/loja" className="text-red-600 text-sm font-semibold">← Voltar</Link>
      <h1 className="text-2xl font-extrabold mt-4 mb-2 text-gray-900">Setup do Banco de Dados</h1>
      <p className="text-gray-500 text-sm mb-6">
        Execute o SQL abaixo no{' '}
        <a href="https://supabase.com/dashboard/project/xwbtitkuuzawutwhwxbw/sql" target="_blank" rel="noopener noreferrer" className="text-red-600 underline">
          Supabase SQL Editor
        </a>{' '}
        para criar as tabelas. Depois clique em &ldquo;Inserir dados de exemplo&rdquo;.
      </p>

      <div className="relative bg-gray-900 rounded-xl overflow-hidden mb-6">
        <button
          onClick={copySQL}
          className="absolute top-3 right-3 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded-lg"
        >
          {copied ? '✓ Copiado!' : 'Copiar'}
        </button>
        <pre className="text-green-400 text-xs p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
          {SQL}
        </pre>
      </div>

      <button
        onClick={seedData}
        disabled={status === 'loading'}
        className="w-full bg-red-600 disabled:bg-gray-300 text-white py-4 rounded-2xl font-bold text-base mb-4"
      >
        {status === 'loading' ? 'Inserindo dados...' : '🍕 Inserir dados de exemplo'}
      </button>

      {status === 'ok' && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 text-sm text-center">
          ✅ {msg}
          <div className="mt-3">
            <Link href="/loja" className="bg-green-600 text-white px-6 py-2 rounded-xl font-semibold inline-block">
              Ir para a loja
            </Link>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          ❌ {msg}
          <p className="mt-1 text-xs text-red-500">Verifique se as tabelas foram criadas e as políticas RLS estão configuradas.</p>
        </div>
      )}
    </div>
  )
}
