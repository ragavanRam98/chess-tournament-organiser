import * as cheerio from 'cheerio'

const BASE = 'https://s3.chess-results.com'
const TNR = '1313755'

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

/**
 * Bypass the "Show tournament details" gate for old tournaments.
 * GET → extract __VIEWSTATE + session cookie → POST with cb_alleDetails
 */
async function fetchWithGate(url: string): Promise<string> {
  const getRes = await fetch(url, { headers: HEADERS, redirect: 'follow' })
  if (!getRes.ok) throw new Error(`GET HTTP ${getRes.status}: ${url}`)
  const html = await getRes.text()
  const $ = cheerio.load(html)

  const gateBtn = $('input[name="cb_alleDetails"]')
  if (gateBtn.length === 0) return html

  const viewState = $('input[name="__VIEWSTATE"]').val() as string
  const viewStateGen = $('input[name="__VIEWSTATEGENERATOR"]').val() as string
  const eventValidation = $('input[name="__EVENTVALIDATION"]').val() as string
  const setCookie = getRes.headers.get('set-cookie') ?? ''
  const sessionCookie = setCookie.split(';')[0]

  const formData = new URLSearchParams()
  formData.set('__VIEWSTATE', viewState)
  if (viewStateGen) formData.set('__VIEWSTATEGENERATOR', viewStateGen)
  if (eventValidation) formData.set('__EVENTVALIDATION', eventValidation)
  formData.set('cb_alleDetails', 'Show tournament details')

  const postRes = await fetch(url, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': url,
      'Cookie': sessionCookie,
    },
    body: formData.toString(),
    redirect: 'follow',
  })

  if (!postRes.ok) throw new Error(`POST HTTP ${postRes.status}: ${url}`)
  return postRes.text()
}

