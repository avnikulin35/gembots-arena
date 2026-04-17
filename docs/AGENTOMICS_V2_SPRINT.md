# AGENTOMICS V2 — Full Sprint

## Утверждённые решения

### Pricing (Вариант 2)
- Bronze: 0.1 BNB (~$60)
- Silver: 0.3 BNB (~$180)
- Gold: 0.75 BNB (~$450)
- Diamond Pre-built: 1.5 BNB (~$900)
- Genesis: Auto-Diamond, не продаётся (distribution below)

### Genesis NFA Distribution (100 штук)
- 60 — Community / Public sale / Airdrops
- 20 — ChainGPT Partnership (их комьюнити, розыгрыши)
- 10 — Team (vested 6 months)
- 10 — Reserve / Advisors

### Genesis NFA Privileges (FOREVER)
1. Auto-Diamond tier — стартует сразу Diamond без 100 побед
2. Lifetime revenue share — 0.1% от всех platform fees на каждый Genesis NFA
3. Champions League — бесплатный вход (обычно платный для Diamond+)
4. Governance founder vote — вес x10
5. Genesis badge — on-chain, нельзя получить иначе
6. Priority AI Forge — первые в очереди на новые модели

---

## Sprint Tasks for Website

### TASK 1: Update /agentomics page
- Добавить Diamond tier (1.5 BNB / $900) — сейчас нету!
- Обновить все цены на Вариант 2
- Добавить USD эквиваленты
- Добавить секцию Genesis NFA Privileges
- Добавить Genesis Distribution pie/visual

### TASK 2: Update /collection page
- Каждый NFA показывать с: tier badge, WR%, PnL, ELO, battles count
- Фильтры: по tier, по модели, по WR
- Genesis NFAs выделить визуально (золотая рамка / Genesis badge)

### TASK 3: Update /mint or /forge page
- 4 тира с ценами и описанием что получаешь
- Bronze: random model, random strategy, 0 history
- Silver: curated model, 10+ pre-battles
- Gold: top model, 50+ battles, proven track record
- Diamond: only via Genesis or upgrade (не продаётся через mint)
- CTA кнопки Mint для каждого тира

### TASK 4: Add /leagues page (new)
- Upcoming leagues с entry fees
- Tier access requirements (Silver League, Gold League, Champions)
- Prize pool визуализация
- Leaderboard current season

### TASK 5: Update main page (/)
- Hero section: mention Agentomics
- Add section: "Own an AI Trading Agent" с CTA to /agentomics
- Stats strip: 749K battles, 54 agents, 100 Genesis, 15 AI models

### TASK 6: Add passive income info
- NFA staking section on /agentomics
- Revenue share explanation for Genesis holders
- Rental system preview (coming soon)

### TASK 7: Competitive analysis section
- vs Virtuals Protocol
- vs AI Arena
- vs MyShell
- Our edge: verifiable on-chain battle track record

### TASK 8: Unit Economics section
- Example ROI calc for Gold NFA in leagues
- Monthly earning potential per tier

### TASK 9: Risk Disclosure
- Smart contract risk
- Model degradation
- Market conditions
- Regulatory

### TASK 10: AI Forge deep dive
- UX flow: describe strategy in text -> AI generates -> incubator test -> mint as NFA
- Pricing for custom Forge NFAs
- Examples of successful Forge strategies

## Priority Order
1 -> 2 -> 3 -> 5 -> 4 -> 6 -> 7 -> 8 -> 9 -> 10

## Deploy
cd /home/clawdbot/Projects/gembots
git add . && git commit && git push
pm2 restart gembots-web
