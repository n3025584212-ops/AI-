import { checkHistoricalRanges } from './historicalRangeCheck.js';
import { sourceUnitFor } from './engineeringUnits.js';

// This is a read-only projection of the existing UI check, not another range
// algorithm. Both the UI hook and question service use this same result.
export function effectiveRangeProjection(caseData, table, limits = {}) {
  const checked = checkHistoricalRanges(caseData, table, limits);
  const effectiveRanges = checked.rows.map(row => ({
    parameter_id:row.key, display_name:row.label, current_value:row.value,
    unit:sourceUnitFor(row.field),is_model_input:row.isModelInput,
    effective_lower:row.min, effective_upper:row.max,
    default_lower:row.defaultLower,default_upper:row.defaultUpper,
    default_lower_source:row.defaultLowerSource,default_upper_source:row.defaultUpperSource,
    range_status:row.status === 'NORMAL' ? 'IN_RANGE'
      : row.status === 'REVIEW_RECOMMENDED' ? (row.value < row.min ? 'BELOW_RANGE' : 'ABOVE_RANGE')
      : 'INSUFFICIENT_HISTORY',
    range_source:row.rangeSource,lower_source:row.lowerSource,upper_source:row.upperSource,
    check_status:row.status,
    history_sample_count:row.history?.finiteCount ?? null,
    history_missing_count:row.history?.missingCount ?? null,
  }));
  return {checked, effectiveRanges};
}
