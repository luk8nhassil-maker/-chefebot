import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { writeFile } from 'fs/promises'
import { join } from 'path'

type ImagensCardapio = {
  pizza?: string
  lanche?: string
  bebida?: string
  suco?: string
  ativo: boolean
}

async function checkAdmin(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return false
  const user = await verifyToken(token)
  return user?.role === 'admin' || user?.role === 'dev'
}

export async function GET() {
  const imagens = await redis.get<ImagensCardapio>('cardapio:imagens') || { ativo: true }
  return NextResponse.json(imagens)
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const categoria = formData.get('categoria') as string

    if (!file || !categoria) return NextResponse.json({ error: 'Arquivo ou categoria inválidos' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const filename = `${categoria}.jpg`
    const path = join(process.cwd(), 'public', 'cardapio', filename)

    await writeFile(path, buffer)

    const baseUrl = process.env.NEXT_PUBLIC_URL ?? 'https://chefebot-pjif.vercel.app'
    const url = `${baseUrl}/cardapio/${filename}?t=${Date.now()}`

    const imagens = await redis.get<ImagensCardapio>('cardapio:imagens') || { ativo: true }
    const novasImagens = { ...imagens, [categoria]: url }
    await redis.set('cardapio:imagens', novasImagens)

    return NextResponse.json({ url })
  } catch (err) {
    console.error('[ChefeBot] Erro upload imagem:', err)
    return NextResponse.json({ error: 'Erro ao fazer upload' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const { ativo } = await req.json()
  const imagens = await redis.get<ImagensCardapio>('cardapio:imagens') || { ativo: true }
  await redis.set('cardapio:imagens', { ...imagens, ativo })
  return NextResponse.json({ ok: true })
}