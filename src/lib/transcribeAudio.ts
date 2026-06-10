export async function transcreverAudio(base64: string, mimeType: string): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, 'base64')
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'mp3'
    const blob = new Blob([buffer], { type: mimeType })
    const formData = new FormData()
    formData.append('file', blob, `audio.${ext}`)
    formData.append('model', 'whisper-1')
    formData.append('language', 'pt')
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
    })
    if (!response.ok) return null
    const data = await response.json()
    return data.text || null
  } catch {
    return null
  }
}