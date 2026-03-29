/**
 * Simulates exactly what ChessResultsParser does for both sub-tournaments.
 * Shows the parsed output so we can verify correctness.
 */
import * as cheerio from 'cheerio'

const HEADERS_HTTP: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function fetchUrl(url: string): Promise<string> {
  console.log('  GET', url)
  const res = await fetch(url, { headers: HEADERS_HTTP, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Replicate parser logic exactly ────────────────────────────────────────

function parseStandings(html: string) {
  const $ = cheerio.load(html)
  const standings: any[] = []
  const tables = $('table')

  tables.each((_, table) => {
    const rows = $(table).find('tr')
    if (rows.length < 3) return

    const headers = rows
      .first()
      .find('th, td')
      .map((__, el) => $(el).text().trim().toLowerCase())
      .get()

    if (headers.some((h) => h.includes('\n') || h.length > 100)) {
      console.log(`  [standings] Skipping wrapper table (long/newline header)`)
      return
    }

    const rkIdx = headers.findIndex(
      (h) => h === 'rk.' || h === 'rank' || h.includes('rank'),
    )
    const nameIdx = headers.findIndex(
      (h) => h === 'name' || h.includes('name'),
    )
    const ptsIdx = headers.findIndex(
      (h) => h === 'pts.' || h === 'pts' || h.includes('point'),
    )

    if (rkIdx === -1 || nameIdx === -1 || ptsIdx === -1) {
      console.log(`  [standings] Skipping table (rkIdx=${rkIdx}, nameIdx=${nameIdx}, ptsIdx=${ptsIdx}) headers=${JSON.stringify(headers.slice(0,6))}`)
      return
    }

    console.log(`  [standings] Processing table: headers=${JSON.stringify(headers)}`)
    console.log(`    rkIdx=${rkIdx}, nameIdx=${nameIdx}, ptsIdx=${ptsIdx}`)

    const snrIdx = headers.findIndex(
      (h) => h === 'snr' || h === 'sno' || h === 'no.' || h.includes('start'),
    )
    const ratingIdx = headers.findIndex(
      (h) => h === 'rtg' || h.includes('rating') || h === 'elo',
    )

    rows.slice(1).each((__, row) => {
      const cells = $(row).find('td').map((___, el) => $(el).text().trim()).get()
      const rank = parseInt(cells[rkIdx], 10)
      if (!rank) return

      standings.push({
        rank,
        startNo: snrIdx >= 0 ? parseInt(cells[snrIdx], 10) || 0 : 0,
        name: cells[nameIdx] ?? '',
        rating: ratingIdx >= 0 ? parseInt(cells[ratingIdx], 10) || null : null,
        points: parseFloat(cells[ptsIdx]) || 0,
      })
    })
  })

  return standings
}

function parsePairings(html: string) {
  const $ = cheerio.load(html)
  const pairings: any[] = []
  const tables = $('table')

  tables.each((_, table) => {
    const rows = $(table).find('tr')
    if (rows.length < 2) return

    const headers = rows
      .first()
      .find('th, td')
      .map((__, el) => $(el).text().trim().toLowerCase())
      .get()

    if (headers.some((h) => h.includes('\n') || h.length > 100)) {
      console.log(`  [pairings] Skipping wrapper table (long/newline header)`)
      return
    }

    const boardIdx = headers.findIndex(
      (h) => h === 'bo.' || h === 'board' || h === 'bd' || h.includes('board'),
    )
    const hasResult = headers.some(
      (h) => h === 'result' || h === 'res.' || h.includes('result'),
    )

    if (boardIdx === -1 || !hasResult) {
      if (headers.length > 2) console.log(`  [pairings] Skipping table (boardIdx=${boardIdx}, hasResult=${hasResult}) headers=${JSON.stringify(headers.slice(0,6))}`)
      return
    }

    console.log(`  [pairings] Processing table: headers=${JSON.stringify(headers)}`)

    const resultIdx = headers.findIndex(
      (h) => h === 'result' || h === 'res.' || h.includes('result'),
    )

    rows.slice(1).each((__, row) => {
      const cells = $(row).find('td').map((___, el) => $(el).text().trim()).get()
      const board = parseInt(cells[boardIdx], 10)
      if (!board) return

      const result = cells[resultIdx] ?? ''

      const whiteNameIdx = headers.findIndex(
        (h, i) => i > boardIdx && i < resultIdx &&
          (h === 'name' || h.includes('white') || h.includes('name')),
      )
      const blackNameIdx = headers.findIndex(
        (h, i) => i > resultIdx &&
          (h === 'name' || h.includes('black') || h.includes('name')),
      )

      let whiteName = ''
      let whiteRtg: number | null = null
      let blackName = ''
      let blackRtg: number | null = null

      if (whiteNameIdx >= 0 && blackNameIdx >= 0) {
        whiteName = cells[whiteNameIdx] ?? ''
        blackName = cells[blackNameIdx] ?? ''
        whiteRtg = parseInt(cells[whiteNameIdx + 1], 10) || null
        blackRtg = parseInt(cells[blackNameIdx + 1], 10) || null
      } else {
        whiteName = cells[boardIdx + 2] ?? cells[boardIdx + 1] ?? ''
        whiteRtg = parseInt(cells[boardIdx + 3] ?? cells[boardIdx + 2], 10) || null
        blackName = cells[resultIdx + 2] ?? cells[resultIdx + 1] ?? ''
        blackRtg = parseInt(cells[resultIdx + 3] ?? cells[resultIdx + 2], 10) || null
      }

      if (whiteName || blackName) {
        pairings.push({ board, whiteName, whiteRtg, result, blackName, blackRtg })
      }
    })
  })

  return pairings
}

async function main() {
  const subs = [
    { id: '1381175', label: 'Girls', server: 's2' },
    { id: '1381171', label: 'Open', server: 's2' },
  ]

  for (const sub of subs) {
    console.log(`\n${'#'.repeat(60)}`)
    console.log(`# ${sub.label} (tnr${sub.id})`)
    console.log('#'.repeat(60))

    // Standings (art=1)
    console.log('\n── Standings rd=1 (art=1) ──')
    await sleep(1200)
    try {
      const html = await fetchUrl(`https://${sub.server}.chess-results.com/tnr${sub.id}.aspx?lan=1&art=1&rd=1`)
      const standings = parseStandings(html)
      console.log(`  RESULT: ${standings.length} standings`)
      standings.slice(0, 5).forEach(s => console.log(`    ${JSON.stringify(s)}`))
      if (standings.length === 0) console.log('  *** EMPTY - potential bug ***')
    } catch (e) { console.error('FAIL:', e) }

    // Pairings (art=2)
    console.log('\n── Pairings rd=1 (art=2) ──')
    await sleep(1200)
    try {
      const html = await fetchUrl(`https://${sub.server}.chess-results.com/tnr${sub.id}.aspx?lan=1&art=2&rd=1`)
      const pairings = parsePairings(html)
      console.log(`  RESULT: ${pairings.length} pairings`)
      pairings.slice(0, 3).forEach(p => console.log(`    ${JSON.stringify(p)}`))
      if (pairings.length === 0) console.log('  *** EMPTY - potential bug ***')
    } catch (e) { console.error('FAIL:', e) }
  }

  console.log('\n\n✓ Simulation complete.')
}

main().catch(console.error)
