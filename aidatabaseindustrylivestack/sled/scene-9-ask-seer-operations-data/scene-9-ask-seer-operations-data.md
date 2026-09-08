# Scene 9 Ask State and Local Government Data

## Introduction

**Jessica Chen** now tests the same **Colorado** operating decision through natural-language data access. **Ask State and Local Government Data** lets her compare a narrated answer, conversational follow-up, generated SQL, and authorized result rows while Oracle remains the governed execution authority.

The active VPD identity continues to apply. Changing answer mode does not broaden the user's database access.

Estimated Time: **10 minutes**

<video controls width="100%">
  <source src="https://c4u04.objectstorage.us-ashburn-1.oci.customer-oci.com/p/EcTjWk2IuZPZeNnD_fYMcgUhdNDIDA6rt9gaFj_WZMiL7VvxPBNMY60837hu5hga/n/c4u04/b/livelabsfiles/o/livestack/Videos/State-and-Local-Gov/State and Local Government_Scene9_with-CC.mp4">
  Your browser does not support the video tag.
</video>

### Objectives

In this scene, you will use natural-language data access to generate a narrated answer, ask a follow-up, inspect generated SQL, and run authorized SQL under the active **VPD** identity.

## Task 1: Use Narrate for the operating brief

Perform the following set of steps to use Narrate mode for an executive-ready operating brief:

1. Click **Ask State and Local Government Data** in the sidebar.
2. Confirm that Jessica Chen remains selected.
3. Click **Narrate**.
4. Ask: **Which benefits eligibility cases need review because resident need is high and response capacity is low?**
5. Review the business-readable findings and follow-up prompts.

    ![Narrated answer for the Colorado eligibility and capacity question](images/ask-public-service-data-narrate-mode.png)

Narrate gives **Jessica Chen** an executive-ready summary while the answer remains grounded in authorized Oracle data.

## Task 2: Use Chat for a follow-up

Perform the following set of steps to use Chat mode for a follow-up question while preserving the same operating context:

1. Without changing the operating topic, click **Chat**.
2. Ask: **Which constituent service requests are at risk of breaching service-level agreements this week?** Jessica's global VPD context keeps the returned operating rows scoped to Colorado.
3. Review the conversational answer and suggested follow-up.

    ![Chat follow-up about Colorado service-level risk](images/ask-public-service-data-chat-mode.png)

The follow-up keeps the same decision context while moving from cases needing review to near-term service-level risk.

## Task 3: Inspect generated SQL without executing it

Perform the following set of steps to inspect generated SQL before executing it:

1. Click **Clear**.
2. Click **Show SQL**.
3. Ask the original benefits eligibility question again.
4. Review the generated SQL.
5. Explain that Show SQL exposes the proposed read-only query path without returning result rows.

    ![Generated SQL for the governed eligibility and capacity question](images/ask-public-service-data-generated-sql.png)

The SQL view is the governance checkpoint: a data steward can inspect the query before execution.

## Task 4: Run authorized SQL and inspect rows

Perform the following set of steps to run authorized SQL and inspect the returned rows under **Jessica Chen**'s current **VPD** identity:

1. Click **Clear**.
2. Click **Run SQL**.
3. Ask the original question again.
4. Inspect the result rows without relying on a permanent row count or generated SQL string.

    ![Authorized Oracle result rows for the Colorado operating question](images/ask-public-service-data-run-sql-results.png)

**Ollama** drafts reasoning or query structure, while **Oracle AI Database** executes authorized, read-only SQL against governed semantic views. Returned rows remain constrained by **Jessica Chen**'s current **VPD** identity.

**Jessica Chen** now has a defensible answer path. **Scene 10** turns the evidence into a recommended action while preserving tool use and audit history.

*You can move to the next scene.*

## Credits & Build Notes

- **Author** - Oracle LiveLabs Team
- **Last Updated By/Date** - Oracle LiveLabs Team, 2026-07-03
