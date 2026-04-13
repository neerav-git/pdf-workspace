import client from './client'

export const sendMessage = ({ pdfId, message, history }) =>
  client
    .post('/chat', {
      pdf_id: pdfId,
      message,
      history,
    })
    .then((r) => r.data)
