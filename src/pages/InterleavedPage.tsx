import { useState, useEffect } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import FlashcardView, { type FlashcardItem } from '../components/study/FlashcardView'
import { KitAvatar } from '../components/ui'
import { flashcardsApi } from '../utils/api'
import useAppStore from '../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../stores/useKitStore'

export default function InterleavedPage() {
  const [cards, setCards] = useState<FlashcardItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()
  const addToast = useAppStore((s) => s.addToast)
  const { kitSlug } = useActiveKit()
  const prefix = useKitRoutePrefix()

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setCards([])

    flashcardsApi
      .dueAll()
      .then((res) => {
        if (cancelled) return
        setCards(Array.isArray(res) ? (res as FlashcardItem[]) : [])
      })
      .catch(() => {
        if (cancelled) return
        addToast({ type: 'error', message: 'Failed to fetch interleaved cards' })
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [kitSlug, prefix, addToast])

  const studyHubRoute = `${prefix}/study`

  if (isLoading) {
    return (
      <div className="study-layout" id="interleaved-page">
        <div className="study-main items-center justify-center gap-2 text-sm text-on-surface-variant">
          <div className="flex items-center gap-2 py-16">
            <Loader2 size={18} className="animate-spin" />
            <span>Loading interleaved review…</span>
          </div>
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
            onBack={() => navigate(studyHubRoute)}
          />
        ) : (
          <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
            <div className="flex justify-center">
              <KitAvatar size={36} state="done" />
            </div>
            <h1 className="font-serif text-2xl font-normal text-on-surface">
              All caught up
            </h1>
            <p className="text-sm text-on-surface-variant">
              Zero due cards remain across your decks right now.
            </p>
            <div className="pt-2">
              <button
                type="button"
                className="btn btn-primary min-h-[44px]"
                onClick={() => navigate(studyHubRoute)}
              >
                <ArrowLeft size={16} />
                Back to Study Hub
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
