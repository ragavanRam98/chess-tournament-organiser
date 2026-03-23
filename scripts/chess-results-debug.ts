import * as cheerio from 'cheerio'

const BASE = 'https://s3.chess-results.com'
const TNR = '1313755'

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function main() {
  // Fetch the pairings page and dump ALL form elements
  const url = `${BASE}/tnr${TNR}.aspx?lan=1&art=1&rd=1`
  console.log('Fetching:', url)

  const res = await fetch(url, { headers: HEADERS })
  const html = await res.text()
  const $ = cheerio.load(html)

  console.log('\n=== ALL INPUT ELEMENTS ===')
  $('input').each((i, el) => {
    const name = $(el).attr('name') ?? ''
    const type = $(el).attr('type') ?? ''
    const val = ($(el).val() as string)?.slice(0, 80) ?? ''
    const id = $(el).attr('id') ?? ''
    // Skip viewstate (too long)
    if (name === '__VIEWSTATE' || name === '__EVENTVALIDATION') {
      console.log(`  <input name="${name}" type="${type}" value="[${val.length} chars]" id="${id}">`)
    } else {
      console.log(`  <input name="${name}" type="${type}" value="${val}" id="${id}">`)
    }
  })

  console.log('\n=== ALL BUTTONS ===')
  $('button, input[type="submit"], input[type="button"], input[type="image"]').each((i, el) => {
    const tag = $(el).prop('tagName')
    const name = $(el).attr('name') ?? ''
    const val = $(el).val() as string ?? ''
    const id = $(el).attr('id') ?? ''
    const onclick = $(el).attr('onclick') ?? ''
    console.log(`  <${tag} name="${name}" value="${val}" id="${id}" onclick="${onclick}">`)
  })

  console.log('\n=== ALL __doPostBack LINKS ===')
  $('a[href*="__doPostBack"]').each((i, el) => {
    const href = $(el).attr('href') ?? ''
    const text = $(el).text().trim().slice(0, 50)
    const id = $(el).attr('id') ?? ''
    console.log(`  <a id="${id}" href="${href}">${text}</a>`)
  })

  console.log('\n=== ALL LINKS WITH "show" IN TEXT ===')
  $('a, button, input').each((i, el) => {
    const text = $(el).text().trim().toLowerCase()
    const val = (($(el).val() as string) ?? '').toLowerCase()
    if (text.includes('show') || val.includes('show') || text.includes('click') || val.includes('click')) {
      const tag = $(el).prop('tagName')
      const href = $(el).attr('href') ?? ''
      const name = $(el).attr('name') ?? ''
      console.log(`  <${tag} name="${name}" href="${href?.slice(0, 100)}">${$(el).text().trim().slice(0, 60)}</a>`)
    }
  })

  console.log('\n=== FORM ACTION ===')
  $('form').each((i, el) => {
    console.log(`  Form ${i}: action="${$(el).attr('action')}" method="${$(el).attr('method')}"`)
  })

  console.log('\n=== SEARCHING FOR "button" or "btn" or "show" IN HTML ===')
  // Search raw HTML for button-like patterns
  const btnMatches = html.match(/name="[^"]*(?:btn|button|show|click|cb_)[^"]*"/gi)
  if (btnMatches) {
    console.log('Found in raw HTML:', [...new Set(btnMatches)])
  } else {
    console.log('No btn/button/show/click patterns found in names')
  }

  // Look for the specific "show old tournament" button pattern
  const showBtnMatch = html.match(/<input[^>]*(?:show|Show|SHOW)[^>]*>/gi)
  if (showBtnMatch) {
    console.log('\nShow buttons in HTML:')
    showBtnMatch.forEach(m => console.log(' ', m.slice(0, 200)))
  }

  // Look for image buttons (chess-results sometimes uses those)
  const imgBtnMatch = html.match(/<input[^>]*type="image"[^>]*>/gi)
  if (imgBtnMatch) {
    console.log('\nImage buttons:')
    imgBtnMatch.forEach(m => console.log(' ', m.slice(0, 200)))
  }

  // Now try the POST approach with COOKIES preserved
  console.log('\n\n=== TRYING POST WITH COOKIE SESSION ===')
  const cookies = res.headers.get('set-cookie')
  console.log('Set-Cookie from GET:', cookies?.slice(0, 200))

  // Extract viewstate
  const viewState = $('input[name="__VIEWSTATE"]').val() as string
  const viewStateGen = $('input[name="__VIEWSTATEGENERATOR"]').val() as string
  const eventValidation = $('input[name="__EVENTVALIDATION"]').val() as string

  console.log('__VIEWSTATE length:', viewState?.length ?? 0)
  console.log('__VIEWSTATEGENERATOR:', viewStateGen)
  console.log('__EVENTVALIDATION length:', eventValidation?.length ?? 0)

  // Try POST with cookie
  if (viewState) {
    const formData = new URLSearchParams()
    formData.set('__EVENTTARGET', 'ctl00$P1$LinkButton2')
    formData.set('__EVENTARGUMENT', '')
    formData.set('__VIEWSTATE', viewState)
    if (viewStateGen) formData.set('__VIEWSTATEGENERATOR', viewStateGen)
    if (eventValidation) formData.set('__EVENTVALIDATION', eventValidation)

    const postHeaders: Record<string, string> = {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': url,
    }
    if (cookies) {
      // Extract session cookie
      const sessionCookie = cookies.split(';')[0]
      postHeaders['Cookie'] = sessionCookie
    }

    console.log('Posting with session cookie...')
    const postRes = await fetch(url, {
      method: 'POST',
      headers: postHeaders,
      body: formData.toString(),
      redirect: 'follow',
    })

    console.log('POST status:', postRes.status)
    const postHtml = await postRes.text()
    const $post = cheerio.load(postHtml)

    // Check for data tables
    const tables = $post('table').filter((_, t) => {
      const rows = $post(t).find('tr')
      if (rows.length < 3) return false
      const headers = rows.first().find('th,td').map((_, el) => $post(el).text().trim()).get().filter(Boolean)
      return headers.length >= 2
    })

    console.log(`POST result: ${tables.length} data tables found, page length: ${postHtml.length}`)

    if (tables.length > 0) {
      tables.each((i, table) => {
        const rows = $post(table).find('tr')
        const headers = rows.first().find('th,td').map((_, el) => $post(el).text().trim()).get().filter(Boolean)
        console.log(`\nTable[${i}] — ${rows.length} rows`)
        console.log('Headers:', JSON.stringify(headers.slice(0, 15)))
        rows.slice(1, 4).each((j, row) => {
          const cells = $post(row).find('td').map((_, el) => $post(el).text().trim()).get()
          console.log(`  Row ${j + 1}:`, JSON.stringify(cells.slice(0, 15)))
        })
      })
    } else {
      // Dump some page content for debugging
      const text = $post('body').text().replace(/\s+/g, ' ').trim()
      console.log('Page text (first 500 chars):', text.slice(0, 500))
    }
  }
}

main().catch(console.error)
