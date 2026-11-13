/**
 * Plain-language definitions of every term the dashboard uses. Shared by the
 * UI (Guide panel, "?" popovers) and the rules-mode chat ("what does POAS mean?").
 */
export interface Term {
  id: string;
  term: string;
  /** other spellings people type */
  aliases: string[];
  short: string;
  example?: string;
}

export const GLOSSARY: Term[] = [
  { id: "net-sales", term: "Net sales", aliases: ["revenue", "umsatz", "net revenue"],
    short: "What customers actually paid for products, after discounts and minus refunds. VAT is not included.",
    example: "A CHF 59 battery that is returned adds nothing to net sales." },
  { id: "cogs", term: "Cost of goods (COGS)", aliases: ["cogs", "wareneinsatz", "landed cost"],
    short: "What the products cost you to buy and bring into the warehouse (purchase price, freight, duties). Returned items that cannot be resold count as a loss here." },
  { id: "cm1", term: "CM1 (gross margin)", aliases: ["cm1", "gross margin", "rohertrag", "db1"],
    short: "Net sales minus cost of goods. What is left before any operating or marketing cost." },
  { id: "cm2", term: "CM2 (margin before ads)", aliases: ["cm2", "db2", "contribution before ads"],
    short: "CM1 minus shipping subsidy, pick & pack, payment fees and return handling. What one sale really earns before you pay for advertising." },
  { id: "cm3", term: "CM3 (profit after ads)", aliases: ["cm3", "db3", "profit after ads", "contribution margin", "profit"],
    short: "CM2 minus ad spend. The money that is really left from selling, before fixed costs like rent and salaries. This is the number to steer on.",
    example: "CM3 of CHF 38'000 on CHF 177'000 net sales = 22% of every franc is kept." },
  { id: "ad-spend", term: "Ad spend", aliases: ["ad spend", "werbekosten", "marketing spend"],
    short: "What you paid Google, Meta and other platforms for ads in the period. It is shared out to the products those ads actually sold." },
  { id: "roas", term: "ROAS (platform)", aliases: ["roas", "platform roas", "return on ad spend"],
    short: "Revenue per franc of ads, as the ad platform reports it. Platforms usually claim more sales than really happened, so this number looks better than reality.",
    example: "ROAS 3.9x means the platform claims CHF 3.90 of revenue for every CHF 1 of ads." },
  { id: "true-roas", term: "True ROAS", aliases: ["true roas", "real roas"],
    short: "Revenue per franc of ads, counted from real Shopify orders instead of the platform's claim. The honest version of ROAS." },
  { id: "poas", term: "POAS (profit on ad spend)", aliases: ["poas", "profit on ad spend"],
    short: "Margin before ads (CM2) per franc of ads. Above 1.0 the campaign earns more than it costs; below 1.0 it loses money. Better than ROAS because it includes all costs.",
    example: "POAS 0.44 means every CHF 1 of ads brings back only CHF 0.44: CHF 0.56 is lost." },
  { id: "break-even-roas", term: "Break-even ROAS", aliases: ["break-even", "break even", "breakeven"],
    short: "The ROAS a campaign needs just to cover its costs. Below it, the campaign loses money. It is higher for low-margin products." },
  { id: "lost-is", term: "Lost impression share (budget)", aliases: ["lost is", "impression share", "lost impression"],
    short: "How often your ad could have been shown but was not, because the daily budget ran out. High on a profitable campaign means you are leaving money on the table." },
  { id: "cpc", term: "CPC (cost per click)", aliases: ["cpc", "cost per click"],
    short: "What one ad click costs. A sudden jump usually means a new competitor in the auction or broader keywords." },
  { id: "return-rate", term: "Return rate", aliases: ["returns", "retouren", "return rate"],
    short: "Share of sold units that came back. Every return costs the refund, handling, and often the product itself." },
  { id: "stock-days", term: "Stock days (days of cover)", aliases: ["stock days", "days of cover", "lagerreichweite"],
    short: "How many days the current stock lasts at the recent selling speed. Under about 10 days you should reorder, and stop advertising the product when it is nearly gone." },
  { id: "attribution", term: "Attribution / over-reporting", aliases: ["attribution", "over-reporting", "overreporting"],
    short: "Ad platforms each count a sale as theirs, so together they claim more sales than you had. This dashboard checks every claim against real Shopify orders." },
  { id: "shipping-subsidy", term: "Shipping subsidy", aliases: ["shipping", "versand", "free shipping"],
    short: "Carrier cost minus what the customer paid for shipping. With free shipping above a threshold, you pay the whole carrier cost." },
];

export function findTerm(text: string): Term | undefined {
  const q = text.toLowerCase();
  // longest alias first so "true roas" wins over "roas"
  const pairs = GLOSSARY.flatMap((t) => [t.term.toLowerCase(), ...t.aliases].map((a) => [a, t] as const)).sort((a, b) => b[0].length - a[0].length);
  return pairs.find(([a]) => new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(q))?.[1];
}
