import type { CapturedRequest } from './provider/types.js';
import type { RequestPredicate, RouteHandler } from './session.js';

export interface ScenarioRoute { name: string; match: RequestPredicate; handle: RouteHandler }
export interface ScenarioStep extends ScenarioRoute { /** Required calls, default 1. */ times?: number }
export interface ScenarioOptions { background?: readonly ScenarioRoute[] }
export interface StepExpectation { name: string; expected: number; received: number }
export interface RouteMatch { requestId: string; name: string; kind: 'route' | 'step' | 'background' }

export function createScenario(steps: readonly ScenarioStep[], options: ScenarioOptions = {}) {
  if (!Array.isArray(steps) || steps.length === 0) throw new TypeError('A scenario requires at least one step');
  const names = new Set<string>();
  const validate = (route: ScenarioRoute) => {
    if (!route || typeof route.name !== 'string' || !route.name.trim() || names.has(route.name))
      throw new TypeError('Scenario step and background names must be nonempty and unique');
    if (typeof route.match !== 'function' || typeof route.handle !== 'function') throw new TypeError(`Invalid scenario route ${route.name}`);
    names.add(route.name);
    return { name: route.name, match: route.match, handle: route.handle };
  };
  const sequence = steps.map(step => {
    const route = validate(step);
    const expected = step.times ?? 1;
    if (!Number.isSafeInteger(expected) || expected < 1) throw new TypeError(`Step ${step.name}: times must be a positive safe integer`);
    return { ...route, expected, received: 0 };
  });
  const background = (options.background ?? []).map(validate);
  let index = 0;
  return {
    get expectations(): StepExpectation[] { return sequence.map(({ name, expected, received }) => ({ name, expected, received })); },
    select(request: CapturedRequest): { name: string; kind: 'step' | 'background'; handler: RouteHandler } {
      const allowed = background.find(route => route.match(structuredClone(request)));
      if (allowed) return { name: allowed.name, kind: 'background', handler: allowed.handle };
      const current = sequence[index];
      if (current && current.match(structuredClone(request))) {
        current.received++;
        if (current.received === current.expected) index++;
        return { name: current.name, kind: 'step', handler: current.handle };
      }
      const wrong = sequence.findIndex((step, position) => position !== index && step.match(structuredClone(request)));
      if (wrong !== -1) {
        const actual = sequence[wrong]!;
        throw new Error(`Scenario ${wrong < index ? 'unexpected repeat' : 'out of order'}: matched "${actual.name}"; expected ${current ? `"${current.name}" (${current.received}/${current.expected})` : 'no further steps'}`);
      }
      throw new Error(`Unexpected scenario request ${request.id}; expected ${current ? `"${current.name}"` : 'no further steps'}`);
    },
    assertComplete() {
      const missing = sequence.filter(step => step.received !== step.expected);
      if (missing.length) throw new Error(`Unfulfilled scenario steps: ${missing.map(step => `"${step.name}" received ${step.received}/${step.expected}`).join(', ')}`);
    },
  };
}
