// Deterministic checks for the vision verdict parser: fenced and prose-wrapped replies are read, incomplete ones are not.
//   node --import tsx tools/quality/vision-verdict.test.mjs
import { parseVisionVerdict } from '../../server/images.mjs';

let failures = 0;
const expect = (name, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) {
    failures += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

const ok = '{"shows":"histology of granuloma","pass":true,"unsupported_question_claims":[],"reason":"matches"}';

expect('plain JSON passes', parseVisionVerdict(ok)?.pass, true);
expect('fenced JSON passes', parseVisionVerdict('```json\n' + ok + '\n```')?.pass, true);
expect('prose before JSON is rejected', parseVisionVerdict('Here is my answer: ' + ok), null);
expect('missing claims list is rejected', parseVisionVerdict('{"shows":"x","pass":true,"reason":"ok"}'), null);
expect('a failed verdict stays failed', parseVisionVerdict('{"shows":"x","pass":false,"unsupported_question_claims":[],"reason":"no"}')?.pass, false);
expect('an unsupported claim blocks a pass', parseVisionVerdict('{"shows":"x","pass":true,"unsupported_question_claims":["palmar skin"],"reason":"r"}')?.pass, false);
expect('truncated JSON is rejected', parseVisionVerdict('{"shows":"x","pass":tr'), null);
expect('no JSON is rejected', parseVisionVerdict('The image shows a granuloma.'), null);

console.log(failures ? `${failures} FAILED` : 'all vision verdict checks passed');
process.exit(failures ? 1 : 0);
