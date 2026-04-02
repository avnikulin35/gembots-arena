/**
 * Guided Scenarios (Сценарии) — pre-built interactive wizard flows
 */
export interface ScenarioStep {
    id: string;
    question: string;
    type: 'text' | 'select' | 'multiselect';
    options?: string[];
    placeholder?: string;
    optional?: boolean;
}
export interface Scenario {
    id: string;
    icon: string;
    title: string;
    description: string;
    category: string;
    steps: ScenarioStep[];
    resultPrompt: string;
}
export declare const scenarios: Scenario[];
export default scenarios;
