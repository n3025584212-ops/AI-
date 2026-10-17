import assert from 'node:assert/strict';
import {Evaluator,keyOf,actionCount} from './sparse19-nsga.mjs';
export class RawTrialCache extends Evaluator{
 constructor(worker,frame,p0,bounds){super(worker,{canonical25:frame.canonical25},p0,bounds,null);}
 makeRow(x,prediction,origin='MODEL'){return {key:keyOf(x),x:[...x],prediction,delta:prediction-this.p0,
  actionCount:actionCount(x),l1:x.reduce((s,p)=>s+Math.abs(p),0),origin};}
}
export function rawRange(rows,p0){
 assert.ok(rows.length&&rows.every(r=>Number.isFinite(r.prediction)));
 const low=[...rows].sort((a,b)=>a.prediction-b.prediction||a.key.localeCompare(b.key))[0];
 const high=[...rows].sort((a,b)=>b.prediction-a.prediction||a.key.localeCompare(b.key))[0];
 return {predictionMin:low.prediction,predictionMax:high.prediction,deltaMin:low.prediction-p0,deltaMax:high.prediction-p0,
  lowKey:low.key,highKey:high.key,candidateCount:rows.length};
}
export function singleAxisTuples(raw,percents){const tuples=[];
 for(let j=0;j<19;j++)for(const p of percents){if(!p)continue;const x=Array(19).fill(0);x[j]=p;if(raw.validateTuple(x))tuples.push(x);}
 return tuples;
}
