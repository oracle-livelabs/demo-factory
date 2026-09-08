# Scene 8 Demand and Capacity Analytics

## Introduction

**Jessica Chen** returns to the global view and scales back from one resident request to a statewide planning decision. **Demand and Capacity Analytics** compares demand risk, resident need segments, service value forecasts, clusters, and demand capacity across **Colorado** service centers.

The models help identify where service pressure deserves action. They do not prove that capacity caused the Medicaid eligibility error rate.

Estimated Time: **10 minutes**

<video controls width="100%">
  <source src="https://c4u04.objectstorage.us-ashburn-1.oci.customer-oci.com/p/EcTjWk2IuZPZeNnD_fYMcgUhdNDIDA6rt9gaFj_WZMiL7VvxPBNMY60837hu5hga/n/c4u04/b/livelabsfiles/o/livestack/Videos/State-and-Local-Gov/State and Local Government_Scene8_with-CC.mp4">
  Your browser does not support the video tag.
</video>

### Objectives

In this scene, you will compare demand risk, resident need segments, value forecasts, clustering, and capacity to support a statewide response decision.

## Task 1: Review demand risk

Perform the following set of steps to review demand risk under **Jessica Chen**'s statewide view:

1. Confirm Jessica Chen is selected.
2. Click **Demand & Capacity Analytics** in the sidebar.
3. Review the persisted model summary and active model count.
4. Click **Demand Risk**.
5. Compare demand window, predicted risk, service category, and supporting context.

    ![Colorado public-service demand risk model output](images/demand-surge-risk.png)

Demand Risk identifies service categories with rising request pressure and gives **Jessica Chen** evidence to compare with resident need and capacity.

## Task 2: Inspect Colorado Resident Need Segments

Perform the following set of steps to inspect **Colorado** Resident Need Segments and explain how segmentation supports planning:

1. Click **Need Segments**.
2. Review the segment mix and service-access risk distribution.
3. Select one meaningful segment and inspect the top resident profiles.
4. Confirm that every displayed resident is in Colorado.

    ![Colorado Resident Need Segments and in-state resident profiles](images/resident-need-segments.png)

The segments help Colorado tailor outreach, case review, and staffing without introducing operational residents from another state.

## Task 3: Use the service value forecast as supporting evidence

Perform the following set of steps to use the service value forecast as supporting evidence rather than as the only decision input:

1. Click **Value Forecast**.
2. Review the forecast horizon, trend line, forecast region, and model context.
3. Compare the forecast with the demand-risk and resident-segment evidence.

    ![Service value forecast supporting the Colorado operating decision](images/service-value-forecast.png)

The forecast estimates future public-service value and demand context. It is supporting evidence rather than a federal funding-exposure calculation.

## Task 4: Compare related operating patterns

Perform the following set of steps to compare related operating patterns through clustering evidence:

1. Click **Vector K-Means**.
2. Review cluster controls, distribution, and examples.
3. Compare patterns across Colorado services, resident signals, access, and capacity.

    ![Vector K-Means clusters for related Colorado service patterns](images/vector-k-means-clusters.png)

Clustering helps Jessica find operating patterns that may look different individually but require a similar response.

## Task 5: Make the capacity decision

Perform the following set of steps to make the capacity decision by connecting constrained services to center-level capacity:

1. Click **Capacity by Center**.
2. Review predicted demand, available capacity, days of capacity, status, and Public Service Value at Risk.
3. Compare in-state centers and service regions.
4. Identify the strongest supported intervention candidate without hardcoding a center or current score in the runbook.

    ![Demand Capacity Across Colorado Service Centers](images/capacity-intelligence.png)

**Public Service Value at Risk** estimates operating service exposure from constrained capacity. It is separate from potential federal matching-fund exposure associated with the **3.0%** eligibility threshold.

**Jessica Chen** has moved from one regional request to a statewide capacity decision. She now needs a governed answer path that she can inspect and defend.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

*You can move to the next scene.*

## Credits & Build Notes

- **Author** - Oracle LiveLabs Team
- **Last Updated By/Date** - Oracle LiveLabs Team, 2026-07-03
