#!/usr/bin/env bash
# M00 self-verification: confirms the Development Operating System scaffold is complete.
set -euo pipefail

required_files=(
  "CLAUDE.md"
  "AGENTS.md"
  "docs/PRODUCT_SPEC.md"
  "docs/ARCHITECTURE.md"
  "docs/ROADMAP.md"
  "docs/PROJECT_STATE.md"
  "docs/CURRENT_TASK.md"
  "docs/SESSION_HANDOFF.md"
  "docs/DECISIONS.md"
  "docs/DATA_POLICY.md"
  "docs/LEGAL_GUARDRAILS.md"
  "docs/AI_RESOURCE_POLICY.md"
  "docs/TEST_STRATEGY.md"
  "docs/REVIEW_DEBT.md"
  "docs/RELEASE_CHECKLIST.md"
  ".github/PULL_REQUEST_TEMPLATE.md"
)

missing=0
for f in "${required_files[@]}"; do
  if [[ ! -s "$f" ]]; then
    echo "MISSING or EMPTY: $f"
    missing=1
  fi
done

if [[ "$missing" -eq 0 ]]; then
  echo "M00 self-verification: PASS (${#required_files[@]} files present)"
else
  echo "M00 self-verification: FAIL"
  exit 1
fi
