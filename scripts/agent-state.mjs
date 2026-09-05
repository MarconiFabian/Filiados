import { readFile, writeFile, open, rename, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const closed = new Set(['CLOSED', 'FIXED_VERIFIED_CI']);
const weights = { functionality:25, integrations:20, tests:15, codeQuality:10, reliability:10, security:10, performance:5, ux:5 };
export function validateState(state) {
  if (state.schemaVersion !== 2 || !Number.isInteger(state.iteration) || state.iteration < 1) throw new Error('Invalid schema/iteration');
  for (const key of ['issues','tests','criticalFlows','decisions','scoreHistory','auditTrail','iterations','testRuns','securityFindings','regressions']) {
    if (!Array.isArray(state[key])) throw new Error('Missing array: ' + key);
    const ids = state[key].map(v=>v.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate ID: ' + key);
  }
  for (const issue of state.issues) {
    if (!issue.id || !['P0','P1','P2','P3'].includes(issue.severity) || !issue.status) throw new Error('Invalid issue');
  }
  for (const key of ['tests','criticalFlows']) {
    for (const row of state[key]) if (!row.id || !row.status) throw new Error('Invalid ' + key);
  }
  if (!state.project?.commitUnderTest) throw new Error('Missing commit under test');
  return state;
}
export function evaluateState(state) {
  validateState(state);
  const commit = state.project.commitUnderTest;
  const verified = row => row.status === 'PASS' && row.commit === commit && Boolean(row.evidence);
  const summary = rows => {
    const passed = rows.filter(verified).length;
    return { passed, total: rows.length, percent: rows.length ? Math.round(passed/rows.length*10000)/100 : 0,
      status: rows.length > 0 && passed === rows.length ? 'PASS' : 'FAIL' };
  };
  const openIssues = state.issues.filter(i=>!closed.has(i.status));
  const assessment = state.assessment;
  const scoreValid = assessment?.status === 'REVIEWED' && assessment.commit === commit &&
    Boolean(assessment.reviewer) && Boolean(assessment.evidence) &&
    Object.entries(weights).every(([key,max])=>Number.isFinite(assessment.components?.[key]) &&
      assessment.components[key] >= 0 && assessment.components[key] <= max);
  const currentScore = scoreValid ? Object.keys(weights).reduce((n,key)=>n+assessment.components[key],0) : null;
  const criticalTests = summary(state.tests.filter(t=>t.critical));
  const criticalFlows = summary(state.criticalFlows);
  const criticalSecurity = state.securityFindings.filter(f=>f.severity==='CRITICAL' && !closed.has(f.status)).length;
  const criticalRegressions = state.regressions.filter(f=>f.critical && !closed.has(f.status)).length;
  const gates = {
    scoreAtLeast90: currentScore !== null && currentScore >= 90 ? 'PASS':'FAIL',
    noOpenP0: openIssues.some(i=>i.severity==='P0') ? 'FAIL':'PASS',
    noCriticalSecurity: verified(state.securityReview || {}) && criticalSecurity===0 ? 'PASS':'FAIL',
    allCriticalTests: criticalTests.status,
    allCriticalFlows: criticalFlows.status,
    noCriticalRegressions: verified(state.regressionReview || {}) && criticalRegressions===0 ? 'PASS':'FAIL',
  };
  return { verdict: Object.values(gates).every(v=>v==='PASS') ? 'APPROVED':'REJECTED',
    requiredScore:90, currentScore, scoreStatus: scoreValid?'REVIEWED':'PENDING_REVIEW',
    openP0: openIssues.filter(i=>i.severity==='P0').length,
    openP1: openIssues.filter(i=>i.severity==='P1').length,
    openP2: openIssues.filter(i=>i.severity==='P2').length,
    openP3: openIssues.filter(i=>i.severity==='P3').length,
    criticalSecurity, criticalRegressions, criticalTests, criticalFlows, gates };
}
export async function updateStateFile(path, mutate) {
  const file = resolve(path);
  const lock = await open(file + '.lock','wx');
  const temporary = file + '.' + process.pid + '.tmp';
  try {
    const before = JSON.parse(await readFile(file,'utf8'));
    validateState(before);
    const after = await mutate(structuredClone(before));
    validateState(after);
    // Existing history entries are immutable. Corrections append a new event.
    for (const key of ['scoreHistory','auditTrail','decisions','iterations','testRuns']) {
      if (JSON.stringify(after[key].slice(0,before[key].length)) !== JSON.stringify(before[key])) throw new Error('History rewrite rejected: '+key);
    }
    after.updatedAt = new Date().toISOString();
    after.qualityGate = evaluateState(after);
    await writeFile(temporary,JSON.stringify(after,null,2)+'\n',{flag:'wx'});
    await rename(temporary,file);
    return after;
  } finally {
    await unlink(temporary).catch(()=>{});
    await lock.close();
    await unlink(file+'.lock');
  }
}
export function recordCi(state, env, log) {
  const commit = env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Missing CI commit');
  const count = key => Number(log.match(new RegExp('# '+key+' (\\d+)'))?.[1] || 0);
  const total = count('tests'), passed = count('pass'), failed = count('fail'), skipped = count('skipped');
  const testsPassed = env.TEST_OUTCOME==='success' && total>0 && total===passed && failed===0 && skipped===0;
  const evidence = env.GITHUB_SERVER_URL+'/'+env.GITHUB_REPOSITORY+'/actions/runs/'+env.GITHUB_RUN_ID;
  const run = { id:'CI-'+env.GITHUB_RUN_ID+'-'+(env.GITHUB_RUN_ATTEMPT || '1'), commit, evidence,
    total, passed, failed, skipped, tests:testsPassed?'PASS':'FAIL',
    typeScript:env.TYPECHECK_OUTCOME==='success'?'PASS':'FAIL',
    build:env.BUILD_OUTCOME==='success'?'PASS':'FAIL',
    dependencyAudit:env.AUDIT_OUTCOME==='success'?'PASS':'FAIL', recordedAt:new Date().toISOString() };
  if (!state.testRuns.some(r=>r.id===run.id)) state.testRuns.push(run);
  state.project.commitUnderTest=commit;
  for (const t of state.tests) {
    if (!t.automation) continue;
    const status = t.automation==='test'?run.tests:t.automation==='lint'?run.typeScript:t.automation==='build'?run.build:run.dependencyAudit;
    Object.assign(t,{status,commit,evidence});
  }
  state.testSummary=run;
  state.qualityGate=evaluateState(state);
  return state;
}
async function main() {
  const [command='check',argument] = process.argv.slice(2);
  if (command==='check') {
    const state=JSON.parse(await readFile('agent-state.json','utf8'));
    const calculated=evaluateState(state);
    if (JSON.stringify(state.qualityGate)!==JSON.stringify(calculated)) throw new Error('Stale qualityGate: run npm run quality:refresh');
    console.log(JSON.stringify(calculated,null,2));
  } else if (command==='refresh' || command==='begin') {
    const state=await updateStateFile('agent-state.json',state=>{
      if (command==='begin') {
        if (!argument?.trim()) throw new Error('Provide iteration description');
        state.iteration++;
        state.iterations.push({id:'ITER-'+state.iteration,iteration:state.iteration,description:argument,startedAt:new Date().toISOString()});
        state.assessment={status:'PENDING'};
        state.auditTrail.push({id:'BEGIN-'+state.iteration,event:'ITERATION_STARTED',iteration:state.iteration,description:argument});
      }
      return state;
    });
    console.log(JSON.stringify(state.qualityGate,null,2));
  } else if (command==='ci') {
    const state=JSON.parse(await readFile('agent-state.json','utf8'));
    const log=await readFile('quality-tests.log','utf8').catch(()=>'');
    const result=recordCi(state,process.env,log);
    const output=resolve('quality-artifacts/agent-state.json');
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result.qualityGate,null,2));
  } else throw new Error('Unknown command');
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{ console.error(error.message); process.exitCode=1; });
}
