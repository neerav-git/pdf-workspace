import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  fetchHighlights,
  postHighlight,
  patchHighlight,
  deleteHighlight,
  postQA,
  patchQA,
  deleteQA,
  mergeAnswerIntoQA,
  logDedupChoice,
} from '../api/highlights'

export const useAppStore = create(persist((set, get) => ({
  // PDF library
  pdfs: [],
  researchSessions: [],
  suggestPlacementAfterUpload: false,
  workspaceMode: 'reader',
  selectedPdf: null,
  setPdfs: (pdfs) => set({ pdfs }),
  addPdf: (pdf) => set((s) => ({ pdfs: [pdf, ...s.pdfs] })),
  setResearchSessions: (researchSessions) => set({
    researchSessions,
    pdfs: flattenSessionPdfs(researchSessions),
  }),
  setSuggestPlacementAfterUpload: (value) => set({ suggestPlacementAfterUpload: value }),
  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),

  // Hydrate highlights from DB when a PDF is selected (Research F1: Postgres is source of truth)
  selectPdf: async (pdf) => {
    const prevSelected = get().selectedPdf
    const prevHistory = get().chatHistory
    set((s) => ({
      selectedPdf: pdf,
      highlightIndex: [],
      chatHistory: pdf?.id ? (s.chatHistoriesByPdf[pdf.id] || []) : [],
      chatHistoriesByPdf: prevSelected?.id
        ? { ...s.chatHistoriesByPdf, [prevSelected.id]: prevHistory }
        : s.chatHistoriesByPdf,
      sources: [],
      selectionContext: null,
    }))
    if (!pdf?.id) return
    try {
      const entries = await fetchHighlights(pdf.id)
      // Normalize DB rows; inject pdfTitle from the pdf object (not stored in highlight_entries)
      set({ highlightIndex: entries.map((row) => normalizeEntry(row, pdf.title)) })
    } catch (e) {
      console.error('Failed to load highlights:', e)
    }
  },

  refreshHighlightsForPdf: async (pdf = null) => {
    const targetPdf = pdf || get().selectedPdf
    if (!targetPdf?.id) return
    try {
      const entries = await fetchHighlights(targetPdf.id)
      set((s) => ({
        highlightIndex: s.highlightIndex
          .filter((entry) => entry.pdfId !== targetPdf.id)
          .concat(entries.map((row) => normalizeEntry(row, targetPdf.title))),
      }))
    } catch (e) {
      console.error('Failed to refresh highlights:', e)
    }
  },

  // Viewer
  currentPage: 1,
  totalPages: 0,
  setCurrentPage: (p) => set({ currentPage: p }),
  setTotalPages: (n) => set({ totalPages: n }),

  // Text selection context
  selectionContext: null,
  setSelectionContext: (ctx) => set({ selectionContext: ctx }),
  clearSelectionContext: () => set({ selectionContext: null }),
  pendingSelectionAction: null,

  // Saved quick notes (📌 pin)
  notes: [],
  addNote: (note) => set((s) => ({ notes: [{ id: Date.now(), ...note }, ...s.notes] })),
  deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

  // ── Highlight Index ────────────────────────────────────────────────────────
  // Each entry: { id, pdfId, pdfTitle, pageNumber, sectionTitle, sectionPath,
  //               deepSectionPath, chunkId, clusterTag, concepts, highlightText, highlightTexts,
  //               createdAt, starred, flagged, anchored, reviewed, note, synthesis,
  //               qaPairs[] }
  // All writes: POST/PATCH/DELETE to API first → update local state with DB-returned IDs
  highlightIndex: [],

  saveToIndex: async ({ pdfId, pdfTitle, pageNumber, sectionTitle, sectionPath, deepSectionPath, chunkId, concepts, highlightText, cardType = 'manual', question, originalQuestion = null, answer, sourceChunkIds = [], originChatMessageId = null, force = false }) => {
    const s = get()
    const existing = chunkId
      ? s.highlightIndex.find((e) => e.pdfId === pdfId && e.chunkId === chunkId)
      : s.highlightIndex.find((e) => e.pdfId === pdfId && e.highlightText === highlightText)

    if (existing) {
      // Chunk already exists — add new Q&A pair to it; backend owns topic/facet
      // classification now, so we only maintain merged highlight texts locally.
      const existingTexts = existing.highlightTexts || [existing.highlightText]
      const mergedTexts = existingTexts.includes(highlightText) ? existingTexts : [...existingTexts, highlightText]

      try {
        // card_type declares which action produced this card; server derives study_question.
        // Server may 409 on a near-duplicate — surface it up so the caller can prompt the user.
        const qa = await postQA(existing.id, {
          card_type: cardType,
          question,
          original_question: originalQuestion,
          answer,
          source_chunk_ids: sourceChunkIds,
          selection_text: highlightText,
          origin_chat_message_id: originChatMessageId,
        }, { force })
        await patchHighlight(existing.id, { highlight_texts: mergedTexts })
        const refreshed = await fetchHighlights(pdfId)
        set((s2) => ({
          highlightIndex: s2.highlightIndex
            .filter((e) => e.pdfId !== pdfId)
            .concat(refreshed.map((row) => normalizeEntry(row, pdfTitle))),
        }))
        return { entryId: existing.id, qaId: qa.id }
      } catch (e) {
        const dup = interpretDuplicateError(e, {
          pdfId,
          highlightId: existing.id,
          attemptedStudyQuestion: question,
          cardType,
        })
        if (dup) return dup
        console.error('saveToIndex (merge) failed:', e)
        throw e
      }
    }

    // New entry — POST highlight, then POST QA under it. A 409 on the QA here
    // means the highlight was just created but the QA collided with a pre-existing
    // card on the same highlight (rare — only if the highlight-merge lookup above
    // missed). Caller can retry with force=true.
    let createdEntry
    try {
      createdEntry = await postHighlight(pdfId, {
        page_number: pageNumber,
        highlight_text: highlightText,
        highlight_texts: [highlightText],
        chunk_id: chunkId || null,
        section_title: sectionTitle || null,
        section_path: sectionPath || [],
        deep_section_path: deepSectionPath || null,
        concepts: [],
        note: '',
      })
      const qa = await postQA(createdEntry.id, {
        card_type: cardType,
        question,
        original_question: originalQuestion,
        answer,
        source_chunk_ids: sourceChunkIds,
        selection_text: highlightText,
        origin_chat_message_id: originChatMessageId,
      }, { force })
      const refreshed = await fetchHighlights(pdfId)
      set((s2) => ({
        highlightIndex: s2.highlightIndex
          .filter((e) => e.pdfId !== pdfId)
          .concat(refreshed.map((row) => normalizeEntry(row, pdfTitle))),
      }))
      return { entryId: createdEntry.id, qaId: qa.id }
    } catch (e) {
      if (createdEntry) {
        const dup = interpretDuplicateError(e, {
          pdfId,
          highlightId: createdEntry.id,
          attemptedStudyQuestion: question,
          cardType,
        })
        if (dup) return dup
      }
      console.error('saveToIndex (new) failed:', e)
      throw e
    }
  },

  // Follow-up action taken after saveToIndex returns a duplicate result.
  // `choice` is one of "open_existing" | "merge" | "force_save" | "dismiss".
  resolveDuplicateConflict: async ({ choice, duplicate, payload }) => {
    try { await logDedupChoice({
      pdf_id: payload?.pdfId ?? null,
      highlight_id: duplicate.highlightId,
      choice,
      existing_qa_id: duplicate.existingQaId,
      similarity: duplicate.similarity,
      attempted_study_question: duplicate.attemptedStudyQuestion,
      card_type: duplicate.cardType,
    }) } catch (_) { /* telemetry only — never block the user's choice */ }

    if (choice === 'open_existing' || choice === 'dismiss') {
      return { entryId: duplicate.highlightId, qaId: duplicate.existingQaId }
    }
    if (choice === 'merge') {
      try {
        const merged = await mergeAnswerIntoQA(duplicate.existingQaId, {
          appended_answer: payload.answer,
          appended_from_qa_question: payload.question,
        })
        // Replace the matching QA in local state so the merged answer shows immediately.
        set((s2) => ({
          highlightIndex: s2.highlightIndex.map((e) =>
            e.id === duplicate.highlightId
              ? { ...e, qaPairs: e.qaPairs.map((q) => (q.id === merged.id ? normalizeQA(merged) : q)) }
              : e,
          ),
        }))
        return { entryId: duplicate.highlightId, qaId: merged.id }
      } catch (e) {
        console.error('mergeAnswerIntoQA failed:', e)
        throw e
      }
    }
    if (choice === 'force_save') {
      return get().saveToIndex({ ...payload, force: true })
    }
    return null
  },

  toggleStarEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    // Optimistic update
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, starred: !e.starred } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { starred: !entry.starred })
    } catch (e) {
      // Rollback
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, starred: entry.starred } : en,
        ),
      }))
      console.error('toggleStarEntry failed:', e)
    }
  },

  toggleFlagEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, flagged: !e.flagged } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { flagged: !entry.flagged })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, flagged: entry.flagged } : en,
        ),
      }))
      console.error('toggleFlagEntry failed:', e)
    }
  },

  toggleAnchorEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, anchored: !e.anchored } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { anchored: !entry.anchored })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, anchored: entry.anchored } : en,
        ),
      }))
      console.error('toggleAnchorEntry failed:', e)
    }
  },

  toggleReviewedEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, reviewed: !e.reviewed } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { reviewed: !entry.reviewed })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, reviewed: entry.reviewed } : en,
        ),
      }))
      console.error('toggleReviewedEntry failed:', e)
    }
  },

  toggleStarQA: async (entryId, qaId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    const qa = entry?.qaPairs?.find((q) => q.id === qaId)
    if (!qa) return
    // Optimistic update
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId
          ? { ...e, qaPairs: e.qaPairs.map((q) => (q.id === qaId ? { ...q, starred: !q.starred } : q)) }
          : e,
      ),
    }))
    try {
      await patchQA(qaId, { starred: !qa.starred })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId
            ? { ...en, qaPairs: en.qaPairs.map((q) => (q.id === qaId ? { ...q, starred: qa.starred } : q)) }
            : en,
        ),
      }))
      console.error('toggleStarQA failed:', e)
    }
  },

  // Note: caller should debounce this (e.g. fire on blur or after 800ms idle)
  setEntryNote: async (entryId, text) => {
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, note: text } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { note: text })
    } catch (e) {
      console.error('setEntryNote failed:', e)
    }
  },

  setSynthesis: async (entryId, text) => {
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, synthesis: text } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { synthesis: text })
    } catch (e) {
      console.error('setSynthesis failed:', e)
    }
  },

  setDeepSynthesis: async (entryId, text) => {
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, deepSynthesis: text || null } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { deep_synthesis: text || '' })
    } catch (e) {
      console.error('setDeepSynthesis failed:', e)
    }
  },

  deleteIndexEntry: async (entryId) => {
    const prev = get().highlightIndex
    set((s) => ({ highlightIndex: s.highlightIndex.filter((e) => e.id !== entryId) }))
    try {
      await deleteHighlight(entryId)
    } catch (e) {
      set({ highlightIndex: prev })
      console.error('deleteIndexEntry failed:', e)
    }
  },

  deleteIndexQA: async (entryId, qaId) => {
    const prev = get().highlightIndex
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, qaPairs: e.qaPairs.filter((q) => q.id !== qaId) } : e,
      ),
    }))
    try {
      await deleteQA(qaId)
    } catch (e) {
      set({ highlightIndex: prev })
      console.error('deleteIndexQA failed:', e)
    }
  },

  // Index focus — set when user clicks "View Index" from selection menu
  // { text, pageNumber } — HighlightIndex uses this to scroll to the right entry
  indexFocus: null,
  setIndexFocus: (focus) => set({ indexFocus: focus }),
  clearIndexFocus: () => set({ indexFocus: null }),

  // External page navigation — set by any panel (index, notes) to scroll the PDF viewer
  navRequest: null,
  requestNav: (page) => set({ navRequest: page }),
  consumeNavRequest: () => set({ navRequest: null }),

  // Flash highlight — set when navigating from index to a specific passage
  // { text, pageNumber } — PDFViewer applies a temporary highlight on the target text
  flashHighlight: null,
  setFlashHighlight: (payload) => set({ flashHighlight: payload }),
  consumeFlashHighlight: () => set({ flashHighlight: null }),

  // Review session
  // scope: null = global | { pdfId } = PDF-scoped | { cards: [...] } = specific pre-loaded cards
  reviewMode: false,
  reviewScope: null,
  openReview: (scope = null) => set({ reviewMode: true, reviewScope: scope }),
  closeReview: () => set({ reviewMode: false, reviewScope: null }),

  // Chat
  chatHistoriesByPdf: {},
  chatHistory: [],
  sources: [],
  webSearchTriggered: false,
  isLoading: false,

  addMessage: (role, content, meta = null) =>
    set((s) => ({
      ...(() => {
        const message = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          content,
          meta,
          createdAt: new Date().toISOString(),
        }
        const nextHistory = [...s.chatHistory, message]
        return {
          chatHistory: nextHistory,
          chatHistoriesByPdf: s.selectedPdf?.id
            ? { ...s.chatHistoriesByPdf, [s.selectedPdf.id]: nextHistory }
            : s.chatHistoriesByPdf,
        }
      })(),
    })),

  clearHistory: () =>
    set((s) => ({
      chatHistory: [],
      chatHistoriesByPdf: s.selectedPdf?.id
        ? { ...s.chatHistoriesByPdf, [s.selectedPdf.id]: [] }
        : s.chatHistoriesByPdf,
      sources: [],
      webSearchTriggered: false,
    })),

  setLastResponse: ({ sources, webSearchTriggered }) =>
    set({ sources, webSearchTriggered }),

  setLoading: (v) => set({ isLoading: v }),
}), {
  name: 'pdf-workspace-chat',
  storage: createJSONStorage(() => localStorage),
  version: 1,
  partialize: (state) => ({
    chatHistoriesByPdf: state.chatHistoriesByPdf,
    suggestPlacementAfterUpload: state.suggestPlacementAfterUpload,
    workspaceMode: state.workspaceMode,
  }),
}))

