exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { name, specialty, state, country, institution } = JSON.parse(event.body);
    const TAVILY_KEY = process.env.TAVILY_API_KEY;
    const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

    // More targeted queries for medical professionals
    const queries = [
      `"${name}" MD ${specialty} ${state} NPI site:npiregistry.cms.hhs.gov OR site:npino.com OR site:npidb.org`,
      `"${name}" ${specialty} ${state} doctor profile medical school fellowship residency`,
      `"${name}" ${specialty} ${state} phone fax address practice${institution ? ` "${institution}"` : ''}`,
      `"${name}" MD gastroenterologist site:doximity.com OR site:healthgrades.com OR site:vitals.com OR site:usnews.com`,
    ];

    const searches = await Promise.all(queries.map(q =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query: q,
          search_depth: 'advanced',
          max_results: 6,
          include_answer: true,
          include_raw_content: false
        })
      }).then(r => r.json()).catch(() => ({ results: [], answer: null }))
    ));

    // Also fetch NPI directly
    const npiSearch = await fetch(
      `https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=${name.split(' ')[0]}&last_name=${name.split(' ').slice(-1)[0]}&state=${state}&enumeration_type=NPI-1&limit=3`
    ).then(r => r.json()).catch(() => null);

    let npiData = 'NPI Registry: no results found';
    if (npiSearch?.results?.length > 0) {
      const r = npiSearch.results[0];
      const addr = r.addresses?.[0];
      npiData = `NPI: ${r.number} | Name: ${r.basic?.first_name} ${r.basic?.last_name} | Credential: ${r.basic?.credential} | Status: ${r.basic?.status} | Address: ${addr?.address_1}, ${addr?.city}, ${addr?.state} ${addr?.postal_code} | Phone: ${addr?.telephone_number} | Specialty: ${r.taxonomies?.[0]?.desc}`;
    }

    const searchContext = searches.map((s, i) =>
      `SEARCH ${i+1}: ${queries[i]}\nANSWER: ${s.answer || 'N/A'}\nRESULTS:\n${(s.results || []).map(r =>
        `- ${r.title}\n  URL: ${r.url}\n  ${(r.content || '').substring(0, 500)}`
      ).join('\n')}`
    ).join('\n\n---\n\n');

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are a medical data extraction expert for SINTAN INC, a pharmaceutical KPO company. Extract ALL available information from the search results below and return ONLY a valid JSON object with no markdown, no backticks, no extra text.

PHYSICIAN: ${name} | SPECIALTY: ${specialty} | STATE: ${state} | TRAINING COUNTRY: ${country}${institution ? ` | INSTITUTION: ${institution}` : ''}

NPI REGISTRY DIRECT DATA:
${npiData}

WEB SEARCH RESULTS:
${searchContext}

Return ONLY this JSON structure (use NOT_FOUND if data unavailable):
{
  "full_name": "full legal name with credentials",
  "npi": "10-digit NPI number",
  "hcp_status": "Active or Inactive",
  "primary_specialty": "${specialty}",
  "institution": "current work institution full name",
  "address": "full address: street, city, state, ZIP",
  "phone": "phone number",
  "fax": "fax number",
  "website": "direct URL to physician profile page",
  "medical_school": "medical school name",
  "medical_school_source": "source name",
  "residency": "residency institution",
  "residency_source": "source name",
  "fellowship": "${specialty} fellowship institution",
  "fellowship_source": "source name",
  "fellowship_year_started": "year",
  "fellowship_status": "Alumni or Active",
  "sintan_crm_search": "exact name and 2-3 alternatives to search in SINTAN CRM, including parent health system (e.g. Summit Health, Atlantic Health System, etc.)",
  "validation_notes": "important notes for the CRM analyst: data gaps, address discrepancies, recommended manual checks"
}`
        }]
      })
    });

    const claudeData = await claudeResp.json();
    const resultText = claudeData.content?.[0]?.text || '{}';

    // Clean and parse
    const clean = resultText.replace(/```json|```/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
