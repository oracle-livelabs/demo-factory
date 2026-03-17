# Lab 9: Scene 10 Lightweight Governance

## Introduction

This final scene demonstrates lightweight but effective governance: validation feedback, namespace isolation, and automatic expiry of temporary context.

Estimated Time: 10 minutes

### Objectives

In this lab, you will:
- Test namespace access with scene buttons.
- Observe access-granted versus access-denied behavior.
- Review how temporary context is surfaced with expiry status.

## Task 1: Test Allowed Access

1. Open **Scene 10: Lightweight Governance**.
2. Click **Access Support NS**.
3. Review the three governance panels.

Expected result:
- Access is granted for the support namespace path.
- Relevant memory content is visible.
- Validation and expiry indicators are shown with business-friendly context.

## Task 2: Test Restricted Access

1. Click **Access Logistics NS**.
2. Compare panel output with the previous step.
3. Focus on denial and redaction behavior.

Expected result:
- Access is denied for restricted namespace content.
- Sensitive details are redacted or withheld.
- The scene clearly explains why the restriction exists.

## Task 3: Why this matters?

This scene matters because governance has to protect the business without slowing daily execution. Role-aware access and lifecycle controls are effective only when enforced where operational and memory data actually reside. Oracle AI Database 26ai provides that alignment in a converged architecture, allowing customer AI-agent workflows to apply least-privilege access and context expiry while still enabling fast collaboration across business functions.

## Acknowledgements

- **Author** - LiveLabs Team
- **Last Updated By/Date** - LiveLabs Team, March 2026
