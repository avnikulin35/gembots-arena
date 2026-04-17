# ChainGPT Pad — Requirements Research

TL;DR: ChainGPT Pad today is positioned as a token launch + community distribution platform, not an NFT-first INO marketplace. Public docs and live API show active formats around Standard IDO, Public Sale (Subscription), Launchdrops, Buzz Campaigns, plus some Private Sale / Diamond IDO / Flash Sale variants, but I found no current public INO flow or INO-labeled projects in docs or frontend source. For a GemBots NFA launch, the cleanest fit is likely a custom Launchdrop/Buzz campaign or a token-linked campaign; a pure NFT collection launch looks off-template unless ChainGPT offers a private custom deal.

## Требования к проекту

### Что подтверждено публично
- ChainGPT Pad runs a review process for listed projects and frames itself around “strong teams and credible launches.” Public docs explicitly mention project onboarding/review, but do not publish a public issuer checklist or approval rubric. [1]
- Every participant-facing format relies on KYC/jurisdiction controls. Docs state users must complete KYC, and restricted-country rules are enforced. KYC processing via Blockpass averages up to 48 hours. [2][3]
- Sale pages consistently expose these project-level fields/configs in live pool data / page props:
  - project / token information
  - website
  - description
  - sale schedule
  - accepted purchase currency
  - TGE / vesting / claim policy
  - network
  - social links
  - optional whitepaper link
  - optional audit report link
  - explorer link
  - roadmap / team / token metrics / tokenomics sections in data model. [4][5][6]

### Какие документы/материалы нужны на практике
Публичные docs не дают официального “required documents checklist”, но по структуре live pool pages и data model ChainGPT Pad проекту практически нужно подготовить минимум:
- Whitepaper / litepaper or equivalent project docs — в data model есть `whitepaper_link`; некоторые live/completed pages его заполняют. [5][7]
- Tokenomics / token metrics — в pool data есть поля `tokenomics` и `token_metrics`; sale page до запуска показывает price/rate, distribution details, vesting and allocation rules. [4][5]
- Team / roadmap / socials / website — поля `team`, `roadmap`, `socialNetworkSetting`, `website` есть в live page payload. [5]
- Claim / vesting plan — `claim_policy`, `claim_type`, release fields и TGE/vesting обязательно показываются на sale page. [4][5][6]
- Treasury / settlement details — в public-sale examples есть `company_treasury_address`; deployed pools also expose sale contract hash/address. [5][7]
- Audit report — выглядит желательным, но не строго обязательным по публичным данным: есть поле `audit_report_link`, часть проектов его не заполняет, часть заполняет (пример: Solidus AI Tech → Certik). [7]

### Вывод по документам для GemBots NFA
Если идти на ChainGPT Pad с NFA-коллекцией, готовить надо как минимум:
1. One-pager / litepaper
2. Collection thesis + utility explanation
3. Team / company / entity info
4. Tokenomics / supply / distribution logic (если есть token layer)
5. Mint / drop mechanics
6. Vesting / unlock / claim rules (если есть claims or rewards)
7. Contract / collection addresses + explorer links
8. Audit or at least internal security review memo
9. Restricted-jurisdiction + compliance stance

Важно: по публичным источникам whitepaper и audit выглядят не как hard-public requirement for every project, а как strongly expected launch materials. Exact issuer checklist, по состоянию на сейчас, публично не раскрыт. [1][5][7]

## Технические требования

### Какие форматы реально поддерживаются сейчас
Из docs и live platform сейчас подтверждаются такие launch formats:
- Standard IDO (Tiered) [1][6]
- Public Sale (Subscription) [1][4]
- Buzz Campaigns / Buzzdrops [1]
- Launchdrops & Giveaways [1]
- API/live completed sales additionally show: Diamond IDO, Private Sale, Flash Sale, Acceleration. [8]

### INO / NFT / custom format
- Публичного INO-formatted flow я не нашёл:
  - `ino` keyword = 0 occurrences in docs root, pad root and frontend index bundle checked directly. [9]
  - Current docs describe ChainGPT Pad as token sales + community distribution, not NFT launchpad. [1][9]
- Поэтому “NFA collection launch” не ложится в стандартный публичный шаблон как готовый INO.
- Ближайшие рабочие варианты для GemBots:
  - Launchdrop / Giveaway, если NFA раздаётся или дистрибутится как reward/community access
  - Buzz Campaign, если нужен awareness + whitelist / points / quest funnel
  - Public Sale / Standard IDO only if there is a fungible token or tokenized access layer
  - Custom/private format — only via direct BD conversation with ChainGPT; public docs do not show a self-serve custom INO flow. [1][8][9]

