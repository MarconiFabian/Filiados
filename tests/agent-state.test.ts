import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateState, updateStateFile, recordCi } from '../scripts/agent-state.mjs';

const load = async () => JSON.parse(await readFile('agent-state.json','utf8'));
test('quality gate counts pending real-validation P0 as open',async()=>{
  const s=await load();
  s.issues.push({id:'P0-PENDING-TEST',severity:'P0',status:'FIXED_AUTOMATED_PENDING_REAL_E2E'});
  s.assessment={status:'PENDING'};
  assert.ok(evaluateState(s).openP0>0);
  assert.equal(evaluateState(s).verdict,'REJECTED');
  assert.equal(evaluateState(s).currentScore,null);
});
test('historical PASS from another commit cannot approve current critical tests',async()=>{
  const s=await load();
  for(const t of s.tests) Object.assign(t,{status:'PASS',commit:'old',evidence:'old CI'});
  assert.equal(evaluateState(s).criticalTests.passed,0);
});
test('approval requires all current evidence and independently reviewed dimensions',async()=>{
  const s=await load(), commit=s.project.commitUnderTest;
  s.issues=[]; s.regressions=[]; s.securityFindings=[];
  for(const t of [...s.tests,...s.criticalFlows]) Object.assign(t,{status:'PASS',commit,evidence:'controlled test'});
  s.securityReview=s.regressionReview={status:'PASS',commit,evidence:'independent audit'};
  s.assessment={status:'REVIEWED',commit,reviewer:'fixture judge',evidence:'fixture report',
    components:{functionality:25,integrations:20,tests:15,codeQuality:10,reliability:10,security:10,performance:5,ux:5}};
  assert.equal(evaluateState(s).verdict,'APPROVED');
  s.criticalFlows[0].status='PENDING';
  assert.equal(evaluateState(s).verdict,'REJECTED');
});
test('state update preserves history and rejects attempted erasure',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'agent-state-'));
  const file=join(dir,'agent-state.json');
  try{
    const original=await load();
    await writeFile(file,JSON.stringify(original));
    await updateStateFile(file,s=>{s.decisions.push({id:'TEST-DECISION',decision:'append'}); return s;});
    const saved=JSON.parse(await readFile(file,'utf8'));
    assert.deepEqual(saved.decisions.slice(0,-1),original.decisions);
    await assert.rejects(updateStateFile(file,s=>{s.auditTrail=[];return s;}),/History rewrite/);
    assert.deepEqual(JSON.parse(await readFile(file,'utf8')),saved);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('CI snapshot records real counts but does not approve untested external flows',async()=>{
  const s=await load();
  const result=recordCi(s,{
    GITHUB_SHA:'a'.repeat(40), GITHUB_SERVER_URL:'https://github.com',
    GITHUB_REPOSITORY:'example/repo',GITHUB_RUN_ID:'123',
    TEST_OUTCOME:'success',TYPECHECK_OUTCOME:'success',BUILD_OUTCOME:'success',AUDIT_OUTCOME:'success',
  },'# tests 12\n# pass 12\n# fail 0\n# skipped 0\n');
  assert.equal(result.testSummary.passed,12);
  assert.equal(result.qualityGate.verdict,'REJECTED');
  assert.equal(result.qualityGate.criticalFlows.passed,0);
});
