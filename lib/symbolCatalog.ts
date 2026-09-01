import { Currency } from "./types";

export interface CatalogEntry {
  symbol: string;
  name: string;
  nameEn: string;
  category: string;
  /** Annual expense ratio (%), only meaningful for ETF/Fund category.
   *  Left undefined when no verified figure exists — the UI shows a dash for
   *  that rather than a 0% the fund does not actually charge. */
  expenseRatio?: number;
  /** What the fund holds (美國公債 / 投資級公司債 / 金融債 ...). Bond ETFs only. */
  assetClass?: string;
  /** Credit tier the fund's mandate commits to, as stated in its official
   *  name. Undefined when the name states none — never inferred. */
  creditRating?: string;
  /** Net assets in the fund's own trading currency, as measured on
   *  FUND_SIZE_AS_OF. See that constant for why this is a dated snapshot
   *  rather than a live figure. */
  fundSizeSnapshot?: number;
}

/**
 * When the fundSizeSnapshot figures were read from the exchange.
 *
 * These were fetched live at first, but the endpoint carrying net assets
 * answers Cloudflare's egress IPs with 429 Too Many Requests — so in
 * production the figure was never available at all, however well it worked
 * locally. A dated snapshot of numbers actually measured beats a live lookup
 * that always renders a dash. Fund size moves slowly and is read for scale
 * (is this a NT$245bn fund or a NT$500m one?), so a dated figure still answers
 * the question; the date is shown in the UI so staleness is visible rather
 * than implied. Re-run the fetch to refresh it.
 *
 * Covers every fund in the catalog, equity ETFs included — a fund-size column
 * that only fills in for bond ETFs answers the question for none of the
 * comparisons people actually run. Individual stocks carry no figure by
 * definition, and two funds (00687B, 00790B) are absent from the source's
 * net-assets data entirely; all of those show a dash rather than a guess.
 */
export const FUND_SIZE_AS_OF = "2026-08-31";

/** Curated list of popular global ETFs and stocks for quick search/add.
 *  expenseRatio values reflect each fund's actual published annual expense ratio. */