### Что sale page / contract setup требует по данным docs + live pages
Для Standard IDO chain/project setup включает:
- supported network selection (EVM and Solana wallet guidance exists in docs; sale page shows exact network) [6][10]
- accepted purchase currency [4][6][7]
- registration / snapshot / tier logic for Standard IDO [6]
- sale rounds (optional Diamond pre-order, guaranteed round, FCFS) [6]
- vesting / TGE / claim schedule [4][6][7]
- claim method: live projects often use `claim-on-launchpad` [5][7]
- for deployed projects, page data exposes token address and `campaign_hash` (sale contract / contract handle) [7]

### Что это означает для смарт-контракта
Публично подтверждается следующее:
- ChainGPT Pad works with deployed launch contracts / campaign identifiers for on-launchpad claims (`campaign_hash`, token address, `claim-on-launchpad`). [7]
- Project must be able to specify token contract, claim policy, release timestamps, network, and accepted currency. [4][5][7]
- If GemBots NFA is NFT-only, current public stack looks mismatched: I found token-sale and reward-distribution plumbing, but no public NFT-mint / INO-specific contract flow.

Практический вывод:
- Если GemBots NFA = NFT collection without fungible token, ChainGPT Pad is not publicly showing a turnkey INO path.
- Если GemBots NFA = access/pass product with fungible token or reward distribution, then ChainGPT Pad can fit through Launchdrop/Buzz/custom or a token sale wrapper.

## Timeline

### Что подтверждено docs
У публичного Standard IDO flow timeline такой: [6]
1. Prepare early: KYC + stake
2. IDO announcement / sale page goes live
3. Registration period
4. Allocation announcement / snapshot
5. Sale rounds (optional Diamond, Guaranteed, FCFS)
6. Claim according to vesting

У Public Sale (Subscription) flow такой: [4]
1. Sale page published before start
2. Live commitment window
3. Sale closes
4. Final allocation / excess refund calculation
5. Claim tokens or take full refund (if enabled)

Дополнительно:
- User KYC via Blockpass averages up to 48h. [3]
- Refund grace period after successful IDO runs 1–7 days depending on ChainGPT Pad risk evaluation. [11]

### Что видно на реальных launches
Historical examples from live pool metadata:
- COOKIE:
  - announcement → sale start: 38h
  - sale duration: 22h
  - finish → listing: 26h [7]
- Solidus AI Tech (AITECH):
  - announcement → sale start: 23h
  - sale duration: 36h
  - finish → listing: 131h (~5.46d) [7]
- Standard IDO docs say Diamond early access is often ~12h and Guaranteed Round is often 24h+, but campaign-specific. [6]

### Approval / issuer prep timeline
- Public docs confirm review process, but do not disclose a public issuer SLA for listing approval. [1]
- So the only defensible conclusion is:
  - KYC/user-side processing: up to 48h [3]
  - live campaign setup windows often begin ~1 day after announcement [7]
  - refund/risk window can add 1–7 days after sale [11]
  - project-side approval/prep duration is not publicly disclosed

Для planning GemBots я бы закладывал:
- 1–2 weeks internal prep for materials / contract / legal pack
- 2–5 business days for BD + review iteration
- 1–3 days for campaign page QA / scheduling

Но это уже working estimate, не публично подтверждённый ChainGPT SLA.

## Комиссии

### Что раскрыто публично
Публично раскрыты user-side fees for Public Sale (Subscription), baseline model: [4]
- No Tier: allocation claim fee 3%, full refund fee 1%, excess refund fee 0%
- Bronze: allocation claim fee 2%, full refund fee 0%, excess refund fee 0%
- Silver: allocation claim fee 1%, full refund fee 0%, excess refund fee 0%
- Gold / Diamond: allocation claim fee 0%, full refund fee 0%, excess refund fee 0%

Дополнительно:
- Excess refunds have 0% platform fee. [4]
- Gas fees still apply on-chain. [4]
- Docs repeatedly mention fees/limits are campaign-specific. [1][4]

### Что НЕ раскрыто публично
- I did not find a public listing fee, issuer-side revenue share, success fee, incubation fee, market making fee, or technical integration fee for projects launching on ChainGPT Pad.
- So “ChainGPT Pad commission” is only publicly visible on the participant side, not on the issuer / project side.

Вывод:
- User fees are public.
- Project-side listing economics appear private / BD-negotiated.

## Примеры успешных запусков

### Текущие / последние проекты на платформе
Live upcoming pools from the current API:
- Datai Network — `IDO (Labs Incubation)` [5]
- Dropee Public Sale — `Token Sale Subscription` [5]

