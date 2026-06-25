-- Chefe da Pizza — Setup inicial do banco de dados
-- Execute no Supabase Dashboard > SQL Editor

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
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT,
  preco DECIMAL(10,2) NOT NULL,
  categoria TEXT NOT NULL,
  foto_url TEXT,
  ativo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS pedidos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  endereco TEXT,
  tipo_entrega TEXT NOT NULL CHECK (tipo_entrega IN ('delivery', 'retirada')),
  pagamento TEXT NOT NULL CHECK (pagamento IN ('pix', 'cartao', 'dinheiro')),
  total DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'novo',
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  tamanho TEXT CHECK (tamanho IN ('P', 'M', 'G')),
  observacao TEXT,
  preco_unitario DECIMAL(10,2) NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_produtos_tenant ON produtos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_tenant ON pedidos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_token ON pedidos(token);
CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id);

-- Row Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_pedido ENABLE ROW LEVEL SECURITY;

-- Políticas de leitura pública (idempotentes)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenants' AND policyname='Leitura pública de tenants') THEN
    CREATE POLICY "Leitura pública de tenants" ON tenants FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='produtos' AND policyname='Leitura pública de produtos ativos') THEN
    CREATE POLICY "Leitura pública de produtos ativos" ON produtos FOR SELECT USING (ativo = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pedidos' AND policyname='Inserção anônima de pedidos') THEN
    CREATE POLICY "Inserção anônima de pedidos" ON pedidos FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='itens_pedido' AND policyname='Inserção anônima de itens') THEN
    CREATE POLICY "Inserção anônima de itens" ON itens_pedido FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Dados de exemplo
INSERT INTO tenants (nome, cor_primaria, horario, endereco, telefone)
VALUES (
  'Chefe da Pizza',
  '#DC2626',
  'Seg–Sex: 18h–23h | Sáb–Dom: 18h–00h',
  'Rua das Pizzas, 123 – Centro',
  '(99) 99999-9999'
) ON CONFLICT (nome) DO NOTHING;

DO $$
DECLARE v_tenant UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE nome = 'Chefe da Pizza';
  INSERT INTO produtos (tenant_id, nome, descricao, preco, categoria, ativo) VALUES
    (v_tenant, 'Margherita',        'Molho de tomate, mozzarella fresca e manjericão',              35.00, 'Pizzas', true),
    (v_tenant, 'Calabresa',         'Molho de tomate, mozzarella e calabresa fatiada',              38.00, 'Pizzas', true),
    (v_tenant, 'Frango c/ Catupiry','Molho de tomate, frango desfiado e catupiry cremoso',          42.00, 'Pizzas', true),
    (v_tenant, 'Quatro Queijos',    'Mozzarella, parmesão, provolone e gorgonzola',                 45.00, 'Pizzas', true),
    (v_tenant, 'Pepperoni',         'Molho de tomate, mozzarella abundante e pepperoni importado',  44.00, 'Pizzas', true)
  ON CONFLICT (nome) DO NOTHING;
END $$;