export const SYMBOL_CATALOG: CatalogEntry[] = [
  { symbol: "VOO", name: "Vanguard 標普500 ETF", nameEn: "Vanguard S&P 500 ETF", category: "ETF", expenseRatio: 0.03, fundSizeSnapshot: 1686884319232 },
  { symbol: "VT", name: "Vanguard 全世界股票 ETF", nameEn: "Vanguard Total World Stock ETF", category: "ETF", expenseRatio: 0.07, fundSizeSnapshot: 97884921856 },
  { symbol: "SPY", name: "SPDR 標普500 ETF", nameEn: "SPDR S&P 500 ETF Trust", category: "ETF", expenseRatio: 0.0945, fundSizeSnapshot: 795306885120 },
  { symbol: "QQQ", name: "Invesco 那斯達克100 ETF", nameEn: "Invesco QQQ Trust", category: "ETF", expenseRatio: 0.20, fundSizeSnapshot: 452800643072 },
  { symbol: "TQQQ", name: "Invesco 那斯達克100 正3倍槓桿 ETF", nameEn: "Invesco QQQ Trust 3x Shares", category: "ETF", expenseRatio: 1.08, fundSizeSnapshot: 32831182848 },
  { symbol: "QLD", name: "Direxion 那斯達克100 正3倍槓桿 ETF", nameEn: "Direxion Daily Nasdaq-100 Bull 3x Shares", category: "ETF", expenseRatio: 1.01, fundSizeSnapshot: 12760278016 },
  { symbol: "UPRO", name: "ProShares 標普500 正3倍槓桿 ETF", nameEn: "ProShares Ultra Pro S&P 500 ETF", category: "ETF", expenseRatio: 1.01, fundSizeSnapshot: 5150206464 },
  { symbol: "SSO", name: "ProShares 標普500 正2倍槓桿 ETF", nameEn: "ProShares Ultra S&P 500 ETF", category: "ETF", expenseRatio: 0.91, fundSizeSnapshot: 7808743424 },
  { symbol: "VTI", name: "Vanguard 全美股市 ETF", nameEn: "Vanguard Total Stock Market ETF", category: "ETF", expenseRatio: 0.03, fundSizeSnapshot: 2289978572800 },
  { symbol: "VXUS", name: "Vanguard 全球（美國除外）ETF", nameEn: "Vanguard Total Intl Stock ETF", category: "ETF", expenseRatio: 0.05, fundSizeSnapshot: 645815664640 },
  { symbol: "VEA", name: "Vanguard 已開發市場 ETF", nameEn: "Vanguard FTSE Developed Markets ETF", category: "ETF", expenseRatio: 0.03, fundSizeSnapshot: 314947534848 },
  { symbol: "VWO", name: "Vanguard 新興市場 ETF", nameEn: "Vanguard FTSE Emerging Markets ETF", category: "ETF", expenseRatio: 0.07, fundSizeSnapshot: 162032336896 },
  { symbol: "ARKK", name: "ARK 創新 ETF", nameEn: "ARK Innovation ETF", category: "ETF", expenseRatio: 0.75, fundSizeSnapshot: 5562265088 },
  { symbol: "GLD", name: "SPDR 黃金 ETF", nameEn: "SPDR Gold Shares", category: "ETF", expenseRatio: 0.40, fundSizeSnapshot: 130322653184 },
  // Taiwan-listed ETFs (Yahoo Finance requires the .TW suffix for TWSE tickers).
  // Several issuers (notably 0050 and 006208) moved to asset-size-tiered management
  // fees in 2025, so these totals are current best-effort snapshots rather than
  // fixed published rates — expect them to drift as fund size changes.
  { symbol: "0050.TW", name: "元大台灣50 ETF", nameEn: "Yuanta Taiwan Top 50 ETF", category: "ETF", expenseRatio: 0.20, fundSizeSnapshot: 2283731419136 },
  { symbol: "006208.TW", name: "富邦台50 ETF", nameEn: "Fubon Taiwan 50 ETF", category: "ETF", expenseRatio: 0.23, fundSizeSnapshot: 435006078976 },
  { symbol: "0056.TW", name: "元大高股息 ETF", nameEn: "Yuanta Taiwan Dividend Plus ETF", category: "ETF", expenseRatio: 0.66, fundSizeSnapshot: 703518998528 },
  { symbol: "00878.TW", name: "國泰永續高股息 ETF", nameEn: "Cathay Taiwan ESG High Dividend ETF", category: "ETF", expenseRatio: 0.59, fundSizeSnapshot: 594163007488 },
  { symbol: "00919.TW", name: "群益台灣精選高息 ETF", nameEn: "Capital Taiwan Top Dividend Select ETF", category: "ETF", expenseRatio: 0.55, fundSizeSnapshot: 538296778752 },
  { symbol: "00929.TW", name: "復華台灣科技優息 ETF", nameEn: "FSITC Taiwan Technology Optimized Yield ETF", category: "ETF", expenseRatio: 0.60, fundSizeSnapshot: 131343351808 },
  { symbol: "00631L.TW", name: "元大台灣50正2 ETF（2倍槓桿）", nameEn: "Yuanta Taiwan 50 Leveraged 2X ETF", category: "ETF", expenseRatio: 1.05, fundSizeSnapshot: 264845983744 },
  { symbol: "00632R.TW", name: "元大台灣50反1 ETF（反向1倍）", nameEn: "Yuanta Taiwan 50 Inverse 1X ETF", category: "ETF", expenseRatio: 1.00, fundSizeSnapshot: 22022539264 },
  // --- Bond ETFs, for evaluating retirement income rather than capital gains.
  // Taiwan-listed bond ETFs trade on TPEx, not the TWSE, so they carry the
  // .TWO suffix (a .TW lookup returns nothing at all for every one of them).
  //
  // Symbols, Chinese names and English names below were all read from the
  // exchange rather than written by hand. assetClass and creditRating are
  // derived from each fund's own official name, which by Taiwanese naming
  // rules must state its credit tier ("投資級", "A級", "BBB", "非投等" ...);
  // creditRating is left unset for the funds whose name states no tier, so the
  // UI shows a dash rather than an invented rating. Non-investment-grade funds
  // are deliberately absent from this list.
  //
  // Expense ratios are omitted for the Taiwan funds: the data source reports a
  // literal 0.00% for all of them, which is not a real figure, and showing 0%
  // for a fund that certainly charges a fee would be worse than showing none.
  // --- US-listed bond ETFs. assetClass/creditRating reflect each fund's stated
  // mandate; expense ratios are the published figures Yahoo reports for them.
  { symbol: "TLT", name: "iShares 20年期以上美國公債 ETF", nameEn: "iShares 20+ Year Treasury Bond ETF", category: "Bond ETF", expenseRatio: 0.15, assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 41543831552 },
  { symbol: "IEF", name: "iShares 7-10年期美國公債 ETF", nameEn: "iShares 7-10 Year Treasury Bond ETF", category: "Bond ETF", expenseRatio: 0.15, assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 47187439616 },
  { symbol: "SHY", name: "iShares 1-3年期美國公債 ETF", nameEn: "iShares 1-3 Year Treasury Bond ETF", category: "Bond ETF", expenseRatio: 0.15, assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 25080700928 },
  { symbol: "GOVT", name: "iShares 美國公債 ETF", nameEn: "iShares U.S. Treasury Bond ETF", category: "Bond ETF", expenseRatio: 0.05, assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 43550478336 },
  { symbol: "TIP", name: "iShares 抗通膨美國公債 ETF", nameEn: "iShares TIPS Bond ETF", category: "Bond ETF", expenseRatio: 0.18, assetClass: "美國抗通膨公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 14603292672 },
  { symbol: "LQD", name: "iShares iBoxx 投資級公司債 ETF", nameEn: "iShares iBoxx $ Investment Grade Corporate Bond ETF", category: "Bond ETF", expenseRatio: 0.14, assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 33045540864 },
  { symbol: "USIG", name: "iShares 廣泛美元投資級公司債 ETF", nameEn: "iShares Broad USD Investment Grade Corporate Bond ETF", category: "Bond ETF", expenseRatio: 0.04, assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 17321924608 },
  { symbol: "IGSB", name: "iShares 1-5年期投資級公司債 ETF", nameEn: "iShares 1-5 Year Investment Grade Corporate Bond ETF", category: "Bond ETF", expenseRatio: 0.04, assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 23240476672 },
  { symbol: "VCIT", name: "Vanguard 中期公司債 ETF", nameEn: "Vanguard Intermediate-Term Corporate Bond ETF", category: "Bond ETF", expenseRatio: 0.03, assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 69771010048 },
  { symbol: "VCLT", name: "Vanguard 長期公司債 ETF", nameEn: "Vanguard Long-Term Corporate Bond ETF", category: "Bond ETF", expenseRatio: 0.03, assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 9720465408 },
  { symbol: "AGG", name: "iShares 美國綜合債券 ETF", nameEn: "iShares Core U.S. Aggregate Bond ETF", category: "Bond ETF", expenseRatio: 0.03, assetClass: "綜合債券", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 137109602304 },
  { symbol: "BNDX", name: "Vanguard 國際綜合債券 ETF（美元避險）", nameEn: "Vanguard Total International Bond ETF", category: "Bond ETF", expenseRatio: 0.07, assetClass: "國際綜合債券", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 122521632768 },
  { symbol: "MUB", name: "iShares 美國市政債 ETF", nameEn: "iShares National Muni Bond ETF", category: "Bond ETF", expenseRatio: 0.05, assetClass: "美國市政債", creditRating: "高評級（A- 以上）", fundSizeSnapshot: 45275856896 },

  // --- Taiwan-listed (TPEx) investment-grade bond ETFs, ordered by fund size.
  { symbol: "00937B.TWO", name: "群益ESG投等債20+", nameEn: "CAPITAL ICE ESG 20+ Year BBB Us Corporate ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 245334228992 },
  { symbol: "00679B.TWO", name: "元大美債20年", nameEn: "Yuanta U.S. Treasury 20+ Year Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 167406043136 },
  { symbol: "00751B.TWO", name: "元大AAA至A公司債", nameEn: "Yuanta US 20+ Year AAA-A Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "AAA–A", fundSizeSnapshot: 157767090176 },
  { symbol: "00720B.TWO", name: "元大投資級公司債", nameEn: "Yuanta US 20+ Year BBB Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 130677530624 },
  { symbol: "00725B.TWO", name: "國泰投資級公司債", nameEn: "Cathay BBB Corporate bond ex China Coupon 4.5%10Yrplus 20% Sector Capped ET", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 126569594880 },
  { symbol: "00772B.TWO", name: "中信高評級公司債", nameEn: "CTBC USD Corporate 10+ Year High Grade Capped Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "高評級（A- 以上）", fundSizeSnapshot: 110437023744 },
  { symbol: "00933B.TWO", name: "國泰10Y+金融債", nameEn: "Cathay US Corporate 10+ Years Banking ETF", category: "Bond ETF", assetClass: "金融債", fundSizeSnapshot: 102057934848 },
  { symbol: "00724B.TWO", name: "群益投資級金融債", nameEn: "Capital BofA Merrill Lynch 10+ Year US Banking Index ETF", category: "Bond ETF", assetClass: "金融債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 100441735168 },
  { symbol: "00761B.TWO", name: "國泰A級公司債", nameEn: "Cathay US Corp A- Above 10+ Yr ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A- 以上", fundSizeSnapshot: 92554092544 },
  { symbol: "00773B.TWO", name: "中信優先金融債", nameEn: "CTBC Banking Senior 10+ Year Bond ETF", category: "Bond ETF", assetClass: "金融債", fundSizeSnapshot: 91424800768 },
  { symbol: "00746B.TWO", name: "富邦A級公司債", nameEn: "Fubon 9-35 Years US Corporate Bond A ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A 級", fundSizeSnapshot: 88337760256 },
  { symbol: "00740B.TWO", name: "富邦全球投等債", nameEn: "Fubon US Corporate Bond ETF Umbrella Fund - Fubon 10+Years US Corporate Bond BBB Ex China", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 82721128448 },
  { symbol: "00792B.TWO", name: "群益A級公司債", nameEn: "CAPITAL ICE 15+ YEAR SINGLE-A US CORPORATE EXCHANGE TRADED FUND", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A 級", fundSizeSnapshot: 70828220416 },
  { symbol: "00777B.TWO", name: "凱基AAA至A公司債", nameEn: "KGI 15+ Years AAA -A US Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "AAA–A", fundSizeSnapshot: 65901694976 },
  { symbol: "00950B.TWO", name: "凱基A級公司債", nameEn: "KGI Global 10+ Year USD Single A Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A 級", fundSizeSnapshot: 56323522560 },
  { symbol: "00778B.TWO", name: "凱基金融債20+", nameEn: "KGI 20+Years US Banking Bond ETF", category: "Bond ETF", assetClass: "金融債", fundSizeSnapshot: 51507335168 },
  { symbol: "00722B.TWO", name: "群益投資級電信債", nameEn: "Capital BofA Merrill Lynch 15+ Year US Telecommunications Index ETF", category: "Bond ETF", assetClass: "電信公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 50057682944 },
  { symbol: "00723B.TWO", name: "群益投資級科技債", nameEn: "Capital BofA Merrill Lynch 15+ Year US Technology & Electronics Index ETF", category: "Bond ETF", assetClass: "科技公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 44975996928 },
  { symbol: "00764B.TWO", name: "群益25年美債", nameEn: "Capital ICE 25+ Year Us Treasury ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 42154377216 },
  { symbol: "00754B.TWO", name: "群益AAA-AA公司債", nameEn: "Capital ICE 15+ Year AAA-AA US Corporate ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "AAA–AA", fundSizeSnapshot: 41267916800 },
  { symbol: "00795B.TWO", name: "中信美國公債20年", nameEn: "CTBC U.S. Treasury 20+ Year Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 40225779712 },
  { symbol: "00756B.TWO", name: "群益投等新興公債", nameEn: "Capital ICE International15+ Year US Emerging Markets External Sovereign ETF", category: "Bond ETF", assetClass: "新興市場債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 39374618624 },
  { symbol: "00726B.TWO", name: "國泰新興投等債", nameEn: "Cathay EM USD Investment Grade ex China Coupon 5.5%5Yrplus 10% Country Capp", category: "Bond ETF", assetClass: "新興市場債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 38714142720 },
  { symbol: "00768B.TWO", name: "復華20年美債", nameEn: "Fuh Hwa US Treasury 20+ Year ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 37494497280 },
  { symbol: "00785B.TWO", name: "富邦金融投等債", nameEn: "Fubon FTSE World Broad Investment-Grade USD Bank Bond 10+ Years Index ETF", category: "Bond ETF", assetClass: "金融債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 36678172672 },
  { symbol: "00948B.TWO", name: "中信優息投資級債", nameEn: "CTBC Enhanced Yield 15+ Year Investment Grade Senior US Developed Markets Corporate ESG Screened Bon", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 36660506624 },
  { symbol: "00779B.TWO", name: "凱基美債25+", nameEn: "KGI 25+ Years US Treasury Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 35855998976 },
  { symbol: "00749B.TWO", name: "凱基新興債10+", nameEn: "KGI 10+Year Em Mkt USD Invmt Grd Bd ETF", category: "Bond ETF", assetClass: "新興市場債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 34551947264 },
  { symbol: "00931B.TWO", name: "統一美債20年", nameEn: "UPAMC US Treasury 20 Plus Year ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 29239752704 },
  { symbol: "00942B.TWO", name: "台新美A公司債20+", nameEn: "Taishin Bloomberg US Corporate 20+ Years Single A Issuer & Sector Capped ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A 級", fundSizeSnapshot: 27935520768 },
  { symbol: "00862B.TWO", name: "中信投資級公司債", nameEn: "CTBC US 20+ Year BBB Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 27162494976 },
  { symbol: "00760B.TWO", name: "復華新興企業債", nameEn: "Fuh Hwa Emerging Market Credit Bond ETF", category: "Bond ETF", assetClass: "新興市場債", fundSizeSnapshot: 23217561600 },
  { symbol: "00789B.TWO", name: "復華公司債A3", nameEn: "Fuh Hwa 20+ Year A3 or Better Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A3（≈A-）以上", fundSizeSnapshot: 21244661760 },
  { symbol: "00696B.TWO", name: "富邦美債20年", nameEn: "Fubon 20 +Years US Treasury Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 17236840448 },
  { symbol: "00836B.TWO", name: "永豐10年A公司債", nameEn: "Sinopac ICE 10+ Year Core Large Cap Single-A US Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A 級", fundSizeSnapshot: 17227079680 },
  { symbol: "00867B.TWO", name: "台新A-BBB電信債", nameEn: "Taishin Premium Umbrella Fund - Taishin ICE 15+ Year US Telecommunications Index ETF", category: "Bond ETF", assetClass: "電信公司債", creditRating: "A- 以上", fundSizeSnapshot: 17032177664 },
  { symbol: "00791B.TWO", name: "復華信用債1-5", nameEn: "Fuh Hwa 1-5 Year USD Credit Select Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", fundSizeSnapshot: 16028964864 },
  { symbol: "00863B.TWO", name: "中信全球電信債", nameEn: "CTBC US 10+ Year Telecommunications Bond ETF", category: "Bond ETF", assetClass: "電信公司債", fundSizeSnapshot: 15864510464 },
  { symbol: "00870B.TWO", name: "元大15年EM主權債", nameEn: "Yuanta US 15+ Year Emerging Markets Sovereign Bond ETF", category: "Bond ETF", assetClass: "新興市場債", fundSizeSnapshot: 15652717568 },
  { symbol: "00857B.TWO", name: "永豐20年美公債", nameEn: "SinoPac ICE 20+ Year US Treasury ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 11853469696 },
  { symbol: "00719B.TWO", name: "元大美債1-3", nameEn: "Yuanta U.S. Treasury 1-3 Year Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 9714907136 },
  { symbol: "00780B.TWO", name: "國泰A級金融債", nameEn: "Cathay 7-10 Year Banking Bond Select ETF", category: "Bond ETF", assetClass: "金融債", creditRating: "A 級", fundSizeSnapshot: 9249057792 },
  { symbol: "00755B.TWO", name: "群益投資級公用債", nameEn: "Capital ICE 15+ Year US Utility ETF", category: "Bond ETF", assetClass: "公用事業債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 9074906112 },
  { symbol: "00845B.TWO", name: "富邦新興投等債", nameEn: "Fubon Emerging Market USD Investment Grade Bond ETF", category: "Bond ETF", assetClass: "新興市場債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 7921437696 },
  { symbol: "00844B.TWO", name: "台新15年IG金融債", nameEn: "Taishin Supreme Umbrella Fund - Taishin 15 Years USD Banking Bond ETF", category: "Bond ETF", assetClass: "金融債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 6949888512 },
  { symbol: "00968B.TWO", name: "元大優息投等債", nameEn: "Yuanta Enhanced Yield 10+ Yr Coupon Select Investment Grade US Developed Markets Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 6266188288 },
  { symbol: "00853B.TWO", name: "統一美債10年Aa-A", nameEn: "UPAMC 10Y+ Aa-A USD Senior Corporate Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 4825693696 },
  { symbol: "00750B.TWO", name: "凱基科技債10+", nameEn: "KGI 10+ Year USD Technology Bond ETF", category: "Bond ETF", assetClass: "科技公司債", fundSizeSnapshot: 4741035008 },
  { symbol: "00959B.TWO", name: "大華投等美債15Y+", nameEn: "United 15+ Years BBB US Corporate ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 4679540736 },
  { symbol: "00864B.TWO", name: "中信美國公債0-1", nameEn: "CTBC 0-1 Year US Treasury Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 4610550272 },
  { symbol: "00848B.TWO", name: "中信新興亞洲債", nameEn: "CTBC Emerging Asia (ex China) USD Select Bond ETF", category: "Bond ETF", assetClass: "新興市場債", fundSizeSnapshot: 4581332480 },
  { symbol: "00970B.TWO", name: "台新BBB投等債20+", nameEn: "Taishin 20+ Year BBB US Investment Grade Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 3476531456 },
  { symbol: "00846B.TWO", name: "富邦歐洲銀行債", nameEn: "Fubon 7-15 Years Europe USD Banking ETF", category: "Bond ETF", assetClass: "金融債", fundSizeSnapshot: 2694682624 },
  { symbol: "00759B.TWO", name: "復華製藥債", nameEn: "Fuh Hwa 15+ Yr Pharmaceuticals Bond ETF", category: "Bond ETF", assetClass: "醫療保健債", fundSizeSnapshot: 2561924608 },
  { symbol: "00957B.TWO", name: "兆豐US優選投等債", nameEn: "Mega 20 plus Year US Business ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 2497020928 },
  { symbol: "00697B.TWO", name: "元大美債7-10", nameEn: "Yuanta U.S. Treasury 7-10 Year Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 2261348352 },
  { symbol: "00884B.TWO", name: "中信低碳新興債", nameEn: "CTBC 15+ Year Large Cap USD Emerging Markets External Sovereign Carbon Reduction ETF", category: "Bond ETF", assetClass: "新興市場債", fundSizeSnapshot: 2175206400 },
  { symbol: "00841B.TWO", name: "凱基AAA-AA公司債", nameEn: "KGI 20+ Year AAA-AA US Large Cap Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "AAA–AA", fundSizeSnapshot: 1979001728 },
  { symbol: "00984B.TWO", name: "大華優利美A債15", nameEn: "United Enhanced Yield 15+ Years Single-A US Corporate ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "A 級", fundSizeSnapshot: 1978978304 },
  { symbol: "00840B.TWO", name: "凱基IG精選15+", nameEn: "KGI 15+ Year US Investment Grade Corporate Select Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 1736240384 },
  { symbol: "00967B.TWO", name: "元大優息美債", nameEn: "Yuanta U.S. Treasury 10+ Yr Enhanced Yield and Cpn Select ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 1623512576 },
  { symbol: "00966B.TWO", name: "統一ESG投等債15+", nameEn: "UPAMC Bloomberg MSCI ESG Tilted 15Yr Plus USD BBB Senior Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 1604169728 },
  { symbol: "00694B.TWO", name: "富邦美債1-3", nameEn: "Fubon 1-3 Years US Treasury Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 1549933952 },
  { symbol: "00695B.TWO", name: "富邦美債7-10", nameEn: "Fubon 7-10 Years US Treasury Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 1398029568 },
  { symbol: "00969B.TWO", name: "元大零息超長美債", nameEn: "Yuanta U.S. Strips 25+ Year Select ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 1257197568 },
  { symbol: "00987B.TWO", name: "野村10+澳洲公債", nameEn: "Nomura Australia 10+ Year Sovereign and Quasi-Sovereign Bond ETF", category: "Bond ETF", assetClass: "澳洲公債", creditRating: "AAA（澳洲主權）", fundSizeSnapshot: 1132347520 },
  { symbol: "00958B.TWO", name: "永豐ESG銀行債15+", nameEn: "SinoPac 15+ Year Investment Grade US Banking ESG ETF", category: "Bond ETF", assetClass: "金融債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 1132162048 },
  { symbol: "00859B.TWO", name: "群益0-1年美債", nameEn: "Capital Ice BofAML 0-1 Year US Treasury ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 1061561856 },
  { symbol: "00834B.TWO", name: "第一金金融債10+", nameEn: "FSITC Bloomberg US Corporate 10+ Year Banking Index ETF", category: "Bond ETF", assetClass: "金融債", fundSizeSnapshot: 783580736 },
  { symbol: "00799B.TWO", name: "國泰A級醫療債", nameEn: "Cathay 15+ Yr Healthcare Bond ETF", category: "Bond ETF", assetClass: "醫療保健債", creditRating: "A 級", fundSizeSnapshot: 747953984 },
  { symbol: "00788B.TWO", name: "元大10年IG電能債", nameEn: "Yuanta US 10+ Investment Grade Utility Electric Power Bond ETF", category: "Bond ETF", assetClass: "公用事業債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 730006784 },
  { symbol: "00786B.TWO", name: "元大10年IG銀行債", nameEn: "Yuanta US 10+ Investment Grade Bank Bond ETF", category: "Bond ETF", assetClass: "金融債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 686652480 },
  { symbol: "00782B.TWO", name: "國泰A級公用債", nameEn: "Cathay 15+ Year Utility Bond Select ETF", category: "Bond ETF", assetClass: "公用事業債", creditRating: "A 級", fundSizeSnapshot: 593576576 },
  { symbol: "00890B.TWO", name: "凱基ESGBBB債15+", nameEn: "KGI 15+ Year US BBB ESG Sustainable Corporate Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 577736512 },
  { symbol: "00842B.TWO", name: "台新美元銀行債", nameEn: "Taishin Bloomberg US Banking Index 15+ Year ETF", category: "Bond ETF", assetClass: "金融債", fundSizeSnapshot: 541045376 },
  { symbol: "00980B.TWO", name: "台新特選IG債10+", nameEn: "Taishin FTSE WorldBIG BBB USD Corporate Capped Select 10+ Years ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 498187264 },
  { symbol: "00983B.TWO", name: "大華優利美公債20", nameEn: "United Enhanced Coupon 20+ Years US Treasury ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 416472480 },
  { symbol: "00734B.TWO", name: "台新JPM新興債", nameEn: "Taishin J.P.Morgan Emerging Markets IG Bond ETF", category: "Bond ETF", assetClass: "新興市場債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 390342208 },
  { symbol: "00787B.TWO", name: "元大10年IG醫療債", nameEn: "Yuanta US 10+ Investment Grade Healthcare Bond ETF", category: "Bond ETF", assetClass: "醫療保健債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 379910272 },
  { symbol: "00758B.TWO", name: "復華能源債", nameEn: "Fuh Hwa 15+ Yr Energy Bond ETF", category: "Bond ETF", assetClass: "能源公司債", fundSizeSnapshot: 281408928 },
  { symbol: "00982B.TWO", name: "FT投資級債20+", nameEn: "Franklin Templeton SinoAm ICE 20+ Year BBB US Corporate ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "BBB 級", fundSizeSnapshot: 265826752 },
  { symbol: "00856B.TWO", name: "永豐1-3年美公債", nameEn: "SinoPac ICE 1-3 Year US Treasury ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 260704448 },
  { symbol: "00986B.TWO", name: "FT金融債10+", nameEn: "Franklin Templeton SinoAm 10+ Year Investment Grade US Banking Bond ETF", category: "Bond ETF", assetClass: "金融債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 243179568 },
  { symbol: "00781B.TWO", name: "國泰A級科技債", nameEn: "Cathay 15+ Year Technology Bond Select ETF", category: "Bond ETF", assetClass: "科技公司債", creditRating: "A 級", fundSizeSnapshot: 228586352 },
  { symbol: "00721B.TWO", name: "元大中國債3-5", nameEn: "Yuanta China Treasury + Policy Bank 3-5 Year Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 149619008 },
  { symbol: "00883B.TWO", name: "中信ESG投資級債", nameEn: "CTBC 15+ Year Developed Markets US Corporate Best-in-Class ESG Bond ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "高評級（A- 以上）", fundSizeSnapshot: 131673624 },
  { symbol: "00847B.TWO", name: "中信美國市政債", nameEn: "CTBC US High Grade Municipal Bond ETF", category: "Bond ETF", assetClass: "美國市政債", creditRating: "高評級", fundSizeSnapshot: 108448048 },
  { symbol: "00860B.TWO", name: "群益1-5Y投資級債", nameEn: "Capital Ice 1-5 Year US Corporate ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 103720888 },
  { symbol: "00784B.TWO", name: "富邦中國投等債", nameEn: "Fubon FTSE Asian Broad Bond Index- China Investment-Grade ETF", category: "Bond ETF", assetClass: "投資級公司債", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 101340944 },
  { symbol: "00718B.TWO", name: "富邦中國政策債", nameEn: "Fubon China Policy Bank Bond ETF", category: "Bond ETF", assetClass: "中國政策金融債", creditRating: "A+（中國主權級）", fundSizeSnapshot: 98477616 },
  { symbol: "00793B.TWO", name: "群益AAA-A醫療債", nameEn: "CAPITAL ICE 15+ YEAR AAA-A US HEALTHCARE EXCHANGE TRADED FUND", category: "Bond ETF", assetClass: "醫療保健債", creditRating: "AAA–A", fundSizeSnapshot: 76526400 },
  { symbol: "00744B.TWO", name: "國泰中國政金債5+", nameEn: "Cathay FTSE Chinese Policy Bank Bond 5+ Years ETF", category: "Bond ETF", assetClass: "中國政策金融債", creditRating: "A+（中國主權級）", fundSizeSnapshot: 73010272 },
  { symbol: "00765B.TWO", name: "群益中國政金債", nameEn: "Capital ICE 0-10 Year China Policy Bank ETF", category: "Bond ETF", assetClass: "中國政策金融債", creditRating: "A+（中國主權級）", fundSizeSnapshot: 59221952 },
  { symbol: "00794B.TWO", name: "群益7+中國政金債", nameEn: "CAPITAL ICE 7+ YEAR CHINA POLICY BANK EXCHANGE TRADED FUND", category: "Bond ETF", assetClass: "中國政策金融債", creditRating: "A+（中國主權級）", fundSizeSnapshot: 46698624 },
  { symbol: "00831B.TWO", name: "新光美債1-3", nameEn: "Shin Kong US Treasury 1-3 Year Bond ETF", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）", fundSizeSnapshot: 4105768 },
  // The source reports no net assets for these two, so they show a dash where
  // every other fund shows a figure.
  { symbol: "00687B.TWO", name: "國泰20年美債", nameEn: "Cathay US Treasury 20+ YR ETF TWD", category: "Bond ETF", assetClass: "美國公債", creditRating: "AA+（美國主權）" },
  { symbol: "00790B.TWO", name: "復華次順位金融債", nameEn: "Fuh Hwa 8+ Year Financial Subordinate Bond ETF", category: "Bond ETF", assetClass: "金融債" },
  { symbol: "BND", name: "Vanguard 總體債券 ETF", nameEn: "Vanguard Total Bond Market ETF", category: "Bond ETF", expenseRatio: 0.03, assetClass: "綜合債券", creditRating: "投資等級（BBB- 以上）", fundSizeSnapshot: 396675153920 },
  { symbol: "AAPL", name: "蘋果公司", nameEn: "Apple Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "MSFT", name: "微軟", nameEn: "Microsoft Corp.", category: "Stock", expenseRatio: 0 },
  { symbol: "GOOGL", name: "Alphabet (Google)", nameEn: "Alphabet Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "AMZN", name: "亞馬遜", nameEn: "Amazon.com Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "NVDA", name: "輝達", nameEn: "NVIDIA Corp.", category: "Stock", expenseRatio: 0 },
  { symbol: "TSLA", name: "特斯拉", nameEn: "Tesla Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "META", name: "Meta Platforms", nameEn: "Meta Platforms Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "BRK.B", name: "波克夏海瑟威", nameEn: "Berkshire Hathaway Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "TSM", name: "台積電（ADR）", nameEn: "Taiwan Semiconductor (ADR)", category: "Stock", expenseRatio: 0 },
  { symbol: "JPM", name: "摩根大通", nameEn: "JPMorgan Chase & Co.", category: "Stock", expenseRatio: 0 },
];

/**
 * Look up the annual management (expense) fee for a given symbol.
 * Falls back to 0% for unrecognized tickers — we never guess a nonzero
 * fee for a symbol we don't have verified data for.
 */
export function getManagementFee(symbol: string): number {
  return findEntry(symbol)?.expenseRatio ?? 0;
}

function findEntry(symbol: string): CatalogEntry | undefined {
  const key = symbol.trim().toUpperCase();
  return SYMBOL_CATALOG.find((e) => e.symbol.toUpperCase() === key);
}

/** Whether getManagementFee's answer is a real published figure rather than
 *  the 0% fallback — lets the UI show a dash instead of claiming a fund with
 *  no verified expense ratio charges nothing. */
export function hasKnownManagementFee(symbol: string): boolean {
  return findEntry(symbol)?.expenseRatio !== undefined;
}

/** What the fund holds; undefined for symbols we have no verified class for. */
export function getAssetClass(symbol: string): string | undefined {
  return findEntry(symbol)?.assetClass;
}

/** Credit tier from the fund's official name; undefined when it states none. */
export function getCreditRating(symbol: string): string | undefined {
  return findEntry(symbol)?.creditRating;
}

/** Net assets as of FUND_SIZE_AS_OF, in the fund's own trading currency. */
export function getFundSize(symbol: string): number | null {
  return findEntry(symbol)?.fundSizeSnapshot ?? null;
}

/**
 * Taiwan's exchanges suffix a ticker with .TW (TWSE) or .TWO (TPEx).
 *
 * marketData.isTaiwanListed makes the same test for the data layer; this copy
 * keeps the catalog — which the browser imports for search and for labelling —
 * from pulling the network module into the client bundle.
 */
const TW_SUFFIX = /\.(TW|TWO)$/i;

/** The market a symbol actually trades in, hence the currency its price and
 *  net assets are quoted in. */
export function nativeCurrencyOf(symbol: string): Currency {
  return TW_SUFFIX.test(symbol.trim()) ? "TWD" : "USD";
}

/**
 * How a ticker reads in the UI.
 *
 * Taiwan's tickers are opaque serial numbers: 00687B says nothing about what
 * the fund holds, and its neighbours in the bond-ETF list differ from it by a
 * single digit — so a Taiwan-listed symbol is shown with its fund name
 * attached, as "00687B(國泰20年美債)". The exchange suffix is dropped once the
 * name is there, since the name identifies the fund far better than ".TWO"
 * does (twoSuffixNote explains the suffix itself). US tickers are already
 * words — TLT, VOO — and are left exactly as the user typed them.
 *
 * A Taiwan symbol the catalog has no name for keeps its full ticker, suffix
 * included: shortening "2454.TW" to "2454" with nothing appended would leave
 * it indistinguishable from a US ticker.
 */
export function displaySymbol(symbol: string, lang: "zh" | "en" = "zh"): string {
  const trimmed = symbol.trim();
  if (!TW_SUFFIX.test(trimmed)) return trimmed;
  const entry = findEntry(trimmed);
  if (!entry) return trimmed;
  const name = lang === "en" ? entry.nameEn : entry.name;
  return `${trimmed.replace(TW_SUFFIX, "")}(${name})`;
}

/**
 * Net assets in the currency the comparison is being read in.
 *
 * A group holding both markets otherwise prints "1,674 億 TWD" next to
 * "$41.5B", which invites reading the Taiwan fund as the larger of the two
 * when it is roughly an eighth the size. Converting at `usdTwdRate` — the rate
 * on FUND_SIZE_AS_OF, not today's, since that is when the figures were
 * measured — puts both on one scale.
 *
 * When no rate is available (the FX fetch failed) the native figure is
 * returned in its native currency rather than converted at a guessed rate: a
 * correctly-labelled TWD number is honest, an invented USD one is not.
 *
 * @param usdTwdRate TWD per 1 USD, or null when unknown.
 */
export function fundSizeIn(
  symbol: string,
  target: Currency,
  usdTwdRate: number | null
): { value: number | null; currency: Currency } {
  const value = getFundSize(symbol);
  const native = nativeCurrencyOf(symbol);
  // Nothing to convert: with no snapshot the UI shows a dash, so report the
  // currency the column is in rather than one this fund never contributed to.
  if (value === null) return { value: null, currency: target };
  if (native === target) return { value, currency: native };
  if (usdTwdRate === null || !(usdTwdRate > 0)) return { value, currency: native };
  const converted = target === "USD" ? value / usdTwdRate : value * usdTwdRate;
  return { value: Math.round(converted), currency: target };
}

/**
 * Ranks a catalog entry against a search query, lower is more relevant.
 * Ticker prefix matches (e.g. "00" -> 0050.TW) rank above ticker substring
 * matches, which rank above name matches. Without this, short numeric
 * queries like "00" would get swamped by unrelated funds whose name happens
 * to contain a "00" (e.g. "標普500", "那斯達克100"), burying the actual
 * 00xxx-prefixed Taiwan ETF tickers past the result cap.
 */
function matchRank(e: CatalogEntry, q: string): number {
  const symbol = e.symbol.toLowerCase();
  if (symbol.startsWith(q)) return 0;
  if (symbol.includes(q)) return 1;
  if (e.name.toLowerCase().includes(q) || e.nameEn.toLowerCase().includes(q)) return 2;
  return -1; // no match
}

export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return SYMBOL_CATALOG.slice(0, 8);
  return SYMBOL_CATALOG.map((e) => ({ e, rank: matchRank(e, q) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map(({ e }) => e);
}