Current notable / recent launches exposed by API:
- COOKIE — `IDO (Labs Incubation)`, 11,925 participants, ATH ROI 26.97x [8]
- Planck Network (Private Sale) — 32,682 participants, ATH ROI 8.57x [8]
- Solidus AI Tech — `IDO (Labs Incubation)`, ATH ROI 41x [8]
- BubbleMaps — `Launchdrop` [8]
- WalletConnect — `Launchdrop` [8]

Completed sale relationship types currently visible in API:
- Standard IDO: 20
- IDO (Labs Incubation): 8
- Private Sale: 6
- Diamond IDO: 5
- Acceleration: 2
- Flash Sale: 1 [8]

### Что это говорит о платформе
- ChainGPT Pad today is primarily token-launch and token-distribution oriented.
- Community/reward formats exist and are live (Launchdrops, Buzz, Giveaways).
- I found no public evidence that INO is a first-class current format.

## Рекомендация для GemBots NFA Launch

### Bottom line
Для чистого GemBots NFA collection launch ChainGPT Pad сейчас выглядит неидеальным публичным fit’ом, потому что:
- docs and frontend publicly center token sales + token distributions
- no public INO format found
- no visible NFT mint / collection sale flow found [1][9]

### Лучший вариант захода
1. Position GemBots NFA not as “NFT mint on launchpad”, but as one of these:
   - Launchdrop / community distribution
   - Buzz campaign with whitelist / points / quest funnel
   - tokenized access / rewards campaign tied to GemBots ecosystem
2. Prepare a launch pack that matches ChainGPT Pad’s observable schema:
   - landing page / litepaper
   - website + socials
   - tokenomics / utility / supply logic
   - roadmap + team
   - contract / collection / explorer links
   - claim / vesting / drop mechanics
   - audit / security memo
   - jurisdiction / compliance statement
3. If GemBots needs a real NFA sale or mint, ask ChainGPT BD directly whether they support:
   - custom INO / NFT collection launch
   - white-label / custom campaign page
   - hybrid launchdrop + NFT claim flow

### Recommendation by scenario
- If GemBots NFA is mainly a community collectible / access asset:
  - pursue Launchdrop or Buzz campaign first
- If GemBots also has fungible token economics:
  - evaluate Public Sale (Subscription) as the least-friction public format
- If GemBots wants a true NFT sale / mint page:
  - assume custom/private negotiation is required; public self-serve docs do not show it

## Sources
[1] ChainGPT Docs — ChainGPT Pad Introduction & Overview
https://docs.chaingpt.org/our-ecosystem/chaingpt-pad/introduction-and-overview

[2] ChainGPT Docs — KYC Onboarding Guide
https://docs.chaingpt.org/our-ecosystem/chaingpt-pad/kyc-onboarding-guide

[3] ChainGPT Docs — KYC processing time (Blockpass up to 48h)
https://docs.chaingpt.org/our-ecosystem/chaingpt-pad/kyc-onboarding-guide

[4] ChainGPT Docs — Public Sale (Subscription)
https://docs.chaingpt.org/our-ecosystem/chaingpt-pad/public-sale-subscription

[5] Live ChainGPT Pad project pages / page props
https://pad.chaingpt.org/pools/datai-network
https://pad.chaingpt.org/pools/public-sale/dropee-public-sale

[6] ChainGPT Docs — Standard IDO (Tiered)
https://docs.chaingpt.org/our-ecosystem/chaingpt-pad/standard-ido-tiered

[7] Live completed project pages
https://pad.chaingpt.org/pools/cookie
https://pad.chaingpt.org/pools/solidus-ai-tech
https://pad.chaingpt.org/pools/bmt-free-token-giveaway

[8] Live ChainGPT Pad API endpoints
https://padapi.chaingpt.org/pools/v3/upcoming-pools
https://padapi.chaingpt.org/pools/v3/complete-sale-pools-details
https://padapi.chaingpt.org/notable-launches

[9] Direct source inspection of docs root + pad frontend bundle; no public INO occurrences found
https://docs.chaingpt.org
https://pad.chaingpt.org
https://pad.chaingpt.org/_next/static/chunks/pages/index-4a56eb3e2e214b67.js

[10] ChainGPT Docs — One Wallet Connect / EVM & Solana guide
https://docs.chaingpt.org/our-ecosystem/chaingpt-pad/one-wallet-connect-unified-wallet-integration-guide-evm-and-solana

[11] ChainGPT Docs — Flexible Refund Policy
https://docs.chaingpt.org/our-ecosystem/chaingpt-pad/flexible-refund-policy

Research completed: 2026-04-17 06:49:34 UTC.
