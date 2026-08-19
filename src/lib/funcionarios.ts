import { redis } from '@/lib/redis'

export type Funcionario = {
  username: string
  name: string
  password: string
  ativo: boolean
  role: 'atendente' | 'contador' | 'financeiro' | 'entregador' | 'admin' | 'dev'
}

const FUNCIONARIOS_PADRAO: Funcionario[] = [
  { username: 'kellyne', name: 'Kellyne', password: process.env.KELLYNE_PASSWORD!, ativo: true, role: 'atendente' },
  { username: 'salao', name: 'Atendente Salao', password: process.env.SALAO_PASSWORD!, ativo: true, role: 'atendente' },
]

export async function getFuncionarios(): Promise<Funcionario[]> {
  const saved = await redis.get<Funcionario[]>('funcionarios')
  return saved ?? FUNCIONARIOS_PADRAO
}
