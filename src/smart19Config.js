import {MODEL_FEATURES} from './modelInputs.js';
import {deepFreeze} from './predictionSnapshot.js';
// Numerical trial Actions; none of these declarations send plant commands.
export const SMART19_ACTIONS=deepFreeze(MODEL_FEATURES.slice(6).map(f=>({actionId:`field_${f.index}`,displayName:f.label,
 affectedFields:[f.key],linkageMode:'SINGLE_FIELD_RELATIVE_PERCENT'})));
export const RANGE19_PROTOCOL=deepFreeze({version:'fixed19-bank-probe-corners-axis-pair-escape-v3',bankBudget:1024,starts:1,
 maxRounds:64,pairPasses:4,step:1,minPercent:-15,maxPercent:15,
 bankHash:'4b1bc0bb27971f2a853df0b83d06f1630d8dc5be3995664b1fcc97b5dfe28448'});
export const SMART19_CONFIG=deepFreeze({version:'smart19-nsga384-range-axis-pair-v3',dimension:19,actions:SMART19_ACTIONS,
 fields:SMART19_ACTIONS.flatMap(a=>a.affectedFields),maxChangedActions:19,totalRelativeChangeMethod:'ACTION_BASED_L1',
 actionLevelsPercent:Array.from({length:31},(_,i)=>i-15),levels:[6,10,15].map((maxPercent,i)=>({level:i+1,maxPercent})),
 tolerance:3,population:48,generations:8,minimumGenerations:6,stagnantGenerations:2,gapImprovementEpsilon:0.0001,
 nsgaInitializationMix:[0.5,0.3,0.15,0.05],initializationBands:[[1,3],[4,5],[6,8],[9,19]],
 seed:101,maxSlots:384,modelBatchSize:48,maxCachedBaselines:4,timeBudgetMs:30000,rangeProtocol:RANGE19_PROTOCOL});
