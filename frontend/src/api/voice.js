import client from './client'

export const transcribeAudio = (blob) => {
  const form = new FormData()
  // Send as webm; backend passes straight to Whisper
  form.append('file', blob, 'recording.webm')
  return client
    .post('/voice/transcribe', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => r.data.text)
}
