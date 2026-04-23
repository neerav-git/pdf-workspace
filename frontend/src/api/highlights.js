import client from './client'

// ── Highlight entries ─────────────────────────────────────────────────────────

export const fetchHighlights = (pdfId) =>
  client.get(`/pdfs/${pdfId}/highlights`).then((r) => r.data)

export const postHighlight = (pdfId, body) =>
  client.post(`/pdfs/${pdfId}/highlights`, body).then((r) => r.data)

export const patchHighlight = (highlightId, body) =>
  client.patch(`/highlights/${highlightId}`, body).then((r) => r.data)

export const deleteHighlight = (highlightId) =>
  client.delete(`/highlights/${highlightId}`)

// ── Q&A pairs ─────────────────────────────────────────────────────────────────

export const postQA = (highlightId, body, { force = false } = {}) =>
  client
    .post(`/highlights/${highlightId}/qa${force ? '?force=true' : ''}`, body)
    .then((r) => r.data)

export const patchQA = (qaId, body) =>
  client.patch(`/qa/${qaId}`, body).then((r) => r.data)

export const mergeAnswerIntoQA = (qaId, body) =>
  client.post(`/qa/${qaId}/merge-answer`, body).then((r) => r.data)

export const deleteQA = (qaId) =>
  client.delete(`/qa/${qaId}`)

// ── Dedup telemetry (deep-fix step 2) ─────────────────────────────────────────

export const logDedupChoice = (payload) =>
  client.post('/session-events/dedup-choice', payload).then((r) => r.data)
