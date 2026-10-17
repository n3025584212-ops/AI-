import { deepFreeze } from './predictionSnapshot.js';

// Search actions expand into the existing canonical inputs; they do not change
// model dimensions or assert that linked inputs are the same physical signal.
export const ADJUSTABLE_ACTIONS_V1 = deepFreeze([
 {actionId:'interstand_tension',displayName:'S4-S5机架间张力',affectedFields:['S4 front tension','S5 back tension'],linkageMode:'RELATIVE_SAME_PERCENT'},
 {actionId:'s5_rolling_speed',displayName:'S5轧制速度',affectedFields:['S5 rolling speed'],linkageMode:'SINGLE_FIELD_RELATIVE_PERCENT'}
]);
export const SEARCH_LEVELS = deepFreeze([6,10,15].map((maxPercent,index)=>({level:index+1,maxPercent,
 actionLevelsPercent:Array.from({length:maxPercent*2+1},(_,i)=>i-maxPercent),totalCandidates:(maxPercent*2+1)**2})));
export const ACTION_LEVELS_PERCENT = SEARCH_LEVELS[2].actionLevelsPercent;
export const MAX_CHANGED_ACTIONS = 2;
export const MAX_TOTAL_ACTION_CHANGE_PERCENT = null;
export const SEARCH_MATCH_TOLERANCE_DEFAULT = 3;
export const SEARCH_MATCH_TOLERANCE_MIN = 1;
export const SEARCH_MATCH_TOLERANCE_MAX = 10;
export const PROCESS_TARGET_TOLERANCE = null;
export const TOTAL_RELATIVE_CHANGE_METHOD = 'ACTION_BASED_L1';
// The complete grid already contains the single-action axes and (0,0).
// Enumerate every cell, then explicitly validate budget/ranges before inference.
export const actionStepsForLevel = level => {
 const definition=SEARCH_LEVELS.find(item=>item.level===level);
 if(!definition)throw Error('未知候选搜索级别。');
 return definition.actionLevelsPercent.flatMap(a=>definition.actionLevelsPercent.map(b=>[a,b]));
};
export const PAIR_ACTION_STEPS = deepFreeze(actionStepsForLevel(1));
export const SINGLE_ACTION_CANDIDATES = ADJUSTABLE_ACTIONS_V1.length*(ACTION_LEVELS_PERCENT.length-1);
export const PAIR_ACTION_CANDIDATES = (ACTION_LEVELS_PERCENT.length-1)**2;
export const TOTAL_CANDIDATES = SEARCH_LEVELS[2].totalCandidates;
export const SEARCH_CONFIG = deepFreeze({
 version:'smart-candidate-actual-anchored-adaptive-v3',actions:ADJUSTABLE_ACTIONS_V1,levels:SEARCH_LEVELS,
 fields:ADJUSTABLE_ACTIONS_V1.flatMap(action=>action.affectedFields),
 actionLevelsPercent:ACTION_LEVELS_PERCENT,pairActionSteps:PAIR_ACTION_STEPS,
 maxChangedActions:MAX_CHANGED_ACTIONS,maxTotalChange:MAX_TOTAL_ACTION_CHANGE_PERCENT,
 totalRelativeChangeMethod:TOTAL_RELATIVE_CHANGE_METHOD,
 singleActionCandidates:SINGLE_ACTION_CANDIDATES,pairActionCandidates:PAIR_ACTION_CANDIDATES,
 unchangedCandidates:1,minActionPercent:-15,maxActionPercent:15,actionStepPercent:1,
 searchMatchToleranceDefault:SEARCH_MATCH_TOLERANCE_DEFAULT,searchMatchToleranceMin:SEARCH_MATCH_TOLERANCE_MIN,searchMatchToleranceMax:SEARCH_MATCH_TOLERANCE_MAX,
 maxCandidates:TOTAL_CANDIDATES,totalCandidates:TOTAL_CANDIDATES,timeBudgetMs:8000
});
