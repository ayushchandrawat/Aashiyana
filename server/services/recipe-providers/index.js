import { MealieAdapter } from './mealie.js';
import { TandoorAdapter } from './tandoor.js';

const ADAPTERS = {
  mealie: MealieAdapter,
  tandoor: TandoorAdapter,
};

export const SUPPORTED_PROVIDERS = Object.keys(ADAPTERS);

function defaultAdapterFactory(account) {
  if (!account?.provider) throw new Error('getAdapter: account.provider is required');
  const Adapter = ADAPTERS[account.provider];
  if (!Adapter) throw new Error(`Unknown recipe provider: "${account.provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
  return new Adapter(account);
}

let adapterFactory = defaultAdapterFactory;

/** Test-Hook: injiziert einen Fake-Adapter statt echter HTTP-Requests. */
export function _setAdapterFactory(fn) {
  adapterFactory = fn || defaultAdapterFactory;
}

export function getAdapter(account) {
  return adapterFactory(account);
}
