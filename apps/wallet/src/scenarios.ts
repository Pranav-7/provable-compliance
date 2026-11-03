import type { ActionResult, ScenarioStep } from '@pc/shared';
import type { HolderWallets } from './wallets';

export type { ScenarioStep };

export async function runScenario(
  wallets: HolderWallets,
  steps: ScenarioStep[],
  onStep?: (index: number, result: ActionResult) => void,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const [i, step] of steps.entries()) {
    const r = await wallets.transfer(step);
    results.push(r);
    onStep?.(i, r);
  }
  return results;
}
