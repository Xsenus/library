export type StepKey = 'lookup' | 'parse_site' | 'analyze_json' | 'ib_match' | 'equipment_selection';

export const DEFAULT_STEPS: StepKey[] = ['lookup', 'parse_site', 'analyze_json', 'ib_match', 'equipment_selection'];
