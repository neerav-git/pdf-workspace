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

export const postQA = (highlightId, body) =>
  client.post(`/highlights/${highlightId}/qa`, body).then((r) => r.data)

export const patchQA = (qaId, body) =>
  client.patch(`/qa/${qaId}`, body).then((r) => r.data)

export const deleteQA = (qaId) =>
  client.delete(`/qa/${qaId}`)
