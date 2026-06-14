import { useState, useRef, useEffect } from 'react'
import { BrainCircuit, Play, Loader, CheckCircle, Mic, MicOff } from 'lucide-react'
import { chatApi } from '../utils/api'
import useAppStore from '../stores/appStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function FeynmanPage() {
  const [topic, setTopic] = useState('')
  const [explanation, setExplanation] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [hasResult, setHasResult] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const addToast = useAppStore(s => s.addToast)
  const feedbackEndRef = useRef(null)
  const recognitionRef = useRef(null)

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

      await chatApi.stream(
        { message: prompt, context: systemContext, history: [] },
        (chunk) => {
          setFeedback(chunk)
          if (feedbackEndRef.current) {
             feedbackEndRef.current.scrollIntoView({ behavior: 'smooth' })
          }
        }
      )
      setHasResult(true)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to analyze explanation.' })
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="page-layout" id="feynman-page" style={{ padding: 'var(--space-6)', maxWidth: 800, margin: '0 auto', width: '100%' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <BrainCircuit className="icon-accent" size={24} />
            Feynman Simulator
          </h1>
          <p className="page-subtitle">
            Explain a concept as simply as possible to identify gaps in your understanding.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
            className="input"
            placeholder="Imagine you are explaining this to someone who has never heard of it before..."
            style={{ minHeight: 150, resize: 'vertical' }}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            disabled={isAnalyzing}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            className="btn btn-primary" 
            onClick={handleAnalyze} 
            disabled={isAnalyzing || !topic.trim() || !explanation.trim()}
          >
            {isAnalyzing ? <Loader className="spin" size={16} /> : <Play size={16} />}
            {isAnalyzing ? 'Analyzing...' : 'Analyze Explanation'}
          </button>
        </div>
      </div>

      {(feedback || isAnalyzing || hasResult) && (
        <div className="card" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <CheckCircle size={20} color="var(--color-success)" />
            Feedback Analysis
          </h2>
          <div className="markdown-body" style={{ color: 'var(--color-text)' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback || 'Waiting for AI...'}</ReactMarkdown>
            <div ref={feedbackEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}
