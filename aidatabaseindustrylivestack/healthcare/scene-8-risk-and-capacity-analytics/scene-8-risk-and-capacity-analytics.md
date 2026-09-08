# Scene 8 Risk and Capacity Analytics

## Introduction

**Risk and Capacity Analytics** helps healthcare teams decide which predictive signals should become operational action. The page brings together demand risk, care-site segments, service-value forecasting, semantic clusters, and capacity or supply risk so teams can plan follow-up before care operations are affected.

Healthcare teams struggle when the information needed for one decision lives in separate tools. That separation slows action, increases reconciliation work, and makes it harder to trust the result. Oracle AI Database helps address these challenges by keeping machine learning close to governed healthcare data. Oracle Machine Learning models and SQL analytics can run from the same connected data foundation that powers the rest of the LiveStack Demo.

Estimated Time: **12 minutes**

<video controls width="100%">
  <source src="https://c4u04.objectstorage.us-ashburn-1.oci.customer-oci.com/p/EcTjWk2IuZPZeNnD_fYMcgUhdNDIDA6rt9gaFj_WZMiL7VvxPBNMY60837hu5hga/n/c4u04/b/livelabsfiles/o/livestack/Videos/Healthcare/Seer Health_Scene-7_with-CC_.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

### Objectives

In this scene, you will learn what healthcare decision the page supports, what evidence the user should inspect, and what action the team may take next.

## Task 1: Inspect Service Demand Risk

Perform the following set of steps to identify care services where predicted demand may require capacity planning, supply review, quality response, or operational follow-up.

1. Click **Risk and Capacity Analytics** in the sidebar.
2. Review the four KPI cards at the top of the page: **Services with Demand Risk**, **Care Sites Segmented**, **Service-Value Fit R²**, and **Active ML Models**.
3. Review the five analytics tabs: **Service Demand Risk**, **Care Site Segments**, **Service Value Forecast**, **Service Signal Clusters**, and **Capacity and Supply**.
4. Confirm that **Service Demand Risk** is selected.
5. Review the scoring window, **Refresh** control, bar chart, and prediction table.

    ![Service Demand Risk predictions with active tab, chart, and prediction table highlighted](images/service-demand-risk.png)

In the current demo dataset, the page shows **105** services with demand risk, **2.0K** care sites segmented, a **2.6%** service-value fit R-squared, and **4** active ML models. Use this opening view to set the scene: this page is not a separate data science notebook. It is a business-facing analytics surface backed by in-database analytics.

In the prediction table, focus on rows such as:

- **Quality Review Variation Dossier Review**
- **mRNA LNP Clinical Batch - Continuity Lot 2**
- **qPCR Respiratory Panel - Continuity Lot 2**
- **Process Deviation Triage Service - Continuity Lot 2**.
- **Quality Review Variation Dossier Review** shows about **176** predicted service requests, about **$1.31M** in value exposure, and **99%** confidence.
- **mRNA LNP Clinical Batch - Continuity Lot 2** shows about **195** predicted service requests, about **$3.61M** in value exposure, and **99%** confidence.

These are the data points to emphasize: the table turns model output into operational questions about capacity, supply, and quality response.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

## Task 2: Review Care Site Segments

Perform the following set of steps to turn model output into groups of care sites that may need follow-up, service coordination, capacity planning, or targeted support.

1. Click **Care Site Segments**.
2. Review the **Segment Distribution** donut chart.
3. Review the **Follow-up Risk Distribution** bar chart.
4. Review **Segment Summary** and **Top care sites by service-pattern score**.
5. Optionally click a segment such as **Potential (60)**, **Lost (58)**, **Promising (44)**, **Loyal (26)**, or **New Site (12)** to focus the site list.

    ![Care Site Segments tab with segment distribution and top care sites highlighted](images/care-site-segments.png)

In the current demo dataset, the segment distribution includes **Potential (60)**, **Lost (58)**, **Promising (44)**, **Loyal (26)**, and **New Site (12)**.

The segment summary also shows service value and pattern score for each group. This is useful for care operations teams because segmentation becomes operational: the team can move from a model result to the care sites that need follow-up, service coordination, or capacity planning.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

## Task 3: Interpret Service Value Forecast

Perform the following set of steps to understand both the expected service-value trend and how much confidence planners should place in it.

1. Click **Service Value Forecast**.
2. Review the forecast horizon selector and **Refresh** control.
3. Review the model quality cards: **R² (fit quality)**, **Daily Slope**, **Mean Daily Service Value**, and **Observations**.
4. Review the service value trend chart and forecast band.

    ![Service Value Forecast tab with model quality cards and forecast chart highlighted](images/service-value-forecast.png)

In the current demo dataset, the 7-day forecast view shows **2.6%** R², a daily slope of about **-$402.84/day**, mean daily service value of about **$67,468.00**, and **30 days** of observations. A low model-quality score tells planners to treat the forecast as directional, not certain. This builds trust because the demo does not hide weak predictions.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

## Task 4: Explore Service Signal Clusters

Perform the following set of steps to see how related services and supplies group together by meaning, which can support comparison, planning, and signal review.

1. Click **Service Signal Clusters**.
2. Review the **K =** controls.
3. Review the cluster count, services clustered, embedding dimensions, and distance metric.
4. Review a cluster card and its related services.

    ![Service Signal Clusters tab with vector K-Means controls and cluster cards highlighted](images/service-signal-clusters.png)

In the current demo dataset, the vector clustering view shows **187** services clustered with **384** embedding dimensions and **COSINE** distance. With **K = 5**, visible clusters include **Pharmacy Supply**, **Specialty Care**, and **Quality and Safety** groupings. **Cluster 1 - Pharmacy Supply** contains **38** services with **67.2%** average similarity and **Viral Clearance Study Pack** as the centroid. This helps users understand how vector similarity can group healthcare services and supplies without leaving the governed data platform.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

## Task 5: Review Capacity and Supply

Perform the following set of steps to connect predicted demand with inventory, capacity, surge probability, site pressure, and service value at risk.

1. Click **Capacity and Supply**.
2. Review the summary cards.
3. Review the capacity and supply status distribution.
4. Review monitored capacity by care logistics site.
5. Scan the highest surge probability chart for services or supplies that need attention.

    ![Capacity and Supply Intelligence tab with risk counts and monitored sites highlighted](images/capacity-supply-intelligence.png)

In the current demo dataset, the tab shows **79** critical or out-of-stock items, **10** at-risk items where demand exceeds supply, **105** demand-risk predictions, about **$13.09M** service value at risk, and **1,914** monitored records. The status distribution also separates monitored supply into **Critical (79)**, **At Risk (9)**, **Low (111)**, and **Adequate (1,715)**.

This turns model output into an operating view: users can see which services, supplies, and sites need attention before a capacity issue affects care operations.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

*You can move to the next scene.*

## Credits & Build Notes
- **Author** - Oracle LiveLabs Team
- **Last Updated By/Date** - Oracle LiveLabs Team, 2026-05-22
