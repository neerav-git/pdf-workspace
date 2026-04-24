import client from './client'

export const fetchDueCards = (pdfId = null, limit = 20) => {
  const url = pdfId ? `/pdfs/${pdfId}/review/due` : '/review/due'
  return client.get(url, { params: { limit } }).then((r) => r.data)
}

export const submitReview = (body) =>
  client.post('/review/submit', body).then((r) => r.data)

export const fetchReviewStats = () =>
  client.get('/review/stats').then((r) => r.data)

export const fetchCardReviewData = (qaId) =>
  client.get(`/qa/${qaId}/review-data`).then((r) => r.data)
