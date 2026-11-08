// Ask Deep Relay's DeepSeek V4.1 Flash a question from the command line.
// The API key is read from the DEEPRELAY_API_KEY environment variable and is never written to disk.
//   node tools/deeprelay-ask.mjs prompt.txt            (prompt read from a file)
//   echo "question" | node tools/deeprelay-ask.mjs -   (prompt read from stdin)
const key = process.env.DEEPRELAY_API_KEY;
if (!key) {
  console.error('DEEPRELAY_API_KEY is not set in this environment.');
  process.exit(1);
}
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node tools/deeprelay-ask.mjs <prompt-file | ->');
  process.exit(1);
}
const prompt = arg === '-' ? await new Response(process.stdin).text() : (await import('node:fs')).readFileSync(arg, 'utf8');
const model = process.env.DEEPRELAY_MODEL || 'deeprelay/deepseek-v4.1-flash';
const res = await fetch('https://api.deeprelay.ai/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: Number(process.env.DEEPRELAY_MAX_TOKENS || 2000) }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Deep Relay error ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log(body?.choices?.[0]?.message?.content ?? '(no text returned)');