// ── 409 dedup response parser ─────────────────────────────────────────────────
//
// The server 409 body looks like:
//   { detail: { code: 'duplicate_study_question',
//               existing_qa_id, existing_study_question, similarity } }
// Return a structured duplicate descriptor on match, or null if the error is
// something else the caller should surface as an error.
function interpretDuplicateError(err, { pdfId, highlightId, attemptedStudyQuestion, cardType }) {
  const status = err?.response?.status
  const detail = err?.response?.data?.detail
  if (status !== 409 || !detail || detail.code !== 'duplicate_study_question') return null
  return {
    duplicate: true,
    pdfId,
    highlightId,
    existingQaId: detail.existing_qa_id,
    existingStudyQuestion: detail.existing_study_question,
    similarity: detail.similarity,
    attemptedStudyQuestion,
    cardType,
  }
}

// ── Normalizers — map DB snake_case to UI camelCase ───────────────────────────

export function normalizeEntry(row, pdfTitle = null) {
  return {
    id:               row.id,
    pdfId:            row.pdf_id,
    pdfTitle:         pdfTitle || row.pdfTitle || null,   // injected from selectPdf context
    pageNumber:       row.page_number,
    sectionTitle:     row.section_title,
    sectionPath:      row.section_path || [],
    deepSectionPath:  row.deep_section_path || null,
    chunkId:          row.chunk_id || null,
    clusterTag:       row.cluster_tag || null,
    concepts:         row.concepts || [],
    highlightText:    row.highlight_text,
    highlightTexts:   row.highlight_texts || [row.highlight_text],
    createdAt:        row.created_at,
    starred:          row.starred,
    flagged:          row.flagged,
    anchored:         row.anchored,
    reviewed:         row.reviewed,
    note:             row.note || '',
    synthesis:        row.synthesis || null,
    deepSynthesis:    row.deep_synthesis || null,
    qaPairs:          (row.qa_pairs || []).map(normalizeQA),
  }
}

