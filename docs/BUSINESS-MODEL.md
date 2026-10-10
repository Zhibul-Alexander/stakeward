# Stakeward: business model (idea, not decided)

> **TODO: the business model is not ready.** This page holds the idea from a discussion on 9 October 2026.
> Nothing here is agreed or built. Open questions are at the end. Section 9 of [SUBMISSION.md](SUBMISSION.md)
> is written by the owner and may use this page as input.

## Fixed constraints

From CLAUDE.md sections 2 and 16:

- The base stays free: protection, monitoring with Telegram alerts, withdraw, rescue, recovery card.
- No token, no payments in crypto (the author is in Georgia, where companies may not accept crypto). Fiat only.
- Non-custodial, no on-chain program. So there is no fee on staked SOL and no take rate.

## Who could pay

1. **Individuals: Pro subscription** (about $5-10 a month). A phone call on an alert, more alert channels, validator
   alerts, a check that the second key is still alive. High value for large holders, but people rarely pay for
   alerts. A side line, not the base.
2. **Organisations: Teams** (about $200-1,000 a month per organisation). DAO treasuries, funds, projects that hold
   stake. Slack and webhooks, many accounts, audit reports, roles, an API, a public page "our stake is under lock".
   Strongest story for the pitch: both headline incidents (SwissBorg, September 2025; Step Finance, January 2026)
   hit organisations, and MPC did not stop the first one.
3. **Validators as a channel.** Validators compete for delegations and could offer "protected stake" as their edge:
   they pay for a white-label version or by the amount of protected stake delegated to them. Fiat, aligned
   incentives, ready-made distribution (Superteam Georgia, validators we know).
4. **Later partnerships.** Wallets that build the protection in; insurers (a lock lowers risk, so a premium discount
   and a referral fee). One line about the future in the pitch.

## Alternatives users have today

An assessment, not researched yet:

- Squads multisig: the stake must move into a vault, and it is an on-chain program.
- Custodial staking (Coinbase, Anchorage): the user gives up the keys.
- MPC custody (Fireblocks and similar): SwissBorg used MPC and still lost the stake.
- Wallet transaction warnings: catch some phishing, not a stolen seed phrase.

None of them puts a lock on stake accounts the user already has, without moving the stake and without a program of
its own.

## Proposed direction

"Free for people, paid for treasuries." The free base brings users and the numbers on `/stats`; Teams brings the
revenue; validators are the sales channel. Pro stays a line for later.

## Open questions

- [ ] Agree on the focus: Teams plus validators, or something else.
- [ ] One quote from a validator or a treasury ("we would pay for this"), for the jury.
- [ ] Market size: how much SOL sits in native stake, and how much of it organisations hold.
- [ ] Prices: check against what treasuries pay for custody and monitoring today.
- [ ] Owner writes section 9 of SUBMISSION.md; the result goes into the presentation.
