#!/usr/bin/env node
// Gate local de evidências: não realiza chamadas de rede, escrita ou deploy.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const nonempty = v => typeof v === 'string' && v.trim().length > 0;

export function validateRelease(phase, e) {
  const issues = [];
  const check = (condition, reason) => { if (!condition) issues.push(reason); };
  const isSha = v => typeof v === 'string' && SHA.test(v);
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['Evidência JSON inválida.'];
  check(e.repository === 'luk8nhassil-maker/-chefebot', 'Repositório incorreto.');
  check(e.baseBranch === 'main', 'Branch base precisa ser main.');
  check(isSha(e.headSha) && isSha(e.validatedSha) && e.headSha === e.validatedSha, 'HEAD diferente do SHA validado.');
  check(['low', 'medium', 'high'].includes(e.risk), 'Risco não classificado.');
  check(e.diffReviewed === true, 'Diff não revisado.');
  check(e.baselineCompared === true, 'Falta comparação com main.');
  check(e.newFailures === 0, 'Falha nova ou não classificada.');
  check(e.scopeProtected === true, 'Escopo e fluxos protegidos sem prova.');
  check(Array.isArray(e.tests) && e.tests.length > 0, 'Nenhum teste comprovado.');
  if (Array.isArray(e.tests)) e.tests.forEach((t,i) => {
    check(nonempty(t?.name) && t?.status === 'passed', 'Teste ' + (i+1) + ' não aprovado.');
  });
  check(e.build && ['passed','not_applicable'].includes(e.build.status), 'Build sem resultado.');
  if (e.build?.status === 'not_applicable') {
    check(e.risk === 'low' && nonempty(e.build.reason), 'Dispensa do build só para risco baixo com justificativa.');
  }
  if (e.risk === 'medium' || e.risk === 'high') check(e.build?.status === 'passed', 'Build obrigatório para risco médio/alto.');
  check(e.preview && ['validated','skipped'].includes(e.preview.status), 'Preview sem resultado.');
  if (e.preview?.status === 'skipped') {
    check(nonempty(e.preview.reason), 'Dispensa do Preview sem justificativa.');
    check(nonempty(e.preview.alternativeEvidence), 'Dispensa do Preview sem evidência alternativa.');
  }
  check(e.productionSideEffects === false, 'Teste/Preview acionou ou pode acionar produção.');
  check(nonempty(e.approvalBasis), 'Falta autorização operacional aplicável.');
  check(nonempty(e.rollbackPlan), 'Falta plano de rollback.');

  if (phase === 'postdeploy') {
    check(isSha(e.mergeSha) && isSha(e.deployedSha) && e.mergeSha === e.deployedSha, 'Deploy e merge não apontam ao mesmo commit.');
    check(e.vercelProject === 'chefebot-contingencia', 'Projeto Vercel errado.');
    check(e.target === 'production' && e.deploymentState === 'READY', 'Deploy não está READY em production.');
    check(e.healthCheck?.status === 'passed' && nonempty(e.healthCheck.evidence), 'Health check não comprovado.');
    check(e.regressionCheck?.status === 'passed' && nonempty(e.regressionCheck.evidence), 'Não regressão não comprovada.');
  } else if (phase !== 'premerge') {
    issues.push('Fase desconhecida.');
  }
  return issues;
}

function main(args) {
  const [phase, path] = args;
  if (!['premerge','postdeploy'].includes(phase) || !nonempty(path)) {
    console.error('Uso: node scripts/ci/release-gate.mjs premerge|postdeploy evidencia.json');
    return 2;
  }
  let evidence;
  try { evidence = JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { console.error('Erro ao ler relatório: ' + err.message); return 2; }
  const failures = validateRelease(phase, evidence);
  if (failures.length) {
    console.error('BLOQUEADO:\n' + failures.map(s => '- ' + s).join('\n'));
    return 1;
  }
  console.log('Gate ' + phase + ': evidências consistentes. Confirmar provas reais nos sistemas oficiais.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
