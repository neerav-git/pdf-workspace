import client from './client'

export const sendMessage = ({ pdfId, message, history, selectionText, selectionPage, sectionTitle, mode }) =>
  client
    .post('/chat', {
      pdf_id: pdfId,
      message,
      history,
      selection_text: selectionText || null,
      selection_page: selectionPage || null,
      section_title: sectionTitle || null,
      mode: mode || null,
    })
    .then((r) => r.data)

/**
 * Extract 2–4 concept tags from a highlight and its Q&A answer.
 * Returns string[] — empty array on failure.
 */
export const extractConcepts = (highlightText, answer) =>
  client
    .post('/chat/extract-concepts', { highlight_text: highlightText, answer })
    .then((r) => r.data.concepts || [])
    .catch(() => [])

export const prepareStudyCardQuestion = (question, answer, sourceText = '') =>
  client
    .post('/chat/prepare-study-card', {
      question,
      answer,
      source_text: sourceText,
    })
    .then((r) => r.data)
