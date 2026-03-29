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

    rows.slice(1, 4).each((j, row) => {
      const cells = $(row).find('td').map((_, el) => $(el).text().trim()).get()
      if (cells.some(c => c)) console.log(`  Row ${j+1}:`, JSON.stringify(cells))
    })
  })

  if (count === 0) console.log('  [no meaningful tables]')
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  // The SNode=S0 URL the user mentioned
  await sleep(200)
  const html1 = await fetch1('https://s2.chess-results.com/tnr1381175.aspx?lan=1&SNode=S0')
  dumpTables(html1, 'tnr1381175 with SNode=S0')

  await sleep(1200)
  // art=1&rd=1 for the parent tournament ID
  const html2 = await fetch1('https://s2.chess-results.com/tnr1381175.aspx?lan=1&art=1&rd=1&SNode=S0')
  dumpTables(html2, 'tnr1381175 art=1 rd=1 SNode=S0')

  await sleep(1200)
  // try the open with SNode
  const html3 = await fetch1('https://s2.chess-results.com/tnr1381171.aspx?lan=1&art=1&rd=1&SNode=S0')
  dumpTables(html3, 'tnr1381171 (Open) art=1 rd=1 SNode=S0')
}

main().catch(console.error)
