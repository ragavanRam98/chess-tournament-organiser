import * as cheerio from 'cheerio'

const HEADERS_HTTP: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function fetch1(url: string): Promise<string> {
  console.log('GET', url)
  const res = await fetch(url, { headers: HEADERS_HTTP, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function dumpTables(html: string, label: string) {
  const $ = cheerio.load(html)
  console.log(`\n${'='.repeat(70)}`)
  console.log(`TABLE DUMP: ${label}`)
  console.log('='.repeat(70))

  let count = 0
  $('table').each((i, table) => {
    const rows = $(table).find('tr')
    if (rows.length < 2) return

    const hdrCells = rows.first().find('th, td').map((_, el) => $(el).text().trim()).get()
    if (hdrCells.filter(Boolean).length < 2) return
    if (hdrCells.some(h => h.length > 200)) return

    count++
    console.log(`\nTable[${i}] — ${rows.length} rows`)
    console.log('  Headers:', JSON.stringify(hdrCells))

    rows.slice(1, 6).each((j, row) => {
      const cells = $(row).find('td').map((_, el) => $(el).text().trim()).get()
      if (cells.some(c => c)) console.log(`  Row ${j+1}:`, JSON.stringify(cells))
    })
  })

  if (count === 0) console.log('  [no meaningful tables]')
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  // ─── Both sub-tournaments ────────────────────────────────────────────────
  const subs = [
    { id: '1381175', label: 'Girls (1381175)' },
    { id: '1381171', label: 'Open (1381171)' },
  ]

  for (const sub of subs) {
    console.log(`\n\n${'#'.repeat(70)}`)
    console.log(`# SUB-TOURNAMENT: ${sub.label}`)
    console.log('#'.repeat(70))

    // art=1 standings rd=1
    await sleep(1200)
    try {
      const html = await fetch1(`https://s2.chess-results.com/tnr${sub.id}.aspx?lan=1&art=1&rd=1`)
      dumpTables(html, `${sub.label} — STANDINGS (art=1, rd=1)`)
    } catch (e) { console.error('FAIL:', e) }

    // art=2 pairings rd=1
    await sleep(1200)
    try {
      const html = await fetch1(`https://s2.chess-results.com/tnr${sub.id}.aspx?lan=1&art=2&rd=1`)
      dumpTables(html, `${sub.label} — PAIRINGS (art=2, rd=1)`)
    } catch (e) { console.error('FAIL:', e) }
  }
}

main().catch(console.error)
