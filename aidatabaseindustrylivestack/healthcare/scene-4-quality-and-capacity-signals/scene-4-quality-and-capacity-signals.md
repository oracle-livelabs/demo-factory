# Scene 4 Quality and Capacity Signals

## Introduction

**Quality and Capacity Signals** helps operations, quality, and supply teams understand what healthcare signals are saying before the risk is obvious in request volume alone. The page connects operational language from bulletins, partner updates, logistics alerts, and quality notes to affected services and supplies quickly enough to act.

Semantic search is difficult to implement when signals, care-service catalogs, embeddings, search indexes, and access policies live in separate systems. Healthcare teams often have to move sensitive operational text into external search services, synchronize vector indexes, and then rebuild access control outside the database.

Oracle AI Database helps address these challenges by keeping vector search close to the governed healthcare data. In this LiveStack Demo, the page uses natural-language search over service and signal embeddings, shows match evidence, and keeps the operating feed tied to database access policies.

Estimated Time: **10 minutes**

<video controls width="100%">
  <source src="https://c4u04.objectstorage.us-ashburn-1.oci.customer-oci.com/p/EcTjWk2IuZPZeNnD_fYMcgUhdNDIDA6rt9gaFj_WZMiL7VvxPBNMY60837hu5hga/n/c4u04/b/livelabsfiles/o/livestack/Videos/Healthcare/Seer Health_Scene-3_with-CC_.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

### Objectives

In this scene, you will learn what healthcare decision the page supports, what evidence the user should inspect, and what action the team may take next.

## Task 1: Review the signal feed

Perform the following set of steps to see how quality, capacity, supply, and logistics signals are being summarized for healthcare operations teams.

1. Click **Quality & Capacity Signals** in the sidebar.
2. Review **Semantic Care Signal Search** at the top of the page.
3. Review the example query chips, including **oncology infusion slot capacity**, **biologics cold-chain excursion risk**, and **cell therapy cryogenic shipper availability**.
4. Review the **Signal Summary** cards.
5. Review the **Matched Quality & Capacity Signals** feed below the summary.

    ![Quality and Capacity Signals search workspace, signal summary, and matched signal feed highlighted](images/signal-feed-overview.png)

In the current demo dataset, the signal summary shows **5.0K** indexed signals, **474** elevated or critical signals, **cold-chain excursion risks** as the top concern, **Formulation Tracker** as the highest impact source, and **Check logistics impact** as the recommended next step.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

## Task 2: Run semantic care-service search

Perform the following set of steps to show how a healthcare user can search by operational intent, not only by exact service names or keywords.

1. Click the **oncology infusion slot capacity** example query chip, or enter that phrase in the search field.
2. Click **Search**.

    ![Semantic search results for oncology infusion slot capacity](images/semantic-care-service-results.png)

3. Review the matched services and supplies returned above the signal summary.
4. Focus on the top matches: **Infusion Center Slot Bundle - Continuity Lot 2**, **Infusion Center Slot Bundle - Continuity Lot 3**, and **Infusion Center Slot Bundle**.

**Note:** The search turns operational language into relevant services and supplies, even when the wording does not exactly match a catalog term.

In the current demo dataset, the search returns **8** matched services and supplies for `oncology infusion slot capacity`. The top result is **Infusion Center Slot Bundle - Continuity Lot 2** from **Regional Oncology Network**, in **Specialty Care**, with a visible similarity score of about **70%**.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

## Task 3: Interpret the signal cards

Perform the following set of steps to identify the affected services, severity, evidence, and possible next actions, such as checking logistics impact, opening related services, reviewing the care pathway graph, or routing a follow-up.

1. Scroll to **Matched Quality & Capacity Signals**.
2. Review the signal type, criticality, source, network impact, match score, related signals, affected services, and open follow-ups.
3. Use the action labels such as **View related services**, **Check logistics impact**, **Open care pathway graph**, and **Route compliance follow-up** to explain where the operator could go next.

    ![Matched Quality and Capacity Signal cards with evidence metrics and action labels highlighted](images/matched-signal-cards.png)

The business value is that teams can make the decision from connected, governed data. Oracle AI Database provides the shared foundation that keeps operational data, analytics, and AI workflows aligned. Additionally, operational text becomes searchable healthcare intelligence when users can find related signals by meaning while still seeing source, score, and operating context.

*You can move to the next scene.*

## Credits & Build Notes
- **Author** - Oracle LiveLabs Team
- **Last Updated By/Date** - Oracle LiveLabs Team, 2026-05-22
