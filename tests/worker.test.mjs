import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient, simulate, sweep, MODEL_INFO } from '../src/engine.js';
import { createSession } from '../src/session.js';

const config = [{ kind: 'high', seed: 11, pbw: 70 }, { kind: 'healthy', seed: 12, pbw: 60 }];
const A = { peep: 8, vt: 6 }, B = { peep: 14, vt: 6 }, C = { peep: 5, vt: 7 };
const fresh = () => config.map(c => createPatient(c.kind, c.seed, 512, c.pbw));
const direct = (patients, settings) => patients.map(p => ({ ...simulate(p, settings, { breaths: 10, dt: 0.1 }), phenotype: p.kind, seed: p.seed }));
const cmp = (id, settings, extra = {}) => ({ id, type: 'compare', config, settings, reset: false, ...extra });
const ack = id => ({ id, type: 'accept-state' });

test('fresh reset matches direct simulation and response shape', () => {
  const s = createSession();
  const r = s.handle(cmp(1, A, { reset: true }));
  assert.deepEqual(r.results, direct(fresh(), A));
  assert.equal(r.id, 1); assert.equal(r.type, 'compare'); assert.equal(r.stateToken, 1); assert.equal(r.modelInfo, MODEL_INFO);
  assert.deepEqual(r.results.map(x => [x.phenotype, x.seed]), [['high', 11], ['healthy', 12]]);
});

test('retained-state chain matches one patient simulated sequentially', () => {
  const s = createSession();
  const ref = fresh();
  assert.deepEqual(s.handle(cmp(1, A, { reset: true })).results, direct(ref, A));
  assert.deepEqual(s.handle(ack(1)), { id: 1, type: 'state-accepted', stateToken: 1 });
  assert.deepEqual(s.handle(cmp(2, B, { baseStateToken: 1 })).results, direct(ref, B));
  assert.equal(s.handle(ack(2)).type, 'state-accepted');
  assert.deepEqual(s.handle(cmp(3, C, { baseStateToken: 2 })).results, direct(ref, C));
  assert.equal(s.handle(ack(3)).stateToken, 3);
});

test('multiple candidates from one acknowledged state; only newest acknowledgement promotes', () => {
  const s = createSession();
  const ref = fresh();
  s.handle(cmp(1, A, { reset: true })); s.handle(ack(1)); direct(ref, A);
  const base = JSON.parse(JSON.stringify(ref));
  const r2 = s.handle(cmp(2, B, { baseStateToken: 1 }));
  const r3 = s.handle(cmp(3, C, { baseStateToken: 1 }));
  assert.deepEqual(r2.results, direct(JSON.parse(JSON.stringify(base)), B));
  assert.deepEqual(r3.results, direct(JSON.parse(JSON.stringify(base)), C));
  assert.deepEqual(s.handle(ack(2)), { id: 2, type: 'state-ignored', stateToken: 1 });
  assert.deepEqual(s.handle(ack(3)), { id: 3, type: 'state-accepted', stateToken: 3 });
  assert.throws(() => s.handle(cmp(4, A, { baseStateToken: 2 })), /baseStateToken/);
  const r5 = s.handle(cmp(5, A, { baseStateToken: 3 }));
  direct(base, C);
  assert.deepEqual(r5.results, direct(base, A));
});

test('stale, duplicate and unknown acknowledgements leave accepted state unchanged', () => {
  const s = createSession();
  const ref = fresh();
  s.handle(cmp(1, A, { reset: true })); s.handle(ack(1)); direct(ref, A);
  assert.equal(s.handle(ack(1)).type, 'state-ignored');
  assert.equal(s.handle(ack(99)).type, 'state-ignored');
  assert.equal(s.handle(ack(undefined)).type, 'state-ignored');
  s.handle(cmp(2, B, { baseStateToken: 1 }));
  s.handle(cmp(3, C, { baseStateToken: 1 }));
  assert.deepEqual(s.handle(ack(2)), { id: 2, type: 'state-ignored', stateToken: 1 });
  assert.deepEqual(s.handle(cmp(4, B, { baseStateToken: 1 })).results, direct(ref, B));
});

test('unacknowledged candidates never mutate accepted state', () => {
  const s = createSession();
  s.handle(cmp(1, A, { reset: true })); s.handle(ack(1));
  const first = s.handle(cmp(2, B, { baseStateToken: 1 })).results;
  s.handle(cmp(3, C, { baseStateToken: 1 }));
  assert.deepEqual(s.handle(cmp(4, B, { baseStateToken: 1 })).results, first);
});

test('fresh reset ignores predecessor tokens and replaces accepted state', () => {
  const s = createSession();
  s.handle(cmp(1, A, { reset: true })); s.handle(ack(1));
  s.handle(cmp(2, B, { baseStateToken: 1 })); s.handle(ack(2));
  const r = s.handle(cmp(3, A, { reset: true, baseStateToken: 'bogus' }));
  assert.deepEqual(r.results, direct(fresh(), A));
  s.handle(ack(3));
  const ref = fresh(); direct(ref, A);
  assert.deepEqual(s.handle(cmp(4, B, { baseStateToken: 3 })).results, direct(ref, B));
});

