-- Migração incremental — segura para bancos existentes com dados
-- Execute no Supabase Dashboard > SQL Editor

-- 1. Coluna produto_nome em itens_pedido (idempotente)
ALTER TABLE itens_pedido ADD COLUMN IF NOT EXISTS produto_nome TEXT;

-- 2. Atualizar constraint de tamanho para aceitar P, M, G, F e NULL
--    Localiza e dropa a constraint antiga pelo conteúdo, depois recria
DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'itens_pedido'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%tamanho%';

  IF v_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE itens_pedido DROP CONSTRAINT ' || quote_ident(v_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'itens_pedido'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%tamanho%'
  ) THEN
    ALTER TABLE itens_pedido ADD CONSTRAINT itens_pedido_tamanho_check
      CHECK (tamanho IS NULL OR tamanho IN ('P', 'M', 'G', 'F'));
  END IF;
END $$;
