import { Router } from 'express'
import db from '../db.js'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../src/utils/constants.js'
import logger from '../utils/logger.js'

const router = Router()

/**
 * GET /api/guide-content/export
 * Exports all committed guide content as a single Markdown file.
 */
router.get('/export', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT pillar_id, topic_id, section_id, content 
      FROM guide_content 
      WHERE content IS NOT NULL AND content != ''
    `).all()

    let markdown = '# Toolbox System Design Guide\\n\\n'

    // Group by Pillar
    for (const pillar of PILLARS) {
      const pillarRows = rows.filter(r => r.pillar_id === pillar.id)
      if (pillarRows.length === 0) continue

      markdown += `## Pillar: ${pillar.name}\\n\\n`

      // Group by Topic
      for (const topic of pillar.topics) {
        const topicRows = pillarRows.filter(r => r.topic_id === topic.id)
        if (topicRows.length === 0) continue

        markdown += `### Topic: ${topic.name}\\n\\n`

        const blueprint = BLUEPRINT_SECTIONS[pillar.id] || []
        
        // Group by Section based on blueprint order
        for (const section of blueprint) {
          const row = topicRows.find(r => r.section_id === section.id)
          if (row) {
            markdown += `#### ${section.name}\\n\\n${row.content}\\n\\n`
          }
        }
      }
    }

    res.setHeader('Content-Type', 'text/markdown')
    res.setHeader('Content-Disposition', 'attachment; filename="system_design_guide.md"')
    res.send(markdown)
  } catch (err) {
    logger.error('[guide-content] Error exporting guide:', err.message)
    res.status(500).json({ message: 'Failed to export guide' })
  }
})

/**
 * GET /api/guide-content/progress
 * Returns a map of { pillarId_topicId_sectionId: true } for all filled sections.
 * Used by the Learning To-Do panel to know which sections have committed content.
 */
router.get('/progress', (req, res) => {
  const rows = db.prepare(`
    SELECT pillar_id, topic_id, section_id, length(content) as len
    FROM guide_content
    WHERE content IS NOT NULL AND content != ''
  `).all()

  const filled = {}
  for (const row of rows) {
    if (row.len > 0) {
      filled[`${row.pillar_id}__${row.topic_id}__${row.section_id}`] = true
    }
  }
  res.json(filled)
})

/**
 * GET /api/guide-content/:pillarId/:topicId
 * Returns all section content for a topic.
 * Returns an object: { sectionId: { content, committed_at } }
 */
router.get('/:pillarId/:topicId', (req, res) => {
  const { pillarId, topicId } = req.params
  const rows = db.prepare(`
    SELECT section_id, content, committed_at
    FROM guide_content
    WHERE pillar_id = ? AND topic_id = ?
  `).all(pillarId, topicId)

  const result = {}
  for (const row of rows) {
    result[row.section_id] = {
      content: row.content,
      committedAt: row.committed_at,
    }
  }
  res.json(result)
})

/**
 * GET /api/guide-content/:pillarId/:topicId/:sectionId
 * Returns content for a single section.
 */
router.get('/:pillarId/:topicId/:sectionId', (req, res) => {
  const { pillarId, topicId, sectionId } = req.params
  const row = db.prepare(`
    SELECT content, committed_at
    FROM guide_content
    WHERE pillar_id = ? AND topic_id = ? AND section_id = ?
  `).get(pillarId, topicId, sectionId)

  if (!row) {
    return res.json({ content: '', committedAt: null })
  }
  res.json({ content: row.content, committedAt: row.committed_at })
})

/**
 * PUT /api/guide-content/:pillarId/:topicId/:sectionId
 * Upsert (create or update) the content for a section.
 * Body: { content: string }
 */
router.put('/:pillarId/:topicId/:sectionId', (req, res) => {
  const { pillarId, topicId, sectionId } = req.params
  const { content } = req.body

  if (content === undefined) {
    return res.status(400).json({ message: 'content is required' })
  }

  db.prepare(`
    INSERT INTO guide_content (pillar_id, topic_id, section_id, content, committed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(pillar_id, topic_id, section_id)
    DO UPDATE SET content = excluded.content, committed_at = excluded.committed_at
  `).run(pillarId, topicId, sectionId, content)

  res.json({ ok: true })
})

/**
 * DELETE /api/guide-content/:pillarId/:topicId/:sectionId
 * Clear the content for a section (resets it to empty).
 */
router.delete('/:pillarId/:topicId/:sectionId', (req, res) => {
  const { pillarId, topicId, sectionId } = req.params
  db.prepare(`
    DELETE FROM guide_content
    WHERE pillar_id = ? AND topic_id = ? AND section_id = ?
  `).run(pillarId, topicId, sectionId)
  res.json({ ok: true })
})

export default router