function flattenSessionPdfs(researchSessions = []) {
  const seen = new Set()
  const pdfs = []
  for (const session of researchSessions) {
    for (const pdf of session.pdfs || []) {
      if (!pdf?.id || seen.has(pdf.id)) continue
      seen.add(pdf.id)
      pdfs.push(pdf)
    }
  }
  return pdfs
}

export function normalizeQA(row) {
  return {
    id:              row.id,
    cardType:        row.card_type || 'manual',
    question:        row.question,
    originalQuestion: row.original_question || null,
    studyQuestion:   row.study_question || null,
    answer:          row.answer,
    source_chunk_ids: row.source_chunk_ids || [],
    sourceChunkIds:  row.source_chunk_ids || [],
    selectionText:   row.selection_text || null,
    starred:         row.starred,
    rhetoricalFacet: row.rhetorical_facet || null,
    facetConfidence: row.facet_confidence ?? null,
    topicTags:       row.topic_tags || [],
    originChatMessageId: row.origin_chat_message_id ?? null,
    questionContext: normalizeQuestionContext(row.question_context),
    // FSRS fields (needed by review session — Research B1)
    stability:       row.stability,
    difficulty:      row.difficulty,
    reps:            row.reps,
    lapses:          row.lapses,
    state:           row.state,
    dueAt:           row.due_at,
    lastReview:      row.last_review,
    createdAt:       row.created_at,
  }
}

export function normalizeQuestionContext(row) {
  if (!row || typeof row !== 'object') return null
  const sourceLocator = row.source_locator && typeof row.source_locator === 'object'
    ? {
        page: row.source_locator.page ?? null,
        sectionTitle: row.source_locator.section_title ?? null,
        highlightId: row.source_locator.highlight_id ?? null,
        chatTurnId: row.source_locator.chat_turn_id ?? null,
        pdfId: row.source_locator.pdf_id ?? null,
      }
    : {
        page: null,
        sectionTitle: null,
        highlightId: null,
        chatTurnId: null,
        pdfId: null,
      }

  return {
    questionOrigin: row.question_origin || 'manual',
    questionScope: row.question_scope || 'document',
    questionIntent: row.question_intent || 'takeaway',
    contextRequired: Boolean(row.context_required),
    contextSummary: row.context_summary || '',
    sourceExcerptShort: row.source_excerpt_short || '',
    sourceExcerptFull: row.source_excerpt_full || '',
    sourceLocator,
    contextStatus: row.context_status || 'weak',
    reviewPromptMode: row.review_prompt_mode || 'question_only',
    needsDisambiguation: Boolean(row.needs_disambiguation),
  }
}
