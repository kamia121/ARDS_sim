// Golden numerical fixture of the ORIGINAL createPatient/simulate primitives, for verifying engine extensions.
//   node benchmarks/experiment-golden.mjs [output.json] [--force]   generate (refuses to overwrite without --force)
//   node benchmarks/experiment-golden.mjs --check [fixture.json]    read-only: regenerate and deepStrictEqual
// The default JSON path is gitignored (benchmarks/*.json); keep it local.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPatient, simulate, MODEL_INFO } from '../src/engine.js';

const SCHEMA = 'experiment-golden/1';
const ENGINE_SOURCE = fileURLToPath(new URL('../src/engine.js', import.meta.url));
const DEFAULT_OUTPUT = fileURLToPath(new URL('./experiment-golden.json', import.meta.url));

const KINDS = ['high', 'low', 'wall', 'healthy'];
const SEEDS = [13791, 4242];
const SETTINGS = {
  peep8vt6rr20: { peep: 8, vt: 6, rr: 20, pressureLimit: 30 },
  peep12vt8rr13: { peep: 12, vt: 8, rr: 13, pressureLimit: 30 }
};
const COUNT = 64;
const OPTIONS = { breaths: 3, dt: 0.1, recordTrajectory: true };

const caseSpecs = () => KINDS.flatMap(kind => SEEDS.flatMap(seed => Object.entries(SETTINGS).map(([settingsName, settings]) => ({
  name: `${kind}-seed${seed}-${settingsName}`, kind, seed, count: COUNT, settingsName, settings: { ...settings }, options: { ...OPTIONS }
}))));

function runCase(spec) {
  const patient = createPatient(spec.kind, spec.seed, spec.count);
  const result = simulate(patient, spec.settings, { ...spec.options });
  return { result, patient };
}

// JSON cannot carry Float64Array, -0, NaN or +/-Infinity; tag them so the round trip is exact.
function replacer(_key, value) {
  if (value instanceof Float64Array) return { __f64: Array.from(value) };
  if (ArrayBuffer.isView(value)) throw new TypeError(`Unsupported typed array ${value.constructor.name}`);
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { __num: '-0' };
    if (!Number.isFinite(value)) return { __num: String(value) };
  }
  return value;
}
function reviver(_key, value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if ('__f64' in value) return Float64Array.from(value.__f64);
    if ('__num' in value) return value.__num === '-0' ? -0 : Number(value.__num);
  }
  return value;
}
const encode = data => JSON.stringify(data, replacer);
const decode = text => JSON.parse(text, reviver);

const sourceSha256 = async () => createHash('sha256').update(await readFile(ENGINE_SOURCE)).digest('hex');

async function generate(output, force) {
  const digest = await sourceSha256();
  const cases = caseSpecs().map(spec => ({ ...spec, ...runCase(spec) }));
  const fixture = {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    node: process.version,
    source: { file: 'src/engine.js', sha256: digest, modelVersion: MODEL_INFO.version },
    note: 'Raw output of the original createPatient/simulate before any extension. Each case holds the full simulate result (metrics, units, pv, trajectory Float64Arrays) and the patient after simulate.',
    cases
  };
  const text = encode(fixture);
  assert.deepStrictEqual(decode(text).cases, fixture.cases, 'fixture does not round-trip exactly');
  await mkdir(path.dirname(output), { recursive: true });
  try { await writeFile(output, text + '\n', { flag: force ? 'w' : 'wx' }); }
  catch (error) {
    if (error.code === 'EEXIST') { console.error(`Refusing to overwrite existing fixture ${output}; pass --force to replace it.`); process.exitCode = 1; return; }
    throw error;
  }
  const limited = cases.filter(c => c.result.metrics.limited).length;
  console.log(JSON.stringify({ mode: 'generate', output, bytes: Buffer.byteLength(text) + 1, cases: cases.length, ceilingLimitedCases: limited, sourceSha256: digest, generatedAt: fixture.generatedAt }, null, 2));
}

async function check(input) {
  let fixture;
  try { fixture = decode(await readFile(input, 'utf8')); }
  catch (error) { console.error(`Cannot read fixture ${input}: ${error.message}`); process.exitCode = 1; return; }
  const failures = [];
  const fail = (name, error) => failures.push({ name, message: String(error.message).split('\n').slice(0, 6).join('\n') });
  if (fixture.schema !== SCHEMA) fail('schema', new Error(`expected ${SCHEMA}, found ${fixture.schema}`));
  const expected = caseSpecs();
  const stored = Array.isArray(fixture.cases) ? fixture.cases : [];
  try { assert.deepStrictEqual(stored.map(({ result, patient, ...spec }) => spec), expected); }
  catch (error) { fail('case specifications', error); }
  for (const c of stored) {
    try {
      const { result, patient } = runCase({ kind: c.kind, seed: c.seed, count: c.count, settings: c.settings, options: c.options });
      assert.deepStrictEqual(result, c.result, 'result');
      assert.deepStrictEqual(patient, c.patient, 'patient final state');
    } catch (error) { fail(c.name, error); }
  }
  const digest = await sourceSha256();
  const sourceChanged = digest !== fixture.source?.sha256;
  const report = { mode: 'check', fixture: input, cases: stored.length, passed: stored.length - failures.filter(f => f.name !== 'schema' && f.name !== 'case specifications').length, failures, sourceSha256Matches: !sourceChanged, generatedAt: fixture.generatedAt };
  if (sourceChanged) report.sourceNote = 'src/engine.js differs from the generating source; numerical equality above is the actual criterion.';
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const unknown = [...flags].filter(f => !['--check', '--force'].includes(f));
const positional = args.filter(a => !a.startsWith('--'));
if (unknown.length || positional.length > 1 || (flags.has('--check') && flags.has('--force'))) {
  console.error('Usage: experiment-golden.mjs [--check | --force] [path.json]');
  process.exit(2);
}
const target = positional[0] ? path.resolve(positional[0]) : DEFAULT_OUTPUT;
if (flags.has('--check')) await check(target); else await generate(target, flags.has('--force'));
