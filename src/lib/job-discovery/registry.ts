import { AdzunaConnector } from './connectors/adzuna';
import { BraveConnector } from './connectors/brave';
import { GreenhouseConnector } from './connectors/greenhouse';
import { LeverConnector } from './connectors/lever';
import { RemotiveConnector } from './connectors/remotive';
import { ArbeitnowConnector } from './connectors/arbeitnow';
import type { Connector } from './types';

export function getConnectors(): Connector[] {
  return [
    new RemotiveConnector(),
    new ArbeitnowConnector(),
    new AdzunaConnector(),
    new BraveConnector(),
    new GreenhouseConnector(),
    new LeverConnector(),
  ];
}

export function getConnector(id: string): Connector | undefined {
  return getConnectors().find((c) => c.id === id);
}
