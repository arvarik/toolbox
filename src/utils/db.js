import { openDB } from 'idb'

const DB_NAME = 'toolbox_sync'
const DB_VERSION = 1

/**
 * Initialize IndexedDB.
 */
export async function initDB() {
  if (typeof indexedDB === 'undefined') return null;
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache') // key: string (url)
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true })
      }
    },
  })
}

/**
 * Cache a GET response.
 */
export async function setCache(url, data) {
  const db = await initDB()
  if (!db) return
  await db.put('cache', data, url)
}

/**
 * Retrieve a cached GET response.
 */
export async function getCache(url) {
  const db = await initDB()
  if (!db) return null
  return db.get('cache', url)
}

/**
 * Add a mutation (POST/PUT/DELETE) to the sync queue.
 */
export async function enqueueSync(url, options) {
  const db = await initDB()
  if (!db) return
  await db.add('sync_queue', {
    url,
    method: options.method,
    body: options.body,
    headers: options.headers,
    timestamp: Date.now(),
  })
}

/**
 * Process the sync queue.
 */
export async function processSyncQueue() {
  const db = await initDB()
  if (!db) return 0
  const tx = db.transaction('sync_queue', 'readwrite')
  const queueStore = tx.objectStore('sync_queue')
  const queuedItems = await queueStore.getAll()

  if (queuedItems.length === 0) return

  console.log(`[sync] Processing ${queuedItems.length} queued items...`)

  let successCount = 0
  for (const item of queuedItems) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      })
      if (res.ok) {
        await queueStore.delete(item.id)
        successCount++
      } else {
        console.error(`[sync] Failed to sync item ${item.id}:`, res.status)
        // Keep in queue for retry later, or implement max retries
      }
    } catch (err) {
      console.error(`[sync] Network error syncing item ${item.id}:`, err)
      break // Network still down, stop processing
    }
  }

  await tx.done
  console.log(`[sync] Processed ${successCount} items successfully.`)
  return successCount
}
