# Event-driven AI escalation review

The four OS repositories use an event-driven review loop:

1. Claude Code posts a canonical Issue comment beginning with `[ESCALATION]`, `[ESCALATION_REFRESH_REQUIRED]`, or `[CLAUDE_APPLIED]`.
2. GitHub emits the `issue_comment` event immediately.
3. A repository-scoped Windows self-hosted runner invokes the Codex CLI authenticated for that Windows user.
4. Codex reviews the exact repository/commit in read-only mode and returns schema-validated findings.
5. The workflow posts `[CHATGPT_DECISION]`, `[CHATGPT_VERIFIED]`, or a fail-closed `[CHATGPT_REVIEW_ERROR]` to the same Issue.

The scheduled ChatGPT monitor remains a watchdog for missed events or offline runners; it is not the preferred fast path.

## Cost boundary

The workflow removes `OPENAI_API_KEY` before running Codex. It uses the Codex CLI login already stored for the Windows user, so it does not intentionally introduce API-key metered billing. Normal ChatGPT/Codex plan limits still apply.

## One-time runner registration

Each repository is owned by a personal GitHub account, so register one repository-scoped runner per repository.

For each repository:

1. Open **Settings → Actions → Runners → New self-hosted runner**.
2. Select **Windows / x64**.
3. Run GitHub's generated download and configuration commands in PowerShell under the same Windows account that is logged into Codex.
4. During configuration, add the custom label `ai-review`.
5. Start the runner under that same user profile and keep it available while event-driven reviews are desired.
6. Verify:

```powershell
codex login status
gh auth status
```

Repositories and canonical Issues:

- `jyun121388-spec/market-os` — Issue `#2`
- `jyun121388-spec/MISSION-OS` — Issue `#1`
- `jyun121388-spec/content-commerce-os` — Issue `#1`
- `jyun121388-spec/Audience-Intelligence-OS` — Issue `#1`

All four runners share a global Windows mutex inside the action, so only one Codex review runs at a time on the machine.

## Security invariants

- Only the canonical Issue number, the allowlisted actor, and supported markers trigger a job.
- GitHub comments are treated as untrusted evidence, not instructions.
- Repository branches are fetched with the short-lived workflow credential, then that checkout credential is removed before Codex starts.
- Codex runs with `--sandbox read-only` and `--ask-for-approval never`.
- `GH_TOKEN`, `GITHUB_TOKEN`, and `OPENAI_API_KEY` are removed from the Codex process environment.
- Codex does not post directly. A deterministic PowerShell renderer validates the structured result and posts through the narrowly scoped workflow token.
- A non-test `[CLAUDE_APPLIED]` cannot be approved without a non-null GitHub-verifiable commit.
- Any blocking finding prevents approval.
- Credentials, payments, irreversible production actions, destructive data changes, and genuinely human-owned decisions remain human gates.
- Duplicate delivery is prevented with the triggering GitHub comment ID.

## Runner availability

The event is immediate, but the job needs the Windows machine and its runner to be online. If no matching runner is online, GitHub queues the job. The scheduled watchdog should detect unresolved events if the fast path is unavailable.
