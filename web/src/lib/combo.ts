import { createStore, readLocal, writeLocal } from './hooks';
import type { BetSelection, MarketType, PricePolicy } from './types';

export type ComboLeg = {
  raceId: string;
  raceLabel: string;
  raceStartAt: string;
  marketId: string;
  marketType: MarketType;
  marketParams: Record<string, number>;
  selection: BetSelection;
  selectionLabel: string;
  price: number;
  priceVersion: number;
};

export type ComboState = { legs: ComboLeg[]; stake: string; policy: PricePolicy; open: boolean };

const KEY = 'ars.combo.v1';
const initial: ComboState = { legs: [], stake: '', policy: 'NONE', open: true };

export const comboStore = createStore<ComboState>({ ...initial, ...readLocal<Partial<ComboState>>(KEY, {}) });

comboStore.subscribe(() => writeLocal(KEY, comboStore.get()));

window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  comboStore.set({ ...initial, ...readLocal<Partial<ComboState>>(KEY, {}) });
});

export const selectionKey = (selection: BetSelection) => ('order' in selection ? selection.order.join('>') : selection.entrantId);

export function addComboLeg(leg: ComboLeg): 'added' | 'duplicate' | 'replaced' {
  const state = comboStore.get();
  const same = state.legs.find((l) => l.marketId === leg.marketId && selectionKey(l.selection) === selectionKey(leg.selection));
  if (same) {
    comboStore.set({ ...state, open: true });
    return 'duplicate';
  }
  const sameMarket = state.legs.findIndex((l) => l.marketId === leg.marketId);
  if (sameMarket >= 0) {
    const legs = [...state.legs];
    legs[sameMarket] = leg;
    comboStore.set({ ...state, legs, open: true });
    return 'replaced';
  }
  comboStore.set({ ...state, legs: [...state.legs, leg], open: true });
  return 'added';
}

export function removeComboLeg(marketId: string): void {
  const state = comboStore.get();
  comboStore.set({ ...state, legs: state.legs.filter((leg) => leg.marketId !== marketId) });
}

export function clearCombo(): void {
  const state = comboStore.get();
  comboStore.set({ ...state, legs: [], stake: '' });
}

export function patchCombo(patch: Partial<ComboState>): void {
  comboStore.set({ ...comboStore.get(), ...patch });
}
