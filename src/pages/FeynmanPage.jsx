import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrainCircuit, Play, Loader, CheckCircle, Mic, MicOff, Square, MessageSquare, GraduationCap, RotateCcw } from 'lucide-react'
import { chatApi } from '../utils/api'
import useAppStore from '../stores/appStore'
import MarkdownRenderer from '../components/shared/MarkdownRenderer'

export default function FeynmanPage() {
  const navigate = useNavigate()
  const [topic, setTopic] = useState('')
  const [explanation, setExplanation] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [hasResult, setHasResult] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const addToast = useAppStore(s => s.addToast)
  const feedbackEndRef = useRef(null)
  const recognitionRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      
      recognition.onresult = (event) => {
        let finalTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' '
          }
        }
        if (finalTranscript) {
          setExplanation(prev => prev + finalTranscript)
        }
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error)
        setIsRecording(false)
      }

      recognition.onend = () => {
        setIsRecording(false)
      }

      recognitionRef.current = recognition
    }
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      addToast({ type: 'error', message: 'Voice recording is not supported in this browser.' })
      return
    }
    if (isRecording) {
      recognitionRef.current.stop()
      setIsRecording(false)
    } else {
      recognitionRef.current.start()
      setIsRecording(true)
    }
  }

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [])

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
      setIsAnalyzing(false)
      addToast({ type: 'info', message: 'Analysis stopped' })
    }
  }

  const handlePracticeInChat = () => {
    try {
      sessionStorage.setItem(
        'toolbox_chat_draft',
        `I practiced explaining "${topic}" via the Feynman technique simulator.\n\nMy explanation was:\n> ${explanation}\n\nThe feedback highlighted these gaps:\n\n${feedback}\n\nPlease help me master these missing points with Socratic questions!`
      )
      window.dispatchEvent(new CustomEvent('toolbox-chat-draft'))
      navigate('/chat')
    } catch {
      navigate('/chat')
    }
  }

  const handleReset = () => {
    setTopic('')
    setExplanation('')
    setFeedback('')
    setHasResult(false)
  }

  const handleAnalyze = async () => {
    if (!topic.trim() || !explanation.trim()) {
      addToast({ type: 'error', message: 'Please provide both a topic and an explanation.' })
      return
    }

    setIsAnalyzing(true)
    setFeedback('')
    setHasResult(false)

    try {
      const prompt = `Topic: ${topic}\n\nExplanation:\n${explanation}`
      const systemContext = `You are a strict and precise Feynman Technique evaluator. The user is attempting to explain a concept to you as if you were a beginner.
Your job is to analyze their explanation critically and provide structured feedback.

CRITICAL RULES:
1. Do NOT explain the concept for them. 
2. Point out what THEY missed.
3. Point out complex terminology or jargon THEY used without breaking it down.
4. Highlight logical gaps or jumps in their reasoning.

Format your response in Markdown with the exact following sections:
### Missing Key Points
(List crucial information they omitted, focusing on the core principles)

### Unexplained Jargon
(List complex words or terminology they used without explaining them simply)

### Logical Gaps
(List areas where their reasoning breaks down, skips steps, or makes assumptions)

### Overall Assessment
(A brief, constructive summary of their current comprehension level)`

      abortRef.current = new AbortController()
      await chatApi.stream(
        { message: prompt, context: systemContext, history: [] },
        (chunk) => {
          setFeedback(chunk)
          if (feedbackEndRef.current) {
             feedbackEndRef.current.scrollIntoView({ behavior: 'smooth' })
          }
        },
        null,
        abortRef.current.signal
      )
      setHasResult(true)
    } catch (err) {
      if (err.name !== 'AbortError') {
        addToast({ type: 'error', message: err.message || 'Failed to analyze explanation.' })
      }
    } finally {
      setIsAnalyzing(false)
      abortRef.current = null
    }
  }

  return (
    <div className="page-layout feynman-container" id="feynman-page">
      <div className="page-header">
        <div>
          <h1 className="page-title feynman-title">
            <BrainCircuit className="icon-accent" size={24} />
            Feynman Simulator
          </h1>
          <p className="page-subtitle">
            Explain a concept as simply as possible to identify gaps in your understanding.
          </p>
        </div>
      </div>

      <div className="card feynman-card">
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            What concept are you learning?
          </label>
          <input
            className="input"
            placeholder="e.g., DNS, Paxos, React Hooks"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={isAnalyzing}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              Explain it to a beginner:
            </label>
            <button 
              className={`btn btn-sm ${isRecording ? 'btn-primary' : 'btn-outline'}`}
              onClick={toggleRecording}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              disabled={isAnalyzing}
            >
              {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
              {isRecording ? 'Stop Recording' : 'Voice Record'}
            </button>
          </div>
          <textarea
            className="input feynman-textarea"
            placeholder="Imagine you are explaining this to someone who has never heard of it before..."
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            disabled={isAnalyzing}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          {isAnalyzing && (
            <button
              className="btn btn-secondary"
              onClick={handleStop}
              id="feynman-stop-btn"
            >
              <Square size={14} /> Stop
            </button>
          )}
          <button 
            className="btn btn-primary" 
            onClick={handleAnalyze} 
            disabled={isAnalyzing || !topic.trim() || !explanation.trim()}
            id="feynman-analyze-btn"
          >
            {isAnalyzing ? <Loader className="spin" size={16} /> : <Play size={16} />}
            {isAnalyzing ? 'Analyzing...' : 'Analyze Explanation'}
          </button>
        </div>
      </div>

      {(feedback || isAnalyzing || hasResult) && (
        <div className="card feynman-feedback-card">
          <h2 className="feynman-feedback-title">
            <CheckCircle size={20} color="var(--color-success)" />
            Feedback Analysis
          </h2>
          <div className="markdown-body" style={{ color: 'var(--color-text)' }}>
            <MarkdownRenderer content={feedback || 'Waiting for AI...'} />
            <div ref={feedbackEndRef} />
          </div>

          {hasResult && !isAnalyzing && (
            <div style={{
              display: 'flex',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
              marginTop: 'var(--space-4)',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--color-border)',
            }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handlePracticeInChat}
                id="feynman-practice-chat-btn"
              >
                <MessageSquare size={13} /> Practice Gaps in Chat
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/study')}
                id="feynman-study-flashcards-btn"
              >
                <GraduationCap size={13} /> Study Flashcards
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleReset}
                id="feynman-reset-btn"
              >
                <RotateCcw size={13} /> New Topic
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
