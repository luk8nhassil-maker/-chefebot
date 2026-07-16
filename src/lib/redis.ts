import { Redis } from '@upstash/redis'
import { wrapRedisClient } from './redisTelemetry'

const rawRedisClient = new Redis({
  url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
    })

// Envolve o client real com telemetria passiva (ver redisTelemetry.ts):
// mesma API, mesmo comportamento, mesmos retornos e erros — só observa
// comandos/latência/erros para o painel /dev/redis-status. Nunca altera o
// que é lido/gravado no Redis.
export const redis = wrapRedisClient(rawRedisClient)