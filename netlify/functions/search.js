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

    const queries = [
      `"${name}" ${specialty} ${state} NPI doctor profile`,
      `"${name}" ${specialty} ${state} medical school residency fellowship`,
      `"${name}" ${specialty} ${state} phone fax address clinic`,
    ];

    const searches = await Promise.all(queries.map(q =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query: q,
          search_depth: 'advanced',
          max_results: 5,
          include_answer: true
        })
      }).then(r => r.json())
    ));

    const searchContext = searches.map((s, i) =>
      `BÚSQUEDA ${i+1}: ${queries[i]}\nRESULTADOS:\n${s.results?.map(r =>
        `- ${r.title}\n  URL: ${r.url}\n  ${r.content?.substring(0, 400)}`
      ).join('\n')}\nRESPUESTA DIRECTA: ${s.answer || 'N/A'}`
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
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Eres un experto en datos médicos para SINTAN INC. Basándote ÚNICAMENTE en los resultados de búsqueda, extrae la información y devuelve SOLO un JSON válido sin markdown ni texto extra.

MÉDICO: ${name} | ESPECIALIDAD: ${specialty} | ESTADO: ${state} | PAÍS: ${country}${institution ? ` | INSTITUCIÓN: ${institution}` : ''}

RESULTADOS:
${searchContext}

Devuelve SOLO este JSON:
{
  "full_name": "nombre completo con credenciales o NOT_FOUND",
  "npi": "número NPI o NOT_FOUND",
  "hcp_status": "Active o NOT_FOUND",
  "primary_specialty": "${specialty}",
  "institution": "institución actual o NOT_FOUND",
  "address": "dirección completa o NOT_FOUND",
  "phone": "teléfono o NOT_FOUND",
  "fax": "fax o NOT_FOUND",
  "website": "URL del perfil o NOT_FOUND",
  "medical_school": "escuela de medicina o NOT_FOUND",
  "medical_school_source": "fuente donde se encontró",
  "residency": "institución de residencia o NOT_FOUND",
  "residency_source": "fuente donde se encontró",
  "fellowship": "institución del fellowship o NOT_FOUND",
  "fellowship_source": "fuente donde se encontró",
  "fellowship_year_started": "año de inicio o NOT_FOUND",
  "fellowship_status": "Alumni o Active o NOT_FOUND",
  "sintan_crm_search": "cómo buscar esta institución en el CRM de SINTAN incluyendo nombre del sistema de salud",
  "validation_notes": "notas importantes para el analista"
}`
        }]
      })
    });

    const claudeData = await claudeResp.json();
    const resultText = claudeData.content?.[0]?.text || '{}';

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: resultText
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
