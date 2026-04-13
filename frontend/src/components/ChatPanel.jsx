import { useRef, useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { sendMessage } from '../api/chat'
import './ChatPanel.css'

export default function ChatPanel() {
  const {
    selectedPdf,
    chatHistory,
    addMessage,
    setLastResponse,
    isLoading,
    setLoading,
    sources,
    webSearchTriggered,
    setCurrentPage,
  } = useAppStore()

  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, isLoading])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !selectedPdf || isLoading) return

    setInput('')
    addMessage('user', text)
    setLoading(true)

    try {
      const data = await sendMessage({
        pdfId: selectedPdf.id,
        message: text,
        history: chatHistory,
      })
      addMessage('assistant', data.answer)
      setLastResponse({
        sources: data.sources || [],
        webSearchTriggered: data.web_search_triggered,
      })
    } catch (err) {
      addMessage('assistant', `Error: ${err.response?.data?.detail || err.message}`)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Chat</span>
        {selectedPdf && (
          <span className="chat-pdf-name">{selectedPdf.title}</span>
        )}
      </div>

      <div className="chat-messages">
        {!selectedPdf && (
          <p className="chat-empty">Select a PDF to start chatting</p>
        )}

        {chatHistory.length === 0 && selectedPdf && (
          <p className="chat-empty">Ask anything about "{selectedPdf.title}"</p>
        )}

        {chatHistory.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-bubble">{msg.content}</div>

            {/* Show sources after the last assistant message */}
            {msg.role === 'assistant' && i === chatHistory.length - 1 && sources.length > 0 && (
              <div className="message-sources">
                {webSearchTriggered && (
                  <span className="source-badge web">🌐 Web search</span>
                )}
                {!webSearchTriggered &&
                  [...new Set(sources.map((s) => s.page_number))].map((page) => (
                    <button
                      key={page}
                      className="source-badge"
                      onClick={() => page && setCurrentPage(page)}
                      title={`Jump to page ${page}`}
                    >
                      p.{page}
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="message message-assistant">
            <div className="message-bubble typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={selectedPdf ? 'Ask a question…' : 'Select a PDF first'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!selectedPdf || isLoading}
          rows={2}
        />
        <button
          className="chat-send"
          onClick={handleSend}
          disabled={!selectedPdf || isLoading || !input.trim()}
          title="Send (Enter)"
        >
          ↑
        </button>
      </div>
    </aside>
  )
}
