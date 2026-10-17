import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
export const keyOf=x=>x.join(',');
export const actionCount=x=>x.reduce((n,p)=>n+(p!==0),0);
export const roundPrediction=p=>Number(p.toFixed(6));
export function rngFromSeed(seed){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const stable=(a,b)=>a.gap-b.gap||a.actionCount-b.actionCount||a.key.localeCompare(b.key);
export function selectRepresentatives(rows,tolerance=3){
 const pool=[...rows];if(!pool.length)return {nearest:null,minimum:null,balanced:null,pareto:[],matchedCount:0,minimumMatched:false};
 const nearest=[...pool].sort(stable)[0],matched=pool.filter(r=>r.gap<=tolerance),minimumPool=matched.length?matched:pool;
 const minimum=[...minimumPool].sort((a,b)=>a.actionCount-b.actionCount||a.gap-b.gap||a.key.localeCompare(b.key))[0];
 const byCount=new Map();for(const r of pool){const old=byCount.get(r.actionCount);if(!old||stable(r,old)<0)byCount.set(r.actionCount,r);}
 const front=[];let best=Infinity;for(const r of [...byCount.values()].sort((a,b)=>a.actionCount-b.actionCount)){if(r.gap<best){front.push(r);best=r.gap;}}
 const minCount=front[0].actionCount,maxCount=front.at(-1).actionCount,minGap=Math.min(...front.map(r=>r.gap)),maxGap=Math.max(...front.map(r=>r.gap));
 const scored=front.map(r=>{const x=maxCount===minCount?0:(r.actionCount-minCount)/(maxCount-minCount),y=maxGap===minGap?0:(r.gap-minGap)/(maxGap-minGap);return {r,knee:(1-x-y)/Math.SQRT2,ideal:Math.hypot(x,y)};});
 const hasPositiveKnee=scored.some(s=>s.knee>1e-12),chosen=[...scored].sort((a,b)=>(hasPositiveKnee?b.knee-a.knee:0)||a.ideal-b.ideal||stable(a.r,b.r))[0];
 return {nearest,minimum,balanced:chosen.r,pareto:front,matchedCount:matched.length,minimumMatched:matched.length>0,kneeMethod:hasPositiveKnee?'NORMALIZED_CHORD_KNEE':'NORMALIZED_IDEAL_DISTANCE_FALLBACK'};
}
export class Evaluator{
 constructor(worker,frame,p0,bounds,target){this.worker=worker;this.frame=frame;this.base=frame.canonical25;this.p0=p0;this.bounds=bounds;this.target=target;
  this.cache=new Map();this.proposed=new Set();this.stats={generatedAttempts:0,uniqueProposed:0,domainRejected:0,uniqueDomainRejected:0,cacheHits:0,realModelRows:0,realModelBatches:0,candidateConstructionMs:0,domainCheckMs:0,modelMs:0};this.rejectedKeys=new Set();
  this.cache.set(keyOf(Array(19).fill(0)),this.makeRow(Array(19).fill(0),p0,'BASELINE_REUSED'));
 }
 makeRow(x,prediction,origin='MODEL'){const delta=prediction-this.p0,estimate=Number.isFinite(this.frame.actual)?this.frame.actual+delta:prediction;return {key:keyOf(x),x:[...x],prediction,delta,estimate,gap:Number.isFinite(this.target)?Math.abs(estimate-this.target):null,actionCount:actionCount(x),l1:x.reduce((s,p)=>s+Math.abs(p),0),origin};}
 vectorFor(x){const start=performance.now(),v=this.base.slice();for(let j=0;j<19;j++)v[j+6]=this.base[j+6]*(1+x[j]/100);this.stats.candidateConstructionMs+=performance.now()-start;return v;}
 tupleFor(v){assert.equal(v.length,25);for(let i=0;i<6;i++)assert.equal(v[i],this.base[i],'Read-only state modified');return v.slice(6).map((n,i)=>{const b=this.base[i+6];if(b===0){assert.equal(n,0);return 0;}const p=Math.round((n/b-1)*100);assert.ok(Math.abs(n-b*(1+p/100))<1e-9);return p;});}
 allowed(x,v){const start=performance.now(),valid=x.length===19&&x.every((p,j)=>Number.isInteger(p)&&Math.abs(p)<=15&&(p===0||this.base[j+6]!==0))&&v.length===25&&v.every(Number.isFinite)&&v.every((p,i)=>p>=this.bounds[i][0]&&p<=this.bounds[i][1]);this.stats.domainCheckMs+=performance.now()-start;return valid;}
 recordProposal(x){this.stats.generatedAttempts++;this.proposed.add(keyOf(x));this.stats.uniqueProposed=this.proposed.size;}
 validateTuple(x){this.recordProposal(x);const v=this.vectorFor(x),valid=this.allowed(x,v);if(!valid){this.stats.domainRejected++;this.rejectedKeys.add(keyOf(x));this.stats.uniqueDomainRejected=this.rejectedKeys.size;}return valid;}
 async evaluateTuples(tuples){const vectors=tuples.map(x=>this.vectorFor(x));return this.evaluateVectors(vectors);}
 async predictRows(vectors){return this.evaluateVectors(vectors);}
 async evaluateVectors(vectors){const pending=new Map(),keys=[];for(const v of vectors){const x=this.tupleFor(v),k=keyOf(x);keys.push(k);this.recordProposal(x);
   if(!this.allowed(x,v)){this.stats.domainRejected++;this.rejectedKeys.add(k);this.stats.uniqueDomainRejected=this.rejectedKeys.size;throw new Error('Illegal candidate reached inference boundary');}
   if(this.cache.has(k)||pending.has(k)){this.stats.cacheHits++;continue;}pending.set(k,{x,v});
  }
  if(pending.size){const entries=[...pending],start=performance.now(),predictions=await this.worker.predictRows(entries.map(([,r])=>r.v));this.stats.modelMs+=performance.now()-start;assert.equal(predictions.length,entries.length);this.stats.realModelRows+=entries.length;this.stats.realModelBatches++;
   entries.forEach(([k,r],i)=>{assert.ok(Number.isFinite(predictions[i]));this.cache.set(k,this.makeRow(r.x,roundPrediction(predictions[i])));});
  }
  return keys.map(k=>this.cache.get(k).prediction);
 }
 rows(){return [...this.cache.values()];}
 snapshot(){return {...this.stats,uniqueEvaluatedIncludingBaseline:this.cache.size,uniqueEvaluatedWithoutBaseline:this.cache.size-1,independentFieldsEverEvaluated:Array.from({length:19},(_,i)=>this.rows().some(r=>r.x[i]!==0))};}
}
export function assignRanksAndCrowding(population){const dominates=(a,b)=>a.gap<=b.gap&&a.actionCount<=b.actionCount&&(a.gap<b.gap||a.actionCount<b.actionCount),counts=new Map(),dominated=new Map();
 for(const a of population){let count=0;const list=[];for(const b of population)if(a!==b){if(dominates(a,b))list.push(b);else if(dominates(b,a))count++;}counts.set(a,count);dominated.set(a,list);a.rank=Infinity;a.crowding=0;}
 const fronts=[population.filter(r=>counts.get(r)===0)];for(let i=0;i<fronts.length&&fronts[i].length;i++){const next=[];for(const a of fronts[i]){a.rank=i;for(const b of dominated.get(a)){const n=counts.get(b)-1;counts.set(b,n);if(n===0)next.push(b);}}if(next.length)fronts.push(next);}
 for(const front of fronts){for(const r of front)r.crowding=0;for(const axis of ['gap','actionCount']){const sorted=[...front].sort((a,b)=>a[axis]-b[axis]||a.key.localeCompare(b.key));if(!sorted.length)continue;sorted[0].crowding=Infinity;sorted.at(-1).crowding=Infinity;const range=sorted.at(-1)[axis]-sorted[0][axis];if(range===0)continue;for(let i=1;i<sorted.length-1;i++)sorted[i].crowding+=(sorted[i+1][axis]-sorted[i-1][axis])/range;}}
 return fronts;
}
function chooseSurvivors(rows,n){const distinct=[...new Map(rows.map(r=>[r.key,r])).values()],fronts=assignRanksAndCrowding(distinct),chosen=[];for(const front of fronts){if(chosen.length+front.length<=n)chosen.push(...front);else{chosen.push(...[...front].sort((a,b)=>b.crowding-a.crowding||stable(a,b)).slice(0,n-chosen.length));break;}}assert.equal(chosen.length,n);assignRanksAndCrowding(chosen);return chosen;}
export async function runNsga(evaluator,config,seeds,rngSeed){const random=rngFromSeed(rngSeed),n=48,maxGenerations=8,started=performance.now();assert.equal(config.dimension,19);const stats={numericMutation:0,switchOn:0,switchOff:0,replacementMutation:0,crossover:0,initialRandomSparsity:[0,0,0,0],attempts:0},randInt=(min,max)=>min+Math.floor(random()*(max-min+1)),nonzero=()=>{let p=0;while(!p)p=randInt(-15,15);return p;};
 const permitted=Array.from({length:19},(_,j)=>Array.from({length:31},(_,i)=>i-15).filter(p=>{
  const value=evaluator.base[j+6]*(1+p/100);return p!==0&&evaluator.base[j+6]!==0&&value>=evaluator.bounds[j+6][0]&&value<=evaluator.bounds[j+6][1];
 })),movable=permitted.flatMap((p,j)=>p.length?[j]:[]);
 const fieldStep=j=>permitted[j].length===30?nonzero():permitted[j][randInt(0,permitted[j].length-1)];
 function randomTuple(band=null){const x=Array(19).fill(0);if(band===null){const r=random();band=r<.5?0:r<.8?1:r<.95?2:3;}const [low,high]=config.initializationBands[band],count=Math.min(randInt(low,high),movable.length),ids=movable.slice();for(let j=0;j<count;j++){const k=randInt(j,ids.length-1);[ids[j],ids[k]]=[ids[k],ids[j]];x[ids[j]]=fieldStep(ids[j]);}return x;}
 function tournament(pop){const a=pop[randInt(0,pop.length-1)],b=pop[randInt(0,pop.length-1)];if(a.rank!==b.rank)return a.rank<b.rank?a:b;if(a.crowding!==b.crowding)return a.crowding>b.crowding?a:b;return random()<.5?a:b;}
 function offspring(pop){const a=tournament(pop),b=tournament(pop),x=a.x.slice();if(random()<.9){for(let j=0;j<19;j++)if(random()<.5)x[j]=b.x[j];stats.crossover++;}
  const kind=randInt(0,2),active=x.flatMap((p,i)=>p!==0?[i]:[]),inactive=x.flatMap((p,i)=>p===0&&permitted[i].length?[i]:[]);
  if(kind===0){if(active.length){const j=active[randInt(0,active.length-1)],p=x[j]+(random()<.5?-1:1);if(Math.abs(p)<=15)x[j]=p;stats.numericMutation++;}else{const j=movable[randInt(0,movable.length-1)];x[j]=fieldStep(j);stats.switchOn++;}}
  else if(kind===1){if(active.length&&(!inactive.length||random()<.5)){x[active[randInt(0,active.length-1)]]=0;stats.switchOff++;}else{const j=inactive[randInt(0,inactive.length-1)];x[j]=fieldStep(j);stats.switchOn++;}}
  else if(active.length&&inactive.length){const old=active[randInt(0,active.length-1)],next=inactive[randInt(0,inactive.length-1)];x[next]=x[old];x[old]=0;stats.replacementMutation++;}else{const j=movable[randInt(0,movable.length-1)];x[j]=fieldStep(j);stats.switchOn++;}
  return x;
 }
 const initial=[],used=new Set();for(const x of seeds){const k=keyOf(x);if(initial.length<n&&!used.has(k)&&evaluator.validateTuple(x)){used.add(k);initial.push([...x]);}}
 const deterministicSeedCount=initial.length,remaining=n-initial.length,weights=config.nsgaInitializationMix,quotas=weights.map(w=>Math.floor(w*remaining));while(quotas.reduce((a,b)=>a+b,0)<remaining){let index=0;for(let j=1;j<4;j++)if(weights[j]*remaining-quotas[j]>weights[index]*remaining-quotas[index])index=j;quotas[index]++;}
 const constrained=permitted.some(steps=>steps.length!==30);
 for(let band=0;band<4;band++){let accepted=0,attempts=0;while(accepted<quotas[band]){if(++attempts>n*2000)throw Error('Initialization cannot fill legal population');
  // A narrow custom Domain can exhaust a requested sparsity band even when
  // enough legal points remain. Fill from the sparse band without changing
  // unrestricted-domain initialization or evaluating any illegal point.
  const effectiveBand=constrained&&attempts>n*20?0:band,x=randomTuple(effectiveBand),k=keyOf(x);stats.attempts++;
  if(used.has(k)||!evaluator.validateTuple(x))continue;used.add(k);initial.push(x);accepted++;stats.initialRandomSparsity[effectiveBand]++;
  if(effectiveBand!==band)stats.constrainedInitializationFallback=(stats.constrainedInitializationFallback||0)+1;
 }}
 await evaluator.evaluateTuples(initial);let population=initial.map(x=>({...evaluator.cache.get(keyOf(x))}));assignRanksAndCrowding(population);
 const traces=[],profile=()=>Array.from({length:20},(_,i)=>Math.min(Infinity,...evaluator.rows().filter(r=>r.actionCount===i).map(r=>r.gap)));let previous=profile(),stagnant=0,stopReason='BUDGET_EXHAUSTED';
 for(let generation=1;generation<=maxGenerations;generation++){
  if(generation>1){const tuples=[],seen=new Set();let attempts=0;while(tuples.length<n){if(++attempts>n*3000)throw Error('Offspring cannot fill legal population');const x=attempts>n*100?randomTuple(0):offspring(population),k=keyOf(x);stats.attempts++;if(seen.has(k)||!evaluator.validateTuple(x))continue;seen.add(k);tuples.push(x);}await evaluator.evaluateTuples(tuples);population=chooseSurvivors([...population,...tuples.map(x=>({...evaluator.cache.get(keyOf(x))}))],n);}
  const current=profile(),improved=generation===1||current.some((v,i)=>Number.isFinite(v)&&(!Number.isFinite(previous[i])||previous[i]-v>config.gapImprovementEpsilon));stagnant=improved?0:stagnant+1;previous=current;const selection=selectRepresentatives(evaluator.rows(),config.tolerance);
  traces.push({generation,bestGap:selection.nearest.gap,matchedMinimumCount:selection.minimumMatched?selection.minimum.actionCount:null,frontCount:selection.pareto.length,stagnantGenerations:stagnant,realModelRows:evaluator.stats.realModelRows,allBestGapsByCount:current.map(n=>Number.isFinite(n)?n:null)});
  if(generation>=config.minimumGenerations&&selection.matchedCount&&stagnant>=config.stagnantGenerations){stopReason='MATCHED_AND_PARETO_STAGNANT';break;}
 }
 return {generations:traces.length,population:n,proposedGenerationSlots:n*traces.length,maxGenerationSlots:n*maxGenerations,stopReason,deterministicSeedCount,initialRandomQuotas:quotas,operators:stats,generationTrace:traces,evolutionMs:performance.now()-started};
}
