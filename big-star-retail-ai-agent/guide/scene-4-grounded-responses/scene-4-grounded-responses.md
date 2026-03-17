# Lab 4: Scene 4 Grounded Responses

## Introduction

This scene compares an ungrounded answer with a grounded answer based on approved enterprise policy. You will see why grounded support responses are safer for the business.

Estimated Time: 10 minutes

### Objectives

In this lab, you will:
- Run the ungrounded response path.
- Run the grounded response path.
- Evaluate policy risk and trust impact.

## Task 1: Run Without Data Grounding

1. Open **Scene 4: Hallucination vs Enterprise Data**.
2. Click **Run Without Data**.
3. Read the response in the **Generic LLM** panel.

Expected result:
- The response sounds confident but may be incorrect.
- It can suggest a refund decision that conflicts with business policy.
- Risk: inconsistent treatment and financial leakage.

## Task 2: Run With Data Grounding

1. Click **Run With Data**.
2. Review the response in the **Grounded Agent** panel.
3. Check the cited policy references shown in the result.

Expected result:
- The answer is tied to specific policy context.
- Decision language is more precise and defensible.
- The response is easier for managers and auditors to trust.

## Task 3: Why this matters?

This scene matters because fluent answers are not enough when financial and policy decisions are involved. Organizations need responses that can be traced to approved sources, especially when customer impact is high. Oracle AI Database 26ai is well suited for this by combining structured data, text, and vector retrieval in one governed architecture, so customer AI-agent workflows can ground responses consistently, lower hallucination risk, and make decisions that are easier to defend in review.

## Acknowledgements

- **Author** - LiveLabs Team
- **Last Updated By/Date** - LiveLabs Team, March 2026
