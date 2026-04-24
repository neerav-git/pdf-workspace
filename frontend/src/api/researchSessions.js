import client from './client'

export const listResearchSessions = () =>
  client.get('/research-sessions').then((r) => r.data)

export const createResearchSession = (body) =>
  client.post('/research-sessions', body).then((r) => r.data)

export const updateResearchSession = (id, body) =>
  client.patch(`/research-sessions/${id}`, body).then((r) => r.data)

export const deleteResearchSession = (id, moveToUnsorted = true) =>
  client.delete(`/research-sessions/${id}`, { params: { move_to_unsorted: moveToUnsorted } })

export const assignPdfToResearchSession = (sessionId, pdfId, replaceExisting = true) =>
  client
    .post(`/research-sessions/${sessionId}/pdfs/${pdfId}`, null, {
      params: { replace_existing: replaceExisting },
    })
    .then((r) => r.data)

export const removePdfFromResearchSession = (sessionId, pdfId) =>
  client.delete(`/research-sessions/${sessionId}/pdfs/${pdfId}`).then((r) => r.data)

export const suggestResearchSession = (pdfIds = []) =>
  client.post('/research-sessions/suggest', { pdf_ids: pdfIds }).then((r) => r.data)

export const suggestPdfPlacement = (pdfId) =>
  client.get(`/research-sessions/suggest-placement/${pdfId}`).then((r) => r.data)

export const getComparativeAnalysis = (sessionId) =>
  client.get(`/research-sessions/${sessionId}/comparative-analysis`).then((r) => r.data)

export const refreshComparativeAnalysis = (sessionId) =>
  client.post(`/research-sessions/${sessionId}/comparative-analysis/refresh`).then((r) => r.data)
