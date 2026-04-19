import { useRef, useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { useAppStore } from '../store'
import { sendMessage } from '../api/chat'
import { resolveChunk } from '../api/pdfs'
import { extractConcepts } from '../api/chat'
import { useVoiceRecorder, RECORDER_STATE } from '../hooks/useVoiceRecorder'
import HighlightIndex from './HighlightIndex'
import './ChatPanel.css'

/**
 * Extend a partial user selection to the nearest sentence boundary using the
 * full chunk text from ChromaDB.
 *
 * Why: Users often release the mouse before completing a sentence, producing
 * truncated highlight_text like "...consumer gui" instead of "...consumer guides
 * and encyclopedias." The index and review session should show the complete thought.
 *
 * Algorithm:
 *  1. De-hyphenate both texts (PDF extraction wraps "treat-\nments" → "treatments")
 *  2. Find the selection's start in the chunk
 *  3. Walk forward from the selection's end to the nearest sentence terminator (. ! ?)
 *  4. If the original ends within 120 chars of a sentence end, return the extended text
 *     (avoid bloating short selections that already capture a full sentence)
 *  5. Return original if chunk text isn't available or match fails
 */
function extendToSentenceBoundary(selectionText, chunkText) {
  if (!chunkText || !selectionText) return selectionText

  const clean = (t) => t.replace(/-\r?\n/g, '').replace(/\s+/g, ' ').trim()
  const cleanSel   = clean(selectionText)
  const cleanChunk = clean(chunkText)

  const startIdx = cleanChunk.indexOf(cleanSel.slice(0, 40))
  if (startIdx === -1) return selectionText

  const endIdx = startIdx + cleanSel.length

  // Already ends at sentence boundary — don't change
  if (/[.!?]$/.test(cleanSel)) return cleanSel

  // Look for sentence end within 150 chars after the selection's end
  const window = cleanChunk.slice(endIdx, endIdx + 150)
  const match = window.match(/^(.*?[.!?])(?:\s|$)/)
  if (match) return cleanChunk.slice(startIdx, endIdx + match[1].length)

  return cleanSel
}

export default function ChatPanel() {
  const {
    selectedPdf,
    chatHistory,
    addMessage,
    clearHistory,
    setLastResponse,
    isLoading,
    setLoading,
    sources,
    webSearchTriggered,
    setCurrentPage,
    selectionContext,
    clearSelectionContext,
    addNote,
    notes,
    saveToIndex,
    highlightIndex,
  } = useAppStore()

  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState('chat') // 'chat' | 'index'
  const [logPrompt, setLogPrompt] = useState(null) // { question, answer, selectionText, selectionPage }
  const [showNotes, setShowNotes] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState(null) // index of message whose copy was just clicked
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // ── Relative timestamp ─────────────────────────────────────────────────────
  const relativeTime = (iso) => {
    if (!iso) return ''
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (diff < 10) return 'just now'
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return new Date(iso).toLocaleDateString()
  }

  // ── Copy handler ───────────────────────────────────────────────────────────
  const handleCopy = (content, idx) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    })
  }

  // ── Clear history ──────────────────────────────────────────────────────────
  const handleClear = () => {
    if (window.confirm('Clear chat history? This cannot be undone.')) {
      clearHistory()
      setLogPrompt(null)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, isLoading, logPrompt])

  // ── send ──────────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (overrideText) => {
      const rawText = (overrideText ?? input).trim()
      if (!rawText || !selectedPdf || isLoading) return

      const ctx = useAppStore.getState().selectionContext

      setInput('')
      clearSelectionContext()
      setLogPrompt(null)

      addMessage('user', rawText, ctx ? { selectionText: ctx.text, selectionPage: ctx.pageNumber } : null)
      setLoading(true)

      // Short queries without a selection get quick mode (skip 5-layer template)
      const isQuick = !ctx && rawText.trim().split(/\s+/).length < 8

      try {
        const data = await sendMessage({
          pdfId: selectedPdf.id,
          message: rawText,
          history: chatHistory,
          selectionText: ctx?.text,
          selectionPage: ctx?.pageNumber,
          sectionTitle: ctx?.sectionTitle,
          mode: isQuick ? 'quick' : null,
        })
        addMessage('assistant', data.answer)
        setLastResponse({ sources: data.sources || [], webSearchTriggered: data.web_search_triggered })

        // Prompt to log if the question was about a highlight
        if (ctx) {
          setLogPrompt({
            question: rawText,
            answer: data.answer,
            selectionText: ctx.text,
            selectionPage: ctx.pageNumber,
            sectionTitle: ctx.sectionTitle,
            sectionPath: ctx.sectionPath,
          })
        }
      } catch (err) {
        addMessage('assistant', `Error: ${err.response?.data?.detail || err.message}`)
      } finally {
        setLoading(false)
        inputRef.current?.focus()
      }
    },
    [input, selectedPdf, isLoading, chatHistory, addMessage, setLastResponse, setLoading, clearSelectionContext],
  )

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── index save ────────────────────────────────────────────────────────────

  const handleSaveToIndex = async () => {
    if (!logPrompt || !selectedPdf || isSaving) return
    setIsSaving(true)

    // Fire chunk resolution and concept extraction in parallel.
    // Both are non-fatal — save proceeds with whatever succeeds.
    const [resolved, concepts] = await Promise.all([
      resolveChunk(selectedPdf.id, logPrompt.selectionText, logPrompt.selectionPage)
        .catch(() => null),
      extractConcepts(logPrompt.selectionText, logPrompt.answer)
        .catch(() => []),
    ])

    saveToIndex({
      pdfId: selectedPdf.id,
      pdfTitle: selectedPdf.title,
      pageNumber: logPrompt.selectionPage,
      sectionTitle: logPrompt.sectionTitle,
      sectionPath: logPrompt.sectionPath,
      deepSectionPath: resolved?.section_path?.length > 0 ? resolved.section_path : null,
      chunkId: resolved?.chunk_id || null,
      concepts,
      highlightText: extendToSentenceBoundary(logPrompt.selectionText, resolved?.chunk_text),
      question: logPrompt.question,
      answer: logPrompt.answer,
      sourceChunkIds: resolved?.chunk_id ? [resolved.chunk_id] : [],
    })
    setIsSaving(false)
    setLogPrompt(null)
    setActiveTab('index')
  }

  // ── selection action handler ───────────────────────────────────────────────

  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      const action = state.pendingSelectionAction
      if (!action || action === prev.pendingSelectionAction) return
      useAppStore.setState({ pendingSelectionAction: null })

      if (action.id === 'note') {
        const ctx = state.selectionContext
        if (ctx && selectedPdf) {
          addNote({ pdfId: selectedPdf.id, pdfTitle: selectedPdf.title, pageNumber: ctx.pageNumber, highlight: ctx.text, note: '', createdAt: new Date().toISOString() })
          clearSelectionContext()
        }
        return
      }
      if (action.id === 'voice') { startRecording(); return }

      if (action.id === 'view-index') {
        useAppStore.setState({ indexFocus: { text: action.text, pageNumber: action.pageNumber } })
        setActiveTab('index')
        return
      }

      if (action.prompt) { setInput(action.prompt); setTimeout(() => handleSend(action.prompt), 0) }
    })
    return unsub
  }, [selectedPdf, addNote, clearSelectionContext, handleSend])

  // ── voice ─────────────────────────────────────────────────────────────────

  const onTranscript = useCallback(
    (text) => { setInput(text); setTimeout(() => handleSend(text), 0) },
    [handleSend],
  )

  const { state: recState, error: recError, startRecording, stopRecording, clearError } =
    useVoiceRecorder({ onTranscript })

  const isRecording = recState === RECORDER_STATE.RECORDING
  const isTranscribing = recState === RECORDER_STATE.TRANSCRIBING
  const isRequesting = recState === RECORDER_STATE.REQUESTING
  const micBusy = isRecording || isTranscribing || isRequesting
  const disabled = !selectedPdf || isLoading

  const handleMicClick = () => {
    if (isRecording) stopRecording()
    else if (!disabled && !isTranscribing && !isRequesting) startRecording()
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const pdfNotes = notes.filter((n) => n.pdfId === selectedPdf?.id)
  const pdfIndexCount = highlightIndex.filter((e) => e.pdfId === selectedPdf?.id).length

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <aside className="chat-panel">
      {/* Header with tab switcher */}
      <div className="chat-header">
        <div className="chat-tabs">
          <button
            className={`chat-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            className={`chat-tab ${activeTab === 'index' ? 'active' : ''}`}
            onClick={() => setActiveTab('index')}
          >
            Index
            {pdfIndexCount > 0 && <span className="tab-badge">{pdfIndexCount}</span>}
          </button>
        </div>
        {selectedPdf && (
          <span className="chat-pdf-name" title={selectedPdf.title}>{selectedPdf.title}</span>
        )}
        {chatHistory.length > 0 && activeTab === 'chat' && (
          <button className="chat-clear-btn" onClick={handleClear} title="Clear chat history">
            Clear
          </button>
        )}
        {pdfNotes.length > 0 && activeTab === 'chat' && (
          <button className="notes-toggle" onClick={() => setShowNotes((v) => !v)} title="Saved notes">
            📌 {pdfNotes.length}
          </button>
        )}
      </div>

      {/* Index tab */}
      {activeTab === 'index' && <HighlightIndex />}

      {/* Chat tab */}
      {activeTab === 'chat' && (
        <>
          {/* Notes drawer */}
          {showNotes && pdfNotes.length > 0 && (
            <div className="notes-drawer">
              <div className="notes-drawer-header">
                Saved Notes
                <button className="notes-drawer-close" onClick={() => setShowNotes(false)}>✕</button>
              </div>
              <ul className="notes-list">
                {pdfNotes.map((note) => (
                  <li key={note.id} className="note-item">
                    <button className="note-page" onClick={() => setCurrentPage(note.pageNumber)}>p.{note.pageNumber}</button>
                    <span className="note-highlight">"{note.highlight.slice(0, 80)}{note.highlight.length > 80 ? '…' : ''}"</span>
                    <button className="note-delete" onClick={() => useAppStore.getState().deleteNote(note.id)}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="chat-messages">
            {!selectedPdf && <p className="chat-empty">Select a PDF to start chatting</p>}
            {chatHistory.length === 0 && selectedPdf && (
              <p className="chat-empty">Ask anything about "{selectedPdf.title}"</p>
            )}

            {chatHistory.map((msg, i) => (
              <div key={i} className={`message message-${msg.role}`}>
                {msg.meta?.selectionText && (
                  <div className="message-selection-quote">
                    <span className="message-selection-page">p.{msg.meta.selectionPage}</span>
                    <span className="message-selection-text">
                      "{msg.meta.selectionText.slice(0, 80)}{msg.meta.selectionText.length > 80 ? '…' : ''}"
                    </span>
                  </div>
                )}
                <div className="message-bubble-wrap">
                  {msg.role === 'assistant'
                    ? <div className="message-bubble"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                    : <div className="message-bubble">{msg.content}</div>}
                  {msg.role === 'assistant' && (
                    <button
                      className={`message-copy-btn ${copiedIdx === i ? 'copied' : ''}`}
                      onClick={() => handleCopy(msg.content, i)}
                      title="Copy response"
                    >
                      {copiedIdx === i ? '✓' : '⎘'}
                    </button>
                  )}
                </div>
                {msg.createdAt && (
                  <span className={`message-time message-time-${msg.role}`}>{relativeTime(msg.createdAt)}</span>
                )}
                {msg.role === 'assistant' && i === chatHistory.length - 1 && sources.length > 0 && (
                  <div className="message-sources">
                    {webSearchTriggered && <span className="source-badge web">🌐 Web search</span>}
                    {!webSearchTriggered &&
                      [...new Set(sources.map((s) => s.page_number))].map((page) => (
                        <button key={page} className="source-badge" onClick={() => page && setCurrentPage(page)} title={`Jump to page ${page}`}>
                          p.{page}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="message message-assistant">
                <div className="message-bubble typing"><span /><span /><span /></div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Log-to-index prompt — outside scroll area so it's always visible */}
          {logPrompt && !isLoading && (
            <div className="log-prompt">
              <span className="log-prompt-icon">📚</span>
              <span className="log-prompt-text">Log this highlight &amp; Q&amp;A to your index?</span>
              <div className="log-prompt-actions">
                <button className="log-prompt-save" onClick={handleSaveToIndex} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save to Index'}
                </button>
                <button className="log-prompt-skip" onClick={() => setLogPrompt(null)}>Skip</button>
              </div>
            </div>
          )}

          {/* Selection context chip */}
          {selectionContext && (
            <div className="selection-chip">
              <span className="selection-chip-icon">✂</span>
              <span className="selection-chip-text">
                p.{selectionContext.pageNumber} — "{selectionContext.text.slice(0, 50)}{selectionContext.text.length > 50 ? '…' : ''}"
              </span>
              <button className="selection-chip-clear" onClick={clearSelectionContext} title="Clear">✕</button>
            </div>
          )}

          {/* Recording indicator */}
          {(isRecording || isTranscribing || isRequesting) && (
            <div className="recording-bar">
              <span className={`recording-dot ${isRecording ? 'pulsing' : ''}`} />
              <span className="recording-label">
                {isRequesting && 'Requesting microphone…'}
                {isRecording && 'Recording… click mic to stop (min 1.5s)'}
                {isTranscribing && 'Transcribing…'}
              </span>
            </div>
          )}

          {recState === RECORDER_STATE.ERROR && recError && (
            <div className="mic-error" onClick={clearError} role="button" tabIndex={0}>
              <span>⚠ {recError}</span>
              <span className="mic-error-dismiss">✕</span>
            </div>
          )}

          <div className="chat-input-area">
            <button
              className={`mic-btn ${isRecording ? 'mic-recording' : ''} ${isTranscribing ? 'mic-transcribing' : ''}`}
              onClick={handleMicClick}
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled || isTranscribing || isRequesting}
              title={isRecording ? 'Click to stop recording' : 'Click to start recording'}
              aria-label="Voice input"
            >
              {isTranscribing ? (
                <span className="mic-spinner" />
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V20H9v2h6v-2h-2v-2.07A7 7 0 0 0 19 11h-2z" />
                </svg>
              )}
            </button>

            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder={
                selectionContext ? 'Ask about the selection…'
                  : selectedPdf ? isRecording ? 'Listening…' : 'Ask a question…'
                  : 'Select a PDF first'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || micBusy}
              rows={2}
            />

            <button
              className="chat-send"
              onClick={() => handleSend()}
              disabled={disabled || !input.trim() || micBusy}
              title="Send (Enter)"
            >
              ↑
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
