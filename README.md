# GitPulse ⚡

> **A safety-first, formally verified Git recovery assistant.**  
> Diagnose Git accidents, get grounded recovery playbooks, and preview commands with automated safety safeguards.

[![Tests](https://img.shields.io/badge/tests-1093%20passed-brightgreen.svg)]()
[![Property Tests](https://img.shields.io/badge/properties-28%2F28%20verified-blue.svg)]()
[![Type Checked](https://img.shields.io/badge/typescript-strict-blue.svg)]()
[![Zero Leak](https://img.shields.io/badge/secrets-scanned%20clean-success.svg)]()

---

## 🌟 Overview

When Git commands go wrong—accidental hard resets, detached HEAD states, merge conflicts, or forced pushes—developers often panic and run unsafe commands found on forums, risking permanent data loss.

**GitPulse** is designed with a strict **safety-first philosophy**:
* **Zero Autonomous Execution**: GitPulse *never* runs commands directly on your system. You review and copy commands into your terminal yourself.
* **Automated Safeguards**: Every destructive command is automatically paired with prerequisite safety actions (backup branch creation, stash safety, non-destructive `--dry-run` previews).
* **Dual Operation Modes**:
  1. **Deterministic Fallback / Demo Mode**: Fully local, rule-based recovery engine running 100% in the browser with **zero backend or API key requirements**.
  2. **Amazon Bedrock AI Mode**: Enhanced contextual incident reasoning via AWS Bedrock, strictly bound by fallback safety rules if errors or invalid payloads occur.
* **Formally Verified**: Backed by **28 property-based tests** (powered by `fast-check`) validating mathematical safety invariants across 1,093 unit, component, and property tests.

---

## 🛡️ Safety Core & Invariants

GitPulse implements rigorous invariants verified across every recovery plan:
1. **No Risk Downgrading**: A destructive or caution command can never be mislabeled as safe.
2. **Mandatory Safeguard Windows**: Dangerous operations (e.g., `git reset --hard`, `git push --force`, `git clean -fdx`) must be preceded by explicit backup commands.
3. **No Safety Overclaims**: GitPulse never falsely claims an action is "completely risk-free" when residual risks remain.
4. **Clean Dry-Runs**: Destructive clean commands enforce a canonical dry-run (`git clean -n ...`) before execution.

---

## 🚀 Quick Start

### Prerequisites
* **Node.js** 20 LTS or later
* **npm** 10 or later

### Installation & Run

```bash
# 1. Clone the repository
git clone https://github.com/soumyadeepmagnusx/git-pulsez.git
cd git-pulsez

# 2. Install dependencies
npm install

# 3. Start local development server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🧪 Testing & Verification

GitPulse features a comprehensive test suite covering static security checks, component behavior, risk classification, and formal property tests:

```bash
# Run all 1,093 unit & property-based tests
npm test

# Type-check and build for production
npm run build

# Run linter
npm run lint
```

### Build & Secret Scanning
The build pipeline includes an automated secret scanner (`scripts/check-dist-secrets.mjs`):
```bash
npm run postbuild  # scans dist/ to guarantee no credentials or AWS keys leak
```

---

## 📐 Architecture & Kiro Specs

The project was developed following formal specification standards in `.kiro/specs/gitpulse-recovery-assistant/`:
* `requirements.md` — Formal capability and safety requirements.
* `design.md` — Architectural blueprint, contract definitions, and safety models.
* `tasks.md` — Step-by-step implementation milestones with full test coverage.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
