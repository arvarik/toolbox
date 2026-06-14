import { useState, useEffect } from 'react'
import { ArrowLeft, Layers } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import FlashcardView from '../components/study/FlashcardView'
import { flashcardsApi } from '../utils/api'
import useAppStore from '../stores/appStore'

export default function InterleavedPage() {
  const [cards, setCards] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()
  const addToast = useAppStore(s => s.addToast)

  useEffect(() => {
    flashcardsApi.dueAll().then(res => {
      setCards(res || [])
    }).catch(() => {
      addToast({ type: 'error', message: 'Failed to fetch interleaved cards' })
    }).finally(() => {
      setIsLoading(false)
    })
  }, [addToast])

  if (isLoading) {
    return (
      <div className="study-layout">
        <div className="study-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p>Loading interleaved review...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="study-layout" id="interleaved-page">
      <div className="study-main">
        {cards.length > 0 ? (
          <FlashcardView
            cards={cards}
            deckName="Interleaved Practice"
            reviewMode={true}
            onBack={() => navigate('/study')}
          />
        ) : (
          <div style={{ textAlign: 'center', marginTop: 'var(--space-12)' }}>
            <div style={{ 
              width: 48, height: 48, borderRadius: 'var(--radius-full)',
              background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', 
              justifyContent: 'center', margin: '0 auto var(--space-4)', color: 'var(--color-accent)'
            }}>
              <Layers size={24} />
            </div>
            <h2 className="page-title">All Caught Up!</h2>
            <p className="page-subtitle" style={{ marginTop: 'var(--space-2)' }}>
              There are no due cards across any of your decks right now.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 'var(--space-6)' }} onClick={() => navigate('/study')}>
              <ArrowLeft size={16} />
              Back to Study Hub
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
