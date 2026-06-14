import { useMemo } from 'react'

/**
 * Parses YYYY-MM-DD string into Date object.
 */
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-')
  return new Date(y, m - 1, d)
}

/**
 * Formats Date object into YYYY-MM-DD.
 */
function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getColor(count) {
  if (count === 0) return 'var(--color-bg-tertiary)'
  if (count <= 5) return 'var(--color-success-subtle)'
  if (count <= 15) return '#34d399' // medium green
  return 'var(--color-success)' // dark green
}

export default function StudyHeatmap({ sessions = [] }) {
  const { weeks, currentStreak, maxStreak, totalReviews } = useMemo(() => {
    // 1. Process data
    const sessionMap = {}
    let max = 0
    let total = 0
    sessions.forEach(s => {
      sessionMap[s.date] = s.count
      if (s.count > max) max = s.count
      total += s.count
    })

    // 2. Calculate Streaks
    // Sort dates descending
    const sortedDates = Object.keys(sessionMap).sort((a, b) => (a < b ? 1 : -1))
    
    let cStreak = 0
    let mStreak = 0
    
    const todayStr = formatDate(new Date())
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    
    // Calculate current streak
    let checkDate = new Date()
    if (!sessionMap[todayStr]) {
      checkDate = yesterday // If haven't studied today, streak depends on yesterday
    }
    
    while (true) {
      const dStr = formatDate(checkDate)
      if (sessionMap[dStr] > 0) {
        cStreak++
        checkDate.setDate(checkDate.getDate() - 1)
      } else {
        break
      }
    }

    // Calculate max streak (simple scan)
    const allDates = new Set(sortedDates)
    for (const date of sortedDates) {
      let run = 1
      let d = parseDate(date)
      d.setDate(d.getDate() - 1)
      while (allDates.has(formatDate(d))) {
        run++
        d.setDate(d.getDate() - 1)
      }
      if (run > mStreak) mStreak = run
    }

    // 3. Generate Grid (Last 365 Days)
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 364)

    // Find the Sunday before `start` to align the grid
    const startDay = start.getDay()
    start.setDate(start.getDate() - startDay)

    const gridWeeks = []
    let currentWeek = []
    let curr = new Date(start)

    while (curr <= end) {
      const dStr = formatDate(curr)
      currentWeek.push({
        date: dStr,
        count: sessionMap[dStr] || 0
      })

      if (currentWeek.length === 7) {
        gridWeeks.push(currentWeek)
        currentWeek = []
      }
      curr.setDate(curr.getDate() + 1)
    }

    if (currentWeek.length > 0) {
      // pad with nulls
      while (currentWeek.length < 7) {
        currentWeek.push(null)
      }
      gridWeeks.push(currentWeek)
    }

    return { weeks: gridWeeks, currentStreak: cStreak, maxStreak: mStreak, totalReviews: total }
  }, [sessions])

  return (
    <div style={{
      background: 'var(--color-bg-secondary)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-6)',
      border: '1px solid var(--color-border)',
      marginBottom: 'var(--space-8)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        <div>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text)' }}>Study Activity</h3>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
            {totalReviews} reviews in the last year
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Streak</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text)' }}>{currentStreak} <span style={{fontSize: 'var(--text-sm)', fontWeight: 400, color: 'var(--color-text-tertiary)'}}>days</span></div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max Streak</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text)' }}>{maxStreak} <span style={{fontSize: 'var(--text-sm)', fontWeight: 400, color: 'var(--color-text-tertiary)'}}>days</span></div>
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 'var(--space-2)' }}>
        <div style={{ 
          display: 'flex', 
          gap: 4, 
          width: 'max-content' 
        }}>
          {weeks.map((week, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {week.map((day, j) => {
                if (!day) return <div key={j} style={{ width: 12, height: 12 }} />
                return (
                  <div
                    key={day.date}
                    title={`${day.count} reviews on ${day.date}`}
                    style={{
                      width: 12,
                      height: 12,
                      backgroundColor: getColor(day.count),
                      borderRadius: 2,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