function analyseTable($: cheerio.CheerioAPI, label: string, maxRows = 5) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${label}`)
  console.log('='.repeat(60))

  let found = 0
  $('table').each((i, table) => {
    const rows = $(table).find('tr')
    if (rows.length < 3) return

    const headers = rows.first().find('th, td').map(
      (_, el) => $(el).text().trim()
    ).get().filter(Boolean)

    if (headers.length < 2) return
    if (headers.some(h => h.length > 200)) return

    found++
    console.log(`\nTable[${i}] — ${rows.length} rows, ${headers.length} cols`)
    console.log('Headers:', JSON.stringify(headers))

    rows.slice(1, 1 + maxRows).each((j, row) => {
      const cells = $(row).find('td').map(
        (_, el) => $(el).text().trim()
      ).get()
      if (cells.some(c => c.length > 0)) {
        console.log(`  Row ${j + 1}:`, JSON.stringify(cells))
      }
    })

    // Show last row too if table is large
    if (rows.length > maxRows + 2) {
      const lastRow = rows.last()
      const cells = lastRow.find('td').map((_, el) => $(el).text().trim()).get()
      if (cells.some(c => c.length > 0)) {
        console.log(`  ...`)
        console.log(`  Row ${rows.length - 1} (last):`, JSON.stringify(cells))
      }
    }
  })

  if (found === 0) {
    console.log('\n  [No data tables found]')
  }
  return found
}

function findLinks($: cheerio.CheerioAPI, pattern: string): string[] {
  const links: string[] = []
  $('a').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (href.includes(pattern)) {
      const text = $(el).text().trim()
      if (text && !links.some(l => l.startsWith(text))) {
        links.push(`${text} → ${href}`)
      }
    }
  })
  return links
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Chess-Results.com Structure Research                   ║')
  console.log('║  Tournament: 1313755 (Easy Chess Academy)               ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  // ════════════════════════════════════════════════════════════════
  // 1. Player list — "Main List" (all categories combined)
  // ════════════════════════════════════════════════════════════════
  console.log('\n\n████ 1. PLAYER LIST — MAIN (art=0, zeilen=99999) ████')
  try {
    const html = await fetchWithGate(`${BASE}/tnr${TNR}.aspx?lan=1&art=0&zeilen=99999`)
    const $ = cheerio.load(html)

    // Extract sub-tournament links from the nav table
    console.log('\nSub-tournament / category links:')
    const turLinks = findLinks($, 'tnr')
    turLinks.filter(l => l.includes('Under') || l.includes('Open') || l.includes('Main')).forEach(l => console.log('  ', l))

    // Also look for "turdet" or "tuession" links
    const allNavLinks = findLinks($, 'tnr1313755')
    console.log('\nAll internal navigation links:')
    allNavLinks.forEach(l => console.log('  ', l))

    analyseTable($, 'PLAYER LIST — MAIN (art=0)')
  } catch (e) {
    console.error('Failed:', e)
  }
  await new Promise(r => setTimeout(r, 2000))

  // ════════════════════════════════════════════════════════════════
  // 2. Discover sub-tournament IDs
  //    chess-results uses tnr<ID> for sub-tournaments
  // ════════════════════════════════════════════════════════════════
  console.log('\n\n████ 2. DISCOVER SUB-TOURNAMENT IDs ████')
  try {
    const html = await fetchWithGate(`${BASE}/tnr${TNR}.aspx?lan=1&art=0`)
    const $ = cheerio.load(html)

    // Find all tnr links that point to different tournament IDs
    const subTournaments: { name: string; id: string; href: string }[] = []
    $('a[href*="tnr"]').each((_, el) => {
      const href = $(el).attr('href') ?? ''
      const text = $(el).text().trim()
      const tnrMatch = href.match(/tnr(\d+)/)
      if (tnrMatch && text.length > 0 && text.length < 50) {
        const id = tnrMatch[1]
        if (!subTournaments.some(s => s.id === id && s.name === text)) {
          subTournaments.push({ name: text, id, href })
        }
      }
    })

    console.log('\nAll sub-tournament links found:')
    subTournaments.forEach(s => {
      console.log(`  "${s.name}" → tnr${s.id} ${s.id === TNR ? '(MAIN)' : '(SUB)'}`)
    })

    // The sub-tournament IDs are the key — pairings/standings need them
    const subIds = [...new Set(subTournaments.filter(s => s.id !== TNR).map(s => s.id))]
    console.log('\nUnique sub-tournament IDs:', subIds)

    // ════════════════════════════════════════════════════════════════
    // 3. For each sub-tournament, fetch pairings + standings
    // ════════════════════════════════════════════════════════════════
    if (subIds.length > 0) {
      // Use the first sub-tournament as sample
      const sampleId = subIds[0]
      const sampleName = subTournaments.find(s => s.id === sampleId)?.name ?? ''

      console.log(`\n\n████ 3. SUB-TOURNAMENT SAMPLE: "${sampleName}" (tnr${sampleId}) ████`)

      // 3a. Player list
      await new Promise(r => setTimeout(r, 2000))
      console.log(`\n──── 3a. Player list for ${sampleName} ────`)
      try {
        const html = await fetchWithGate(`${BASE}/tnr${sampleId}.aspx?lan=1&art=0&zeilen=99999`)
        const $ = cheerio.load(html)
        analyseTable($, `PLAYER LIST — ${sampleName} (tnr${sampleId}, art=0)`)
      } catch (e) {
        console.error('  Failed:', e)
      }

      // 3b. Pairings round 1
      await new Promise(r => setTimeout(r, 2000))
      console.log(`\n──── 3b. Pairings round 1 for ${sampleName} ────`)
      try {
        const html = await fetchWithGate(`${BASE}/tnr${sampleId}.aspx?lan=1&art=1&rd=1`)
        const $ = cheerio.load(html)
        analyseTable($, `PAIRINGS R1 — ${sampleName} (tnr${sampleId}, art=1&rd=1)`)

        // Round navigation
        const rounds = findLinks($, 'rd=')
        if (rounds.length > 0) {
          console.log('\nRound links:')
          rounds.forEach(l => console.log('  ', l))
        }
      } catch (e) {
        console.error('  Failed:', e)
      }

      // 3c. Standings round 1
      await new Promise(r => setTimeout(r, 2000))
      console.log(`\n──── 3c. Standings round 1 for ${sampleName} ────`)
      try {
        const html = await fetchWithGate(`${BASE}/tnr${sampleId}.aspx?lan=1&art=2&rd=1`)
        const $ = cheerio.load(html)
        analyseTable($, `STANDINGS R1 — ${sampleName} (tnr${sampleId}, art=2&rd=1)`)
      } catch (e) {
        console.error('  Failed:', e)
      }

      // 3d. Final standings (try round 5)
      await new Promise(r => setTimeout(r, 2000))
      console.log(`\n──── 3d. Final standings for ${sampleName} ────`)
      try {
        const html = await fetchWithGate(`${BASE}/tnr${sampleId}.aspx?lan=1&art=2&rd=5`)
        const $ = cheerio.load(html)
        analyseTable($, `FINAL STANDINGS — ${sampleName} (tnr${sampleId}, art=2&rd=5)`)
      } catch (e) {
        console.error('  Failed:', e)
      }

      // 3e. Cross table
      await new Promise(r => setTimeout(r, 2000))
      console.log(`\n──── 3e. Cross table for ${sampleName} ────`)
      try {
        const html = await fetchWithGate(`${BASE}/tnr${sampleId}.aspx?lan=1&art=4`)
        const $ = cheerio.load(html)
        analyseTable($, `CROSS TABLE — ${sampleName} (tnr${sampleId}, art=4)`, 3)
      } catch (e) {
        console.error('  Failed:', e)
      }
    }

  } catch (e) {
    console.error('Discovery failed:', e)
  }

  // ════════════════════════════════════════════════════════════════
  // 4. Round schedule (art=14)
  // ════════════════════════════════════════════════════════════════
  console.log('\n\n████ 4. ROUND SCHEDULE (art=14) ████')
  try {
    const html = await fetchWithGate(`${BASE}/tnr${TNR}.aspx?lan=1&art=14`)
    const $ = cheerio.load(html)
    analyseTable($, 'ROUND SCHEDULE (art=14)', 10)
  } catch (e) {
    console.error('Failed:', e)
  }

  // ════════════════════════════════════════════════════════════════
  // 5. Statistics (art=13)
  // ════════════════════════════════════════════════════════════════
  console.log('\n\n████ 5. STATISTICS (art=13) ████')
  try {
    const html = await fetchWithGate(`${BASE}/tnr${TNR}.aspx?lan=1&art=13`)
    const $ = cheerio.load(html)
    analyseTable($, 'STATISTICS (art=13)')
  } catch (e) {
    console.error('Failed:', e)
  }

  console.log('\n\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  RESEARCH COMPLETE                                      ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
}

main().catch(console.error)
