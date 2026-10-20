import { notFound } from 'next/navigation'
import Ranking3Preview from './Ranking3Preview'
export const dynamic = 'force-dynamic'
export default function Page() {
  if (process.env.VERCEL_ENV !== 'preview') notFound()
  return <Ranking3Preview />
}
