import { CARD_VERSION } from './shared/const';
import { localize } from './shared/localize/localize';

// Side-effect imports register each card element with the browser. Every card
// in the collection is imported here so the single bundle wires them all up.
import './cards/bedjet/bedjet-card';

console.info(
  `%c  SF-LOVELACE \n%c  ${localize('common.version')} ${CARD_VERSION}    `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

export { CARD_VERSION };