test('token, config and id errors do not alter accepted state', () => {
  const s = createSession();
  assert.throws(() => s.handle(cmp(1, A)), /No accepted state/);
  s.handle(cmp(2, A, { reset: true })); s.handle(ack(2));
  const ref = fresh(); direct(ref, A);
  assert.throws(() => s.handle(cmp(3, B)), /baseStateToken/);
  assert.throws(() => s.handle(cmp(3, B, { baseStateToken: 1 })), /baseStateToken/);
  assert.throws(() => s.handle(cmp(3, B, { baseStateToken: '2' })), /baseStateToken/);
  assert.throws(() => s.handle({ ...cmp(3, B, { baseStateToken: 2 }), config: [config[1], config[0]] }), /config does not match/);
  assert.throws(() => s.handle({ ...cmp(3, B, { baseStateToken: 2 }), config: [{ ...config[0], seed: 99 }, config[1]] }), /config does not match/);
  assert.throws(() => s.handle({ ...cmp(3, B, { baseStateToken: 2 }), config: [] }), /config/);
  assert.throws(() => s.handle({ ...cmp(3, B, { baseStateToken: 2 }), config: undefined }), /config/);
  assert.throws(() => s.handle(cmp(2, B, { baseStateToken: 2 })), /id/);
  assert.throws(() => s.handle(cmp(1, B, { baseStateToken: 2 })), /id/);
  assert.throws(() => s.handle(cmp(NaN, B, { baseStateToken: 2 })), /id/);
  assert.throws(() => s.handle(cmp(3, { peep: -1 }, { baseStateToken: 2 })), /Invalid ventilator settings/);
  assert.throws(() => s.handle(cmp(4, B, { reset: true, config: [{ kind: 'nope' }] })), /Unknown phenotype/);
  assert.deepEqual(s.handle(cmp(10, B, { baseStateToken: 2 })).results, direct(ref, B));
});

test('failed newer compare discards its predecessor candidate without changing accepted state', () => {
  const s = createSession();
  s.handle(cmp(1, A, { reset: true }));
  assert.throws(() => s.handle(cmp(2, { peep: -1 }, { reset: true })), /Invalid ventilator settings/);
  assert.equal(s.handle(ack(1)).type, 'state-ignored');
  assert.throws(()=>s.handle(cmp(3,A,{baseStateToken:1})),/No accepted state/);
});

test('worker routes compare/accept-state through one session; sweep and errors are id-scoped', async () => {
  const messages = [];
  globalThis.self = { postMessage: m => messages.push(m) };
  await import('../src/worker.js');
  const send = async data => { messages.length = 0; await self.onmessage({ data }); return [...messages]; };
  const [c1] = await send(cmp(1, A, { reset: true }));
  assert.equal(c1.type, 'compare'); assert.equal(c1.stateToken, 1);
  assert.deepEqual(c1.results, direct(fresh(), A));
  assert.equal((await send(ack(1)))[0].type, 'state-accepted');
  const [sw] = await send({ id: 2, type: 'sweep', config: [config[0]], settings: A });
  assert.equal(sw.type, 'sweep');
  assert.deepEqual(sw.results[0], sweep(createPatient('high', 11, 512, 70), A));
  const ref = fresh(); direct(ref, A);
  const [c3] = await send(cmp(3, B, { baseStateToken: 1 }));
  assert.deepEqual(c3.results, direct(ref, B));
  const [err] = await send(cmp(4, B, { baseStateToken: 77 }));
  assert.equal(err.type, 'error'); assert.equal(err.id, 4); assert.equal(err.requestType, 'compare'); assert.match(err.message, /baseStateToken/);
  const [ign] = await send(ack(5));
  assert.deepEqual(ign, { id: 5, type: 'state-ignored', stateToken: 1 });
});

test('a new worker session rejects prior tokens and requires a fresh reset',()=>{
 const old=createSession();old.handle(cmp(1,A,{reset:true}));old.handle(ack(1));
 const restarted=createSession();assert.throws(()=>restarted.handle(cmp(2,B,{baseStateToken:1})),/No accepted state/);
 assert.deepEqual(restarted.handle(cmp(3,B,{reset:true})).results,direct(fresh(),B));
});

test('airflow trials require acknowledged references and do not advance recruitment history',()=>{
 const session=createSession(),reference=fresh();session.handle(cmp(1,A,{reset:true}));session.handle(ack(1));direct(reference,A);
 assert.throws(()=>session.handle({id:2,type:'airflow',config,settings:A,baseStateToken:99}),/acknowledged/);
 const trial=session.handle({id:3,type:'airflow',config,settings:A,params:{R0:.016,Rp:.004},baseStateToken:1});
 assert.equal(trial.type,'airflow');assert.equal(trial.baseStateToken,1);assert.equal(trial.results[0].trajectory.kind,'frozen-aeration-airflow');
 assert.equal(session.handle(ack(3)).type,'state-ignored');
 assert.deepEqual(session.handle(cmp(4,B,{baseStateToken:1})).results,direct(reference,B));
});
