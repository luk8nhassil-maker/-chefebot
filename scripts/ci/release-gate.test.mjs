import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease } from './release-gate.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40);
const valid = () => ({
  repository: 'luk8nhassil-maker/-chefebot', baseBranch: 'main',
  headSha: A, validatedSha: A, risk: 'low',
  diffReviewed: true, baselineCompared: true, newFailures: 0, scopeProtected: true,
  tests: [{ name: 'release-gate.test.mjs', status: 'passed' }],
  build: { status: 'not_applicable', reason: 'Patch sem impacto em runtime.' },
  preview: { status: 'skipped', reason: 'Pedido explícito do usuário.', alternativeEvidence: 'Testes locais e diff.' },
  productionSideEffects: false, approvalBasis: 'Autorizado nesta tarefa.',
  rollbackPlan: 'Reverter em novo PR, sem force push.'
});
const rejected = (fn, phase = 'premerge') => { const v = valid(); fn(v); assert.ok(validateRelease(phase,v).length > 0); };
test('passa premerge válido', () => assert.deepEqual(validateRelease('premerge',valid()), []));
test('reprova HEAD divergente', () => rejected(v => {v.headSha=B;}));
test('reprova teste não executado', () => rejected(v => {v.tests[0].status='not_run';}));
test('reprova baseline ausente', () => rejected(v => {v.baselineCompared=false;}));
test('reprova falha nova', () => rejected(v => {v.newFailures=1;}));
test('reprova Preview dispensado sem evidência', () => rejected(v => {v.preview.alternativeEvidence='';}));
test('reprova risco alto sem build', () => rejected(v => {v.risk='high';}));
test('reprova acionamento de produção', () => rejected(v => {v.productionSideEffects=true;}));
test('reprova ausência de rollback', () => rejected(v => {v.rollbackPlan='';}));
const deploy = (v, deployed = A, health = true) => Object.assign(v, {
  mergeSha:A, deployedSha:deployed, vercelProject:'chefebot-contingencia', target:'production',
  deploymentState:'READY', healthCheck:{status:health?'passed':'not_run',evidence:health?'GET 200':''},
  regressionCheck:{status:'passed',evidence:'GETs seguros dos fluxos críticos'}
});
test('reprova deploy de SHA diferente', () => rejected(v => deploy(v,B), 'postdeploy'));
test('reprova health check ausente', () => rejected(v => deploy(v,A,false), 'postdeploy'));
test('passa pós-deploy válido', () => {const v=valid();deploy(v);assert.deepEqual(validateRelease('postdeploy',v),[]);});
